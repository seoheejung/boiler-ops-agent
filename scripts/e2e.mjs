import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from '../frontend/node_modules/playwright/index.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const phase = process.env.E2E_PHASE ?? 'phase1';
const out = resolve(root, 'artifacts/e2e', phase);
mkdirSync(out, { recursive: true });
const dataset = process.env.BOILER_DATASET_PATH ?? resolve(root, 'data/raw', readdirSync(resolve(root, 'data/raw')).find(file => file.endsWith('.csv')));
const env = { ...process.env, PYTHONUTF8: '1', BOILER_DATASET_PATH: dataset, REPLAY_INTERVAL_MS: '250', STALE_AFTER_MS: '2000', KAFKA_BOOTSTRAP_SERVERS: '127.0.0.1:9092', KAFKA_TOPIC: `boiler.e2e.${Date.now()}`, OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434', OLLAMA_MODEL: process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:7b', AGENT_TRACE_DIR: resolve(out, 'agent-traces') };
const python = resolve(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const children = [];
const checks = [];
let browser;
let page;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function start(command, args, name, cwd = root) {
  const log = createWriteStream(resolve(out, `${name}.log`));
  const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log); child.stderr.pipe(log); children.push(child); return child;
}
async function poll(fn, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { try { if (await fn()) return; } catch {} await delay(150); }
  throw new Error(`Timed out: ${label}`);
}
function pass(name) { checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
const result = { phase, started_at: new Date().toISOString(), checks, topic: env.KAFKA_TOPIC };
try {
  const profile = JSON.parse(execFileSync(python, ['-m', 'scripts.dataset_profile'], { cwd: root, env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
  writeFileSync(resolve(out, 'input.json'), JSON.stringify(profile, null, 2));
  result.input_sha256 = profile.sha256;
  const apiArgs = ['-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', '8000'];
  const backend = start(python, apiArgs, 'backend');
  start(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], 'frontend', resolve(root, 'frontend'));
  await poll(async () => (await (await fetch('http://127.0.0.1:8000/api/health')).json()).kafka === 'CONNECTED', 'Kafka consumer readiness');
  await poll(async () => (await fetch('http://127.0.0.1:4173')).ok, 'frontend readiness');
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const telemetry = new Map();
  page.on('websocket', ws => ws.on('framereceived', ({ payload }) => {
    const event = JSON.parse(payload.toString());
    if (event.current) telemetry.set(`${event.current.run_id}:${event.current.sequence}`, event.current);
  }));
  await page.goto('http://127.0.0.1:4173');
  await poll(async () => await page.getByTestId('ws-status').textContent() === 'CONNECTED', 'WebSocket connected');
  start(python, ['-m', 'backend.app.replay.producer', '--limit', '16'], 'producer');
  await poll(async () => Number(await page.getByTestId('sequence').textContent()) >= 4, 'live UI');
  assert.match(await page.getByTestId('stream-status').textContent(), /LIVE/);
  await page.screenshot({ path: resolve(out, 'dashboard.png'), fullPage: true });
  await poll(async () => await page.getByTestId('sequence').textContent() === '16', 'final sequence');
  const expected = profile.first_rows[15];
  for (const row of profile.first_rows) {
    const actual = [...telemetry.values()].find(event => event.sequence === row.sequence);
    assert.ok(actual, `WebSocket sequence ${row.sequence}`);
    assert.equal(actual.source_time, row.source_time);
    for (const [tag, raw] of Object.entries(row.measurements)) {
      assert.equal(actual.sensors[tag].raw, raw, tag);
      assert.equal(actual.sensors[tag].value, raw.trim() === '' ? null : Number(raw), tag);
    }
  }
  pass('CSV → Kafka → FastAPI → WebSocket: all 16 rows, exact tags, source times and values');
  assert.equal(await page.getByTestId('source-time').textContent(), expected.source_time);
  assert.equal(await page.getByTestId('kpi-실제 출력값').textContent(), Number(expected.measurements['실제 출력값']).toLocaleString('en-US'));
  const marker = page.getByTestId('marker-총 주증기 유량');
  await marker.click();
  assert.equal(await page.getByTestId('inspector-tag').textContent(), '총 주증기 유량');
  assert.equal(await page.getByTestId('inspector-value').textContent(), Number(expected.measurements['총 주증기 유량']).toLocaleString('en-US'));
  assert.ok((await marker.textContent()).includes(await page.getByTestId('inspector-value').textContent()));
  assert.equal(await page.getByTestId('inspector-time').textContent(), expected.source_time);
  await page.screenshot({ path: resolve(out, 'selected-sensor.png'), fullPage: true });
  pass('KPI, Scene marker, selected Inspector and operations feed agree');
  await poll(async () => (await page.getByTestId('stream-status').textContent()).includes('STALE'), 'stale visible', 10000);
  pass('Replay end displays STALE');
  backend.kill();
  await poll(async () => await page.getByTestId('ws-status').textContent() !== 'CONNECTED', 'disconnected', 10000);
  start(python, apiArgs, 'backend-restarted');
  await poll(async () => await page.getByTestId('ws-status').textContent() === 'CONNECTED', 'reconnected');
  await poll(async () => await page.getByTestId('sequence').textContent() === '16', 'recovered state');
  pass('WebSocket disconnect/reconnect preserves latest state');
  const fallback = await context.newPage();
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (String(type).includes('webgl')) return null;
      return original.call(this, type, ...args);
    };
  });
  await fallback.goto('http://127.0.0.1:4173');
  await fallback.getByText('3D VIEW UNAVAILABLE').waitFor();
  await fallback.getByRole('button', { name: '02 Furnace', exact: true }).click();
  await fallback.getByTestId('inspector-tag').waitFor();
  await fallback.screenshot({ path: resolve(out, 'fallback.png'), fullPage: true });
  pass('WebGL unavailable retains selectable equipment and live values');
  if (phase !== 'phase1') {
    const registry = await (await fetch('http://127.0.0.1:8000/api/registry')).json();
    assert.deepEqual(Object.keys(registry.sensors), profile.columns.filter(tag => tag !== '일자'));
    for (const sensor of Object.values(registry.sensors)) {
      assert.ok(sensor.mapping_basis);
      if (sensor.mapping_confidence === 'unverified') assert.equal(sensor.scene_position, null);
      if (sensor.scene_position) assert.equal(sensor.scene_position.every(Number.isFinite), true);
    }
    const tag = '급탄기 A 속도 평균값 ';
    await page.getByRole('button', { name: `센서 ${tag}`, exact: true }).click();
    assert.equal(await page.getByTestId('inspector-tag').textContent(), tag);
    await page.getByRole('img', { name: `${tag} 최근 추이` }).waitFor();
    const history = await (await fetch(`http://127.0.0.1:8000/api/sensors/history?tag=${encodeURIComponent(tag)}`)).json();
    assert.equal(history.points.length, 16);
    assert.equal(history.points[15].value, Number(expected.measurements[tag]));
    assert.equal(history.points[15].source_time, expected.source_time);
    assert.equal((await fetch('http://127.0.0.1:8000/api/sensors/history?tag=unknown')).status, 404);
    await page.screenshot({ path: resolve(out, 'sensor-history.png'), fullPage: true });
    pass('All raw tags trace to registry; unknown positions remain unmapped; selected history matches source');
  }
  if (Number(phase.replace('phase', '')) >= 3) {
    const generation = await (await fetch('http://127.0.0.1:8000/api/analysis/loop?name=generation')).json();
    assert.equal(generation.points.at(-1).source_time, expected.source_time);
    const delta = Number(expected.measurements['실제 출력값']) - Number(expected.measurements['목표 발전량']);
    assert.equal(generation.points.at(-1).actual_minus_target, delta);
    assert.equal(generation.summary.baseline_count, 15);
    const reheater = await (await fetch('http://127.0.0.1:8000/api/analysis/loop?name=reheater')).json();
    assert.equal(reheater.target_available, false);
    assert.ok(reheater.points.every(point => point.actual_minus_target === null));
    await page.getByTestId('target-missing').waitFor();
    await page.getByRole('combobox', { name: '분석 Loop' }).selectOption('generation');
    await poll(async () => await page.getByTestId('target-delta-16').textContent() === delta.toLocaleString('en-US', { maximumFractionDigits: 3 }), 'actual vs target UI');
    writeFileSync(resolve(out, 'analysis.json'), JSON.stringify({ generation, reheater }, null, 2));
    pass('Aligned loop actual/target/controls, missing target and prior-only distribution');
  }
  if (Number(phase.replace('phase', '')) >= 4) {
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/agent/query'), { timeout: 360000 });
    await page.getByRole('button', { name: 'Agent 조회', exact: true }).click();
    const response = await responsePromise;
    const answer = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(answer));
    assert.equal(answer.equipment, 'feeders');
    await page.getByTestId('agent-answer').waitFor();
    const trace = await (await fetch(`http://127.0.0.1:8000/api/agent/traces/${answer.trace_id}`)).json();
    for (const evidence of answer.evidence) {
      const call = trace.calls.find(call => call.id === evidence.tool_id);
      let value = call.result;
      for (const key of evidence.path) value = value[key];
      assert.equal(value, evidence.value);
    }
    assert.ok(trace.calls.every(call => call.equipment === 'feeders' && call.tool.startsWith('get_')));
    assert.equal((await fetch('http://127.0.0.1:8000/api/tools/get_sensor_history?equipment=feeders&tag=unknown')).status, 422);
    assert.equal((await fetch('http://127.0.0.1:8000/api/tools/write_valve?equipment=feeders')).status, 422);
    writeFileSync(resolve(out, 'agent.json'), JSON.stringify({ answer, trace }, null, 2));
    pass('Actual Ollama model chooses read tools and evidence; every numeric statement traces to tool result');
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, 'telemetry.jsonl'), [...telemetry.values()].map(event => JSON.stringify(event)).join('\n') + '\n');
  result.passed = true;
} catch (error) {
  result.passed = false; result.error = String(error.stack ?? error);
  if (page) await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally {
  result.finished_at = new Date().toISOString();
  writeFileSync(resolve(out, 'run.json'), JSON.stringify(result, null, 2));
  await browser?.close();
  for (const child of children.reverse()) child.kill();
}
