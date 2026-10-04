import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

export async function validateFailures({ page, context, env, out, root, python, poll, pass, restartBackend }) {
  const base = 'http://127.0.0.1:8000';
  const observations = [];
  const json = async path => (await fetch(base + path)).json();
  const fault = mode => {
    const event = JSON.parse(execFileSync(python, ['-m', 'scripts.inject_fault', mode], { cwd: root, env, encoding: 'utf8' }));
    observations.push({ fault: mode, event }); return event;
  };
  const original = (await json('/api/state')).current;
  try {
    execFileSync('docker', ['compose', 'stop', '-t', '2', 'kafka'], { cwd: root, stdio: 'pipe', windowsHide: true });
    await poll(async () => (await json('/api/state')).kafka === 'DISCONNECTED', 'Kafka outage detection', 20000);
    assert.equal((await json('/api/state')).current.sequence, original.sequence);
    await poll(async () => await page.getByTestId('kafka-status').textContent() === 'DISCONNECTED', 'Kafka outage UI');
    observations.push({ fault: 'kafka-outage', state: await json('/api/state') });
  } finally {
    execFileSync('docker', ['compose', 'start', 'kafka'], { cwd: root, stdio: 'pipe', windowsHide: true });
  }
  await poll(async () => (await json('/api/state')).kafka === 'CONNECTED', 'Kafka recovery', 45000);
  const recovered = fault('valid');
  await poll(async () => (await json('/api/state')).current.sequence === recovered.sequence, 'consumer recovery');
  pass('Actual Kafka outage/recovery preserves last value and resumes consumption');

  const quality = fault('quality');
  await poll(async () => (await json('/api/state')).current.sequence === quality.sequence, 'quality event');
  let state = await json('/api/state');
  assert.equal(state.current.sensors['실제 출력값'].quality, 'missing');
  assert.equal(state.current.sensors['실제 출력값'].value, null);
  assert.equal(state.current.sensors['최종과열기 출구 온도 평균값'].quality, 'parse_error');
  await poll(async () => await page.getByTestId('kpi-실제 출력값').textContent() === '—', 'missing KPI');
  assert.equal(await page.getByTestId('kpi-최종과열기 출구 온도 평균값').textContent(), '파싱 오류');
  for (const mode of ['duplicate', 'reverse', 'tag']) {
    const before = await json('/api/state'); fault(mode);
    await poll(async () => (await json('/api/state')).rejected_events > before.rejected_events, `reject ${mode}`);
    const after = await json('/api/state');
    assert.equal(after.current.sequence, before.current.sequence);
    assert.equal(after.status, 'ERROR');
    observations.push({ fault: mode, result: after.error });
  }
  const valid = fault('valid');
  await poll(async () => (await json('/api/state')).current.sequence === valid.sequence, 'recovery from rejected event');
  const badCsv = resolve(out, 'malformed-input.csv');
  execFileSync(python, ['-m', 'scripts.inject_fault', 'bad-csv', '--path', badCsv], { cwd: root, env });
  const badReplay = spawnSync(python, ['-m', 'backend.app.replay.producer', '--limit', '1'], { cwd: root, env: { ...env, BOILER_DATASET_PATH: badCsv, REPLAY_START_ROW: '1' }, encoding: 'utf8', windowsHide: true });
  assert.notEqual(badReplay.status, 0);
  assert.match(badReplay.stderr, /expected .* columns/);
  writeFileSync(resolve(out, 'malformed-replay.log'), badReplay.stderr);
  pass('Missing/parse errors remain visible; duplicate/reversed/unknown-tag events reject without state advancement');

  for (const mode of ['position', 'tag']) {
    const corrupted = await context.newPage();
    await corrupted.route('**/api/registry', async route => {
      const response = await route.fetch(); const registry = await response.json();
      const sensor = Object.values(registry.sensors).find(sensor => sensor.scene_position);
      if (mode === 'position') sensor.scene_position = [999999, 0, 0]; else sensor.tag = 'WRONG_TAG';
      await route.fulfill({ response, json: registry });
    });
    await corrupted.goto('http://127.0.0.1:4173');
    await corrupted.getByRole('alert').filter({ hasText: mode === 'position' ? 'Scene Position 오류' : 'Tag Mapping 오류' }).waitFor();
    await corrupted.screenshot({ path: resolve(out, `invalid-${mode}.png`), fullPage: true });
    await corrupted.close();
  }
  const registry = await json('/api/registry');
  for (const equipment of registry.equipment) {
    const tag = Object.values(registry.sensors).find(sensor => sensor.equipment === equipment.id && sensor.scene_position && sensor.representative)?.tag;
    if (!tag) continue;
    await page.getByRole('button', { name: `센서 ${tag}`, exact: true }).click();
    const value = await page.getByTestId('inspector-value').textContent();
    assert.ok((await page.getByTestId(`marker-${tag}`).textContent()).includes(value));
    assert.equal(await page.getByTestId('inspector-tag').textContent(), tag);
  }
  const loss = await context.newPage();
  await loss.goto('http://127.0.0.1:4173');
  await loss.getByRole('button', { name: '센서 총 주증기 유량', exact: true }).waitFor();
  await loss.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas.getContext('webgl2');
    gl.getExtension('WEBGL_lose_context').loseContext();
  });
  await loss.getByText('3D VIEW UNAVAILABLE').waitFor();
  await loss.getByRole('button', { name: '02 Furnace', exact: true }).click();
  await loss.getByTestId('inspector-tag').waitFor();
  await loss.close();
  pass('Corrupt Registry/Scene positions reject; all equipment markers match Inspector; actual WebGL loss falls back');

  const modelPath = env.FORECAST_MODEL_PATH;
  renameSync(modelPath, modelPath + '.backup');
  try {
    const response = await fetch(base + '/api/agent/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ equipment: 'reheater', question: 'Use get_temperature_forecast to report the predicted temperature.', tag: '최종재열기 입구 온도 평균값' }) });
    const failure = await response.json();
    assert.equal(response.status, 503, JSON.stringify(failure));
    const trace = await json('/api/agent/traces/' + failure.detail.trace_id);
    assert.ok(trace.error.includes('not trained'));
    assert.ok(trace.calls.some(call => call.tool === 'get_temperature_forecast' && !call.result));
    writeFileSync(resolve(out, 'agent-tool-failure.json'), JSON.stringify(trace, null, 2));
    assert.equal((await json('/api/state')).kafka, 'CONNECTED');
  } finally { renameSync(modelPath + '.backup', modelPath); }
  pass('Agent tool failure returns 503 plus failed-call trace while telemetry stays available');

  const source = JSON.parse(readFileSync(resolve(out, 'advisory-agent.json'), 'utf8')).advisory.trace_id;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SIMULATOR_APPROVAL_TOKEN}` };
  const propose = async () => {
    const response = await fetch(base + '/api/simulator/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_trace_id: source, intent: 'Increase the local demo parameter by one synthetic step.' }) });
    const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
  };
  const proposal = await propose();
  const competing = await propose();
  const url = base + `/api/simulator/proposals/${proposal.id}/decision`;
  const decision = { approve: true, confirm: true, expected_revision: proposal.expected_revision };
  const send = (body, auth = headers, address = url) => fetch(address, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  const before = await json('/api/simulator');
  assert.equal((await send(decision, { ...headers, Authorization: 'Bearer invalid' })).status, 401);
  assert.equal((await send({ ...decision, confirm: false })).status, 422);
  assert.equal((await send({ ...decision, approve: 'true' })).status, 422);
  assert.equal((await send({ ...decision, requested_value: 9 })).status, 422);
  assert.equal((await send({ ...decision, expected_revision: 99 })).status, 409);
  assert.equal((await fetch(base + '/api/simulator/execute', { method: 'POST', headers, body: '{}' })).status, 404);
  assert.equal((await json('/api/simulator')).value, before.value);
  const concurrent = await Promise.all([send(decision), send(decision)]);
  assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
  const after = await json('/api/simulator');
  assert.equal(after.revision, before.revision + 1);
  assert.equal((await send({ ...decision, expected_revision: competing.expected_revision }, headers, base + `/api/simulator/proposals/${competing.id}/decision`)).status, 409);
  const expired = await propose();
  execFileSync(python, ['-m', 'scripts.inject_fault', 'expire', '--id', expired.id], { cwd: root, env });
  assert.equal((await send({ ...decision, expected_revision: expired.expected_revision }, headers, base + `/api/simulator/proposals/${expired.id}/decision`)).status, 409);
  const damaged = await propose();
  execFileSync(python, ['-m', 'scripts.inject_fault', 'corrupt-proposal', '--id', damaged.id], { cwd: root, env });
  assert.equal((await send({ ...decision, expected_revision: damaged.expected_revision }, headers, base + `/api/simulator/proposals/${damaged.id}/decision`)).status, 422);
  assert.equal((await json('/api/simulator')).value, after.value);
  const audit = await json('/api/simulator/audit');
  const executed = audit.filter(event => event.event === 'executed');
  const rejected = new Set(audit.filter(event => event.event === 'rejected').map(event => event.proposal_id));
  const approved = new Set(audit.filter(event => event.event === 'approved').map(event => event.proposal_id));
  assert.ok(executed.every(event => approved.has(event.proposal_id) && !rejected.has(event.proposal_id)));
  assert.equal(executed.length, 2);
  await restartBackend();
  await poll(async () => (await json('/api/simulator')).revision === after.revision, 'persistent simulator after restart');
  assert.equal((await json('/api/simulator/audit')).length, audit.length);
  const proposed = new Set(audit.filter(event => event.event === 'proposed').map(event => event.proposal_id));
  const counters = {
    unauthorized_write: executed.filter(event => !approved.has(event.proposal_id)).length,
    approval_bypass: executed.filter(event => !approved.has(event.proposal_id) || !proposed.has(event.proposal_id)).length,
    rejected_write_execution: executed.filter(event => rejected.has(event.proposal_id)).length,
    successful_write_trace_coverage: executed.filter(event => approved.has(event.proposal_id) && proposed.has(event.proposal_id)).length / executed.length,
    executed_writes: executed.length,
  };
  writeFileSync(resolve(out, 'failure-observations.json'), JSON.stringify(observations, null, 2));
  writeFileSync(resolve(out, 'safety-counters.json'), JSON.stringify(counters, null, 2));
  writeFileSync(resolve(out, 'final-audit.json'), JSON.stringify(audit, null, 2));
  pass('Approval tampering, concurrency, expiry and stale revision block; state/audit persist; write trace coverage 100%');
}
