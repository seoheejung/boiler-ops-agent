import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from '../frontend/node_modules/playwright/index.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'artifacts/e2e/phase7/ui-review');

async function tabTo(page, target) {
  for (let step = 0; step < 400; step++) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Keyboard could not reach ${await target.textContent()}`);
}

async function inspect(page, label, out) {
  const findings = await page.evaluate(() => {
    const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
    const controls = [...document.querySelectorAll('button, input, textarea, select')].filter(visible);
    const rgb = value => value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
    const luminance = channels => channels.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    const contrast = [];
    for (const element of document.querySelectorAll('body *')) {
      if (!visible(element) || element.closest('svg, canvas, button:disabled, [aria-hidden="true"]') || ![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
      const style = getComputedStyle(element);
      if (style.clipPath === 'inset(50%)') continue;
      let background = [255, 255, 255];
      const layers = [];
      for (let node = element; node; node = node.parentElement) layers.unshift(rgb(getComputedStyle(node).backgroundColor));
      for (const layer of layers) {
        const alpha = layer[3] ?? 1;
        background = background.map((value, i) => value * (1 - alpha) + layer[i] * alpha);
      }
      const foreground = rgb(style.color);
      const light = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      const ratio = (light[0] + .05) / (light[1] + .05);
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) contrast.push({ text: element.textContent.trim().slice(0, 70), foreground: style.color, ratio: Number(ratio.toFixed(2)) });
    }
    return {
      title: document.title,
      language: document.documentElement.lang,
      description: document.querySelector('meta[name="description"]')?.content,
      mainCount: document.querySelectorAll('main').length,
      unnamedControls: controls.filter(element => !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.textContent.trim() && !element.labels?.length).map(element => element.outerHTML),
      imagesWithoutAlt: [...document.querySelectorAll('img:not([alt])')].map(element => element.src),
      unnamedGraphics: [...document.querySelectorAll('svg[role="img"]')].filter(element => !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.querySelector('title')).length,
      positiveTabindex: document.querySelectorAll('[tabindex]') ? [...document.querySelectorAll('[tabindex]')].filter(element => element.tabIndex > 0).length : 0,
      brokenAnchors: [...document.querySelectorAll('a[href^="#"]')].filter(element => !document.getElementById(decodeURIComponent(element.hash.slice(1)))).map(element => element.hash),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      viewport: innerWidth,
      contrast,
    };
  });
  writeFileSync(resolve(out, `${label}.json`), JSON.stringify(findings, null, 2));
  assert.ok(findings.title && findings.language === 'ko' && findings.description, label);
  assert.equal(findings.mainCount, 1, `${label}: main landmark`);
  assert.deepEqual(findings.unnamedControls, [], label);
  assert.deepEqual(findings.imagesWithoutAlt, [], label);
  assert.equal(findings.unnamedGraphics, 0, label);
  assert.equal(findings.positiveTabindex, 0, label);
  assert.deepEqual(findings.brokenAnchors, [], label);
  assert.equal(findings.overflow, false, `${label}: horizontal overflow`);
  assert.deepEqual(findings.contrast, [], `${label}: text contrast`);
  writeFileSync(resolve(out, `${label}-accessibility.yml`), await page.locator('body').ariaSnapshot());
}

export async function reviewApplication(page, context, out = output) {
  mkdirSync(out, { recursive: true });
  const home = new URL('/', page.url()).href;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(home);
  await page.getByRole('button', { name: '02 Furnace', exact: true }).waitFor();
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('link', { name: '본문으로 건너뛰기' }).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#main').evaluate(element => element === document.activeElement), true);
  await tabTo(page, page.getByRole('button', { name: '02 Furnace', exact: true }));
  await page.keyboard.press('Enter');
  await page.getByTestId('inspector-tag').waitFor();
  await inspect(page, 'app-desktop', out);
  await page.screenshot({ path: resolve(out, 'app-desktop.png'), fullPage: true });
  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await inspect(page, `app-${width}`, out);
  }
  await page.setViewportSize({ width: 375, height: 850 });
  await page.goto(home);
  await tabTo(page, page.getByRole('button', { name: '메뉴', exact: true }));
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#menu-toggle').evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('link', { name: '운전 분석', exact: true }));
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#analysis').evaluate(element => element === document.activeElement), true);
  assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
  const select = page.getByRole('combobox', { name: '분석 Loop' });
  await tabTo(page, select);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  assert.equal(await select.inputValue(), 'generation');
  await page.screenshot({ path: resolve(out, 'app-mobile.png'), fullPage: true });
  await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }' });
  await page.setViewportSize({ width: 320, height: 900 });
  await inspect(page, 'app-text-spacing-320', out);
  const missing = await context.newPage();
  await missing.setViewportSize({ width: 320, height: 800 });
  await missing.goto(new URL('/missing-review-page', home).href);
  await missing.getByRole('heading', { name: '페이지를 찾을 수 없습니다' }).waitFor();
  await inspect(missing, 'app-404', out);
  await missing.getByRole('link', { name: '운전 현황으로 이동' }).click();
  await missing.getByRole('heading', { name: '운전 현황 Historical replay' }).waitFor();
  await missing.close();
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto(home);
  writeFileSync(resolve(out, 'app-result.json'), JSON.stringify({ passed: true, keyboard: ['skip link', 'equipment selection', 'mobile menu', 'Escape focus return', 'section navigation', 'analysis select'], widths: [320, 375, 768, 1280], manualScreenReader: 'Not run; Chromium accessibility trees captured' }, null, 2));
}

async function reviewDocumentation() {
  mkdirSync(output, { recursive: true });
  const publicFiles = new Map([
    ['/docs/index.html', ['docs/index.html', 'text/html; charset=utf-8']],
    ...['dashboard', 'login', 'simulator', 'agent-answer'].map(name => [`/docs/images/${name}.jpg`, [`docs/images/${name}.jpg`, 'image/jpeg']]),
    ['/docs/404.html', ['docs/404.html', 'text/html; charset=utf-8']],
    ['/frontend/public/favicon.svg', ['frontend/public/favicon.svg', 'image/svg+xml']],
  ]);
  const server = createServer((request, response) => {
    const entry = publicFiles.get(new URL(request.url, 'http://localhost').pathname);
    if (!entry) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': entry[1] });
    response.end(readFileSync(resolve(root, entry[0])));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}/docs/`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const results = { passed: false, checks: [] };
  try {
    for (const name of ['index.html', '404.html']) {
      const file = resolve(root, 'docs', name);
      await page.goto(base + name);
      const links = await page.locator('a[href], link[href], img[src]').evaluateAll(elements => elements.map(element => element.getAttribute('href') ?? element.getAttribute('src')));
      for (const link of links) {
        if (/^(https?:|#)/.test(link)) continue;
        assert.ok(existsSync(resolve(dirname(file), decodeURIComponent(link.split('#')[0]))), `${name}: broken link ${link}`);
      }
      for (const width of [1440, 768, 375, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await inspect(page, `docs-${name}-${width}`, output);
      }
      results.checks.push(`${name}: links, labels, landmarks, graphics and reflow`);
    }
    await page.goto(base + 'index.html');
    const downloads = []; page.on('download', item => downloads.push(item.suggestedFilename()));
    await page.getByRole('button', { name: '처음부터 실행하는 순서' }).click();
    await page.getByRole('dialog').getByRole('heading', { name: '실행은 이렇게 하세요', exact: true }).waitFor();
    await inspect(page, 'docs-readme-dialog-320', output);
    assert.equal(await page.getByRole('dialog').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '최초 감사 기록', exact: true }).click();
    assert.ok(await page.getByRole('dialog').locator('table').count() > 0);
    await inspect(page, 'docs-audit-dialog-320', output);
    assert.equal(await page.getByRole('dialog').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'AI 근거 조회', exact: false }).click();
    await page.getByRole('button', { name: 'query_agent', exact: false }).click();
    assert.ok((await page.getByRole('dialog').locator('pre').textContent()).includes('def query_agent('));
    await page.keyboard.press('Escape');
    const answerReview = page.getByRole('button', { name: '다섯 질문의 실제 답변과 검수 기록', exact: false });
    await answerReview.click();
    const answerTable = await page.getByRole('dialog').locator('table').first().innerText();
    assert.ok(answerTable.includes('66.52') && answerTable.includes('계산 불가') && answerTable.includes('Naive'));
    await page.getByRole('dialog').getByRole('img').evaluate(image => image.decode());
    await inspect(page, 'docs-agent-review-320', output);
    assert.equal(await page.getByRole('dialog').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
    await page.screenshot({ path: resolve(output, 'docs-agent-review-320.png'), fullPage: true });
    await page.keyboard.press('Escape');
    assert.equal(await answerReview.evaluate(element => element === document.activeElement), true);
    results.checks.push('Five-question Agent report opens in-page; mobile reader fits; focus returns to report button');
    assert.deepEqual(downloads, []);
    results.checks.push('Rendered README and audit tables; source preview; Escape closes dialogs; no downloads');
    await page.reload();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#main').evaluate(element => element === document.activeElement), true);
    await page.reload();
    await tabTo(page, page.locator('.toc summary'));
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.toc').getAttribute('open'), '');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.toc').getAttribute('open'), null);
    await page.screenshot({ path: resolve(output, 'docs-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: resolve(output, 'docs-desktop.png'), fullPage: true });
    assert.deepEqual(errors, []);
    results.checks.push('Keyboard skip link, disclosure menu, Escape focus return; no page errors');
    results.passed = true;
  } catch (error) {
    results.error = String(error.stack ?? error);
    await page.screenshot({ path: resolve(output, 'docs-failure.png'), fullPage: true });
    throw error;
  } finally {
    writeFileSync(resolve(output, 'docs-result.json'), JSON.stringify(results, null, 2));
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await reviewDocumentation();
  console.log('Documentation browser review passed. Application review runs within E2E_PHASE=phase7.');
}
