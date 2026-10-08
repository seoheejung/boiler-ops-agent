import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../frontend/node_modules/playwright/index.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = resolve(root, 'artifacts/e2e/phase7/local-start', new Date().toISOString().replaceAll(/[:.]/g, '-'));
mkdirSync(out, { recursive: true });
const config = mkdtempSync(resolve(root, '.env.start-e2e-'));
const python = resolve(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const npmCmd = process.platform === 'win32' ? execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0] : null;
const npmCli = npmCmd ? resolve(dirname(npmCmd), 'node_modules/npm/bin/npm-cli.js') : process.env.npm_execpath;
assert.ok(npmCli && existsSync(npmCli), 'npm CLI is required');
const dataset = process.env.BOILER_DATASET_PATH ?? resolve(root, 'data/raw', readdirSync(resolve(root, 'data/raw')).find(name => name.endsWith('.csv')));
const settings = readFileSync(resolve(root, '.env.example'), 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => line.split(/=(.*)/s).slice(0, 2));
const values = Object.fromEntries(settings);
Object.assign(values, { BOILER_DATASET_PATH: dataset, KAFKA_BOOTSTRAP_SERVERS: '127.0.0.1:19093', KAFKA_HOST_PORT: '19093',
  COMPOSE_PROJECT_NAME: 'boiler-ops-start-e2e', KAFKA_TOPIC: `boiler.start.${Date.now()}`, REPLAY_INTERVAL_MS: '250', STALE_AFTER_MS: '5000',
  FORECAST_MODEL_PATH: resolve(out, 'forecast.json'), SIMULATOR_DB_PATH: resolve(out, 'simulator.sqlite'), AGENT_TRACE_DIR: resolve(out, 'traces') });
