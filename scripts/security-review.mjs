import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

export async function reviewSecurity({ context, page, out, env, root, python, apiFetch, rawFetch, accounts, loginApi, frontendUrl, poll, restartForExpiry }) {
  const observations = [];
  const resultDir = resolve(out, 'security-review'); mkdirSync(resultDir, { recursive: true });
  const base = 'http://127.0.0.1:8000';
  const post = (path, body, extra = {}) => apiFetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  const checked = (name, value, expected) => { observations.push({ name, actual: value, expected }); writeFileSync(resolve(resultDir, 'boundaries.json'), JSON.stringify({ passed: false, observations }, null, 2)); assert.deepEqual(value, expected, name); };
  const headers = { Origin: frontendUrl, 'Content-Type': 'application/json' };
  for (const path of ['/api/state', '/api/registry', '/api/simulator', '/api/simulator/audit', '/api/agent/traces/00000000-0000-0000-0000-000000000000', '/openapi.json']) checked('anonymous ' + path, (await rawFetch(base + path)).status, 401);
  checked('minimal health', await (await rawFetch(base + '/api/health')).json(), { status: 'ok' });
  checked('anonymous proposal', (await rawFetch(base + '/api/simulator/proposals', { method: 'POST', headers, body: '{}' })).status, 401);
  checked('foreign origin', (await post('/api/simulator/proposals', {}, { Origin: 'http://localhost:9999' })).status, 403);
  checked('invalid Host', await new Promise((resolve, reject) => { const request = httpRequest(base + '/api/state', { headers: { Host: 'attacker.invalid' } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); request.end(); }), 400);
  checked('oversized request', (await post('/api/agent/query', { question: 'x'.repeat(9000) })).status, 413);
  const stateResponse = await apiFetch(base + '/api/state');
  checked('no-store', stateResponse.headers.get('cache-control'), 'no-store');
  checked('UI frame defense', (await rawFetch(frontendUrl)).headers.get('x-frame-options'), 'DENY');
  const invalidLogin = await rawFetch(base + '/api/session', { method: 'POST', headers, body: JSON.stringify({ user_id: 'operator', access_key: 'sensitive-invalid-input' }) });
  checked('credential validation excludes input', (await invalidLogin.text()).includes('sensitive-invalid-input'), false);
  const isolated = await context.browser().newContext();
  const anonymous = await isolated.newPage();
  await anonymous.goto(frontendUrl);
  checked('anonymous websocket', await anonymous.evaluate(() => new Promise(resolve => { const ws = new WebSocket(`ws://${location.host}/api/ws`); ws.onopen = () => { ws.close(); resolve('opened'); }; ws.onerror = () => resolve('blocked'); })), 'blocked');
  await isolated.close();
  const viewer = await loginApi(accounts[2]);
  const other = await loginApi(accounts[1]);
  checked('viewer read', (await apiFetch(base + '/api/state', { headers: { Cookie: viewer } })).status, 200);
  const query = { equipment: 'reheater', tag: '최종재열기 입구 온도 평균값', question: 'Summarize current observed readings.' };
  checked('viewer model', (await post('/api/agent/query', query, { Cookie: viewer })).status, 403);
  const fault = () => JSON.parse(execFileSync(python, ['-m', 'scripts.inject_fault', 'valid'], { cwd: root, env, encoding: 'utf8' }));
  fault();
  const work = await post('/api/agent/query', query);
  checked('fresh evidence', work.status, 200);
  const traceId = (await work.json()).trace_id;
  checked('other user trace', (await apiFetch(base + '/api/agent/traces/' + traceId, { headers: { Cookie: other } })).status, 404);
  checked('other user proposal source', (await post('/api/simulator/proposals', { source_trace_id: traceId, intent: 'Hold.' }, { Cookie: other })).status, 404);
  const tracePath = resolve(env.AGENT_TRACE_DIR, traceId + '.json');
  const original = readFileSync(tracePath, 'utf8');
  const trace = JSON.parse(original);
  for (const [name, altered] of [
    ['expired evidence', { ...trace, created_at: new Date(Date.now() - 301000).toISOString() }],
    ['STALE evidence', { ...trace, snapshot_status: 'STALE' }],
    ['failed evidence', { ...trace, response: undefined }],
    ['wrong sensor evidence', { ...trace, context: { ...trace.context, tag: 'other' } }],
    ['legacy ownerless evidence', { ...trace, owner: undefined }],
  ]) {
    try { writeFileSync(tracePath, JSON.stringify(altered)); checked(name, (await post('/api/simulator/proposals', { source_trace_id: traceId, intent: 'Hold.' })).status, name.startsWith('legacy') ? 404 : 409); }
    finally { writeFileSync(tracePath, original); }
  }
  fault();
  const proposals = await Promise.all([post('/api/simulator/proposals', { source_trace_id: traceId, intent: 'Hold.' }), post('/api/simulator/proposals', { source_trace_id: traceId, intent: 'Hold.' })]);
  checked('single-use evidence race', proposals.map(response => response.status).sort(), [200, 409]);
  const proposal = await proposals.find(response => response.status === 200).json();
  const decision = { approve: true, confirm: true, expected_revision: proposal.expected_revision };
  checked('other user decision', (await post(`/api/simulator/proposals/${proposal.id}/decision`, decision, { Cookie: other })).status, 404);
  checked('viewer decision', (await post(`/api/simulator/proposals/${proposal.id}/decision`, decision, { Cookie: viewer })).status, 403);
  checked('other user private proposals', (await (await apiFetch(base + '/api/simulator', { headers: { Cookie: other } })).json()).proposals, []);
  checked('other user private audit', await (await apiFetch(base + '/api/simulator/audit', { headers: { Cookie: other } })).json(), []);
  checked('audit page limit', (await apiFetch(base + '/api/simulator/audit?limit=101')).status, 422);
  const quota = action => execFileSync(python, ['-c', "import os,sqlite3; db=sqlite3.connect(os.environ['SIMULATOR_DB_PATH']); " + (action === 'fill' ? "db.executemany('INSERT INTO audit(created_at,event,payload,owner) VALUES(0,?,?,?)', [('capacity','{}','capacity-probe')]*5000); " : "db.execute(\"DELETE FROM audit WHERE owner='capacity-probe'\"); ") + "db.commit(); db.close()"], { cwd: root, env, windowsHide: true });
  try { quota('fill'); checked('audit storage limit', (await post(`/api/simulator/proposals/${proposal.id}/decision`, decision)).status, 507); }
  finally { quota('clear'); }
  const before = await (await apiFetch(base + '/api/state')).json();
  const kafka = JSON.parse(execFileSync(python, ['-m', 'scripts.probe-kafka-security'], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  for (const name of ['anonymous_write_denied', 'consumer_write_denied', 'producer_read_denied']) checked(name, kafka[name], true);
  await poll(async () => (await (await apiFetch(base + '/api/state')).json()).rejected_events > before.rejected_events, 'captured run rejected');
  checked('captured run cannot replace new run', (await (await apiFetch(base + '/api/state')).json()).current.run_id, kafka.new_run_id);
  checked('changed run approval', (await post(`/api/simulator/proposals/${proposal.id}/decision`, decision)).status, 409);
  const foreign = await context.newPage();
  await foreign.route('http://127.0.0.1:49999/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Foreign origin probe</title>' }));
  await foreign.goto('http://127.0.0.1:49999/');
  checked('foreign-origin websocket', await foreign.evaluate(() => new Promise(resolve => { const ws = new WebSocket('ws://127.0.0.1:8000/api/ws'); ws.onopen = () => { ws.close(); resolve('opened'); }; ws.onerror = () => resolve('blocked'); setTimeout(() => { ws.close(); resolve('timeout'); }, 5000); })), 'blocked');
  await foreign.close();
  const connections = await page.evaluate(() => Promise.all(Array.from({ length: 5 }, () => new Promise(resolve => { const ws = new WebSocket(`ws://${location.host}/api/ws`); ws.onopen = () => { setTimeout(() => ws.close(), 1500); resolve('opened'); }; ws.onerror = () => resolve('blocked'); }))));
  checked('per-user websocket limit', connections.filter(item => item === 'opened').length <= 3, true);
  checked('websocket overflow connections rejected', connections.includes('blocked'), true);
  const revoked = await loginApi(accounts[1]);
  const revokedContext = await context.browser().newContext();
  await revokedContext.addCookies([{ name: 'boiler_session', value: revoked.split('=')[1], domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }]);
  const revokedPage = await revokedContext.newPage();
  await revokedPage.goto(frontendUrl);
  await revokedPage.evaluate(() => { window.probeClose = null; const ws = new WebSocket(`ws://${location.host}/api/ws`); ws.onclose = event => { window.probeClose = event.code; }; window.probeSocket = ws; });
  await poll(() => revokedPage.evaluate(() => window.probeSocket.readyState === WebSocket.OPEN), 'revocation probe open');
  checked('logout', (await apiFetch(base + '/api/session', { method: 'DELETE', headers: { Cookie: revoked } })).status, 200);
  checked('revoked session', (await apiFetch(base + '/api/state', { headers: { Cookie: revoked } })).status, 401);
  await poll(() => revokedPage.evaluate(() => window.probeClose === 1008), 'logout closes active websocket');
  checked('logout websocket close', await revokedPage.evaluate(() => window.probeClose), 1008);
  await revokedContext.close();
  const padding = [];
  try {
    for (let i = 0; i < 1000; i++) { const file = resolve(env.AGENT_TRACE_DIR, `capacity-probe-${i}.json`); writeFileSync(file, '{}', { flag: 'wx' }); padding.push(file); }
    checked('trace storage limit', (await post('/api/agent/query', query, { Cookie: other })).status, 507);
  } finally { for (const file of padding) unlinkSync(file); }
  const bursts = await Promise.all(Array.from({ length: 14 }, () => post('/api/agent/query', query, { Cookie: other })));
  checked('model capacity/rate limits', bursts.some(response => response.status === 429), true);
  checked('at most two model executions in burst', bursts.filter(response => response.status === 200 || response.status === 503).length <= 2, true);
  await restartForExpiry();
  const currentCookie = (await context.cookies()).find(cookie => cookie.name === 'boiler_session');
  checked('HttpOnly session cookie', currentCookie.httpOnly, true);
  checked('SameSite Strict session cookie', currentCookie.sameSite, 'Strict');
  await page.evaluate(() => { window.expiryClose = null; const ws = new WebSocket(`ws://${location.host}/api/ws`); ws.onclose = event => { window.expiryClose = event.code; }; window.expirySocket = ws; });
  await poll(() => page.evaluate(() => window.expirySocket.readyState === WebSocket.OPEN), 'expiry probe open');
  await poll(async () => { await new Promise(resolve => setTimeout(resolve, 1000)); return (await apiFetch(base + '/api/state')).status === 401; }, 'absolute session expiry', 65000);
  checked('expired session', (await apiFetch(base + '/api/state')).status, 401);
  await poll(() => page.evaluate(() => window.expiryClose === 1008), 'expiry closes active websocket');
  checked('expiry websocket close', await page.evaluate(() => window.expiryClose), 1008);
  writeFileSync(resolve(resultDir, 'boundaries.json'), JSON.stringify({ passed: true, observations }, null, 2));
}