const configFile = resolve(config, '.env');
const text = Object.entries(values).map(([key, value]) => `${key}="${value.replaceAll('\\', '/')}"`).join('\n');
writeFileSync(configFile, text);
const env = { ...process.env, PYTHONUTF8: '1', UV_PYTHON_DOWNLOADS: 'never' };
const composeArgs = ['compose', '--project-directory', root, '-f', resolve(root, 'docker-compose.yml'), '--env-file', configFile, '--env-file', resolve(config, '.env.security')];
const compose = (...args) => execFileSync('docker', [...composeArgs, ...args], { cwd: root, env, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = { started_at: new Date().toISOString(), input_sha256: digest(dataset), checks: [] };
const executions = [];
let child, browser;
let output = '';
const secrets = [];
function launch() {
  output = '';
  child = spawn(process.execPath, [npmCli, 'start', '--', '--config-dir', config, '--no-browser'], { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { output += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { output += chunk.toString('utf8'); });
  return child;
}
function remember() {
  for (const match of output.matchAll(/Access key: (\S+)/g)) secrets.push(match[1]);
  executions.push(output.replace(/Access key: \S+/g, 'Access key: [REDACTED]'));
}
async function poll(check, label, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    if (child?.exitCode !== null) throw new Error(`Launcher ended before ${label}; inspect launcher.log`);
    await delay(250);
  }
  throw new Error(`Timed out: ${label}`);
}
async function stop() {
  child.stdin.write('\n');
  await poll(() => child.exitCode !== null, 'Enter shutdown', 90000);
  assert.equal(child.exitCode, 0);
  remember();
}
async function free(port) {
  await new Promise((ok, fail) => {
    const server = createServer(); server.once('error', fail);
    server.listen(port, '127.0.0.1', () => server.close(ok));
  });
}
function pass(name) { result.checks.push(name); console.log(`PASS ${name}`); }
try {
  for (const port of [8000, 5173, 19093]) await free(port);
  launch();
  await poll(() => output.includes('화면이 준비됐습니다:'), 'first npm start', 600000);
  const accessKey = output.match(/User ID: operator\s+Access key: (\S+)/)?.[1];
  assert.ok(accessKey, 'First run issues a personal key in the terminal');
  assert.equal(readFileSync(configFile, 'utf8'), text);
  const securityHash = digest(resolve(config, '.env.security'));
  pass('First npm start prepares a new login, Kafka, forecast, API, frontend and replay');
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('http://127.0.0.1:5173');
  await page.getByLabel('사용자 ID', { exact: true }).fill('operator');
  await page.getByLabel('개인 접근 키', { exact: true }).fill(accessKey);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await poll(async () => await page.getByTestId('ws-status').textContent() === 'CONNECTED', 'WebSocket');
  await poll(async () => Number(await page.getByTestId('sequence').textContent()) >= 3, 'LIVE telemetry');
  assert.match(await page.getByTestId('stream-status').textContent(), /LIVE/);
  await page.getByRole('button', { name: '화면 자동 갱신 일시정지', exact: true }).click();
  await page.getByTestId('marker-총 주증기 유량').click();
  const shown = { source_time: await page.getByTestId('inspector-time').textContent(), value: await page.getByTestId('inspector-value').textContent(), tag: '총 주증기 유량' };
  const original = JSON.parse(execFileSync(python, ['-c', 'import csv,json,sys; f=open(sys.argv[1],encoding="utf-8-sig",newline=""); row=next(r for r in csv.DictReader(f) if r["일자"]==sys.argv[2]); print(json.dumps({"raw":row[sys.argv[3]]}))', dataset, shown.source_time, shown.tag], { encoding: 'utf8', env }));
  assert.equal(shown.value, Number(original.raw).toLocaleString('en-US'));
  assert.deepEqual(pageErrors, []);
  result.observation = { ...shown, raw: original.raw };
  await page.screenshot({ path: resolve(out, 'running.jpg'), type: 'jpeg', quality: 78 });
  pass('Browser login and live WebSocket succeed; frozen sensor value and source time match CSV');
  await browser.close(); browser = null;
  const active = child;
  const activeOutput = output;
  launch();
  await poll(() => child.exitCode !== null, 'duplicate rejection');
  assert.equal(child.exitCode, 1); assert.match(output, /8000 포트를 사용 중/); remember();
  child = active; output = activeOutput;
  assert.equal((await fetch('http://127.0.0.1:8000/api/health')).status, 200);
  pass('Duplicate startup is rejected without terminating the active API');
  await stop();
  for (const port of [8000, 5173, 19093]) await free(port);
  assert.equal(compose('ps', '--status', 'running', '--quiet', 'kafka').trim(), '');
  pass('Enter stops owned processes and newly started Kafka; application ports are released');
  compose('up', '-d', '--wait', 'kafka');
  launch();
  await poll(() => output.includes('화면이 준비됐습니다:'), 'second npm start', 300000);
  assert.ok(!output.includes('Access key:'));
  assert.equal(digest(resolve(config, '.env.security')), securityHash);
  assert.equal(readFileSync(configFile, 'utf8'), text);
  await stop();
  assert.ok(compose('ps', '--status', 'running', '--quiet', 'kafka').trim());
  assert.ok(await fetch('http://127.0.0.1:11434/api/tags').then(response => response.ok));
  pass('Second run preserves configuration, credentials, already-running Kafka and Ollama');
  compose('stop', 'kafka');
  writeFileSync(configFile, text.replace(values.SIMULATOR_DB_PATH.replaceAll('\\', '/'), out.replaceAll('\\', '/')));
  launch();
  await poll(() => child.exitCode !== null, 'API startup failure', 300000);
  assert.equal(child.exitCode, 1); assert.match(output, /api 실행이 중단/); remember();
  for (const port of [8000, 5173, 19093]) await free(port);
  assert.equal(compose('ps', '--status', 'running', '--quiet', 'kafka').trim(), '');
  pass('API startup failure reports its log and cleans up newly started Kafka and child processes');
  writeFileSync(configFile, text.replace(dataset.replaceAll('\\', '/'), resolve(config, 'missing.csv').replaceAll('\\', '/')));
  launch();
  await poll(() => child.exitCode !== null, 'missing CSV rejection');
  assert.equal(child.exitCode, 1); assert.match(output, /원본 CSV가 없습니다/); remember();
  assert.equal(digest(resolve(config, '.env.security')), securityHash);
  pass('Missing CSV produces a short actionable error without replacing credentials');
  result.passed = true;
} catch (error) {
  remember(); result.passed = false; result.error = error.message; process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (child && child.exitCode === null) {
    child.stdin.write('\n');
    const deadline = Date.now() + 60000;
    while (child.exitCode === null && Date.now() < deadline) await delay(250);
    if (child.exitCode === null) {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGTERM');
    }
  }
  const logRoot = resolve(config, 'artifacts/local-start');
  for (const run of existsSync(logRoot) ? readdirSync(logRoot, { withFileTypes: true }) : []) {
    if (!run.isDirectory()) continue;
    for (const file of readdirSync(resolve(config, 'artifacts/local-start', run.name))) {
      const source = resolve(config, 'artifacts/local-start', run.name, file);
      const data = readFileSync(source, 'utf8');
      assert.ok(secrets.every(key => !data.includes(key)), 'Personal keys must not enter logs');
      copyFileSync(source, resolve(out, `${run.name}-${file}`));
    }
  }
  if (result.error) for (const key of secrets) result.error = result.error.replaceAll(key, '[REDACTED]');
  writeFileSync(resolve(out, 'launcher.log'), executions.join('\n--- next invocation ---\n'));
  result.finished_at = new Date().toISOString();
  writeFileSync(resolve(out, 'run.json'), JSON.stringify(result, null, 2));
  try { compose('down'); } catch { console.error('Test Kafka cleanup failed; project boiler-ops-start-e2e needs inspection'); }
  assert.ok(resolve(config).startsWith(root + sep + '.env.start-e2e-'));
  rmSync(config, { recursive: true });
}
console.log(JSON.stringify(result, null, 2));
