import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';

export async function reviewSecurity({ context, out }) {
  const directory = resolve(out, 'security-review');
  mkdirSync(directory, { recursive: true });
  const base = 'http://127.0.0.1:8000';
  const result = { scope: 'Local E2E test instance only; low-volume requests; no production data or credentials recorded', observations: [], completed: false };
  const record = (id, evidence) => result.observations.push({ id, ...evidence });
  let foreign;
  let originServer;
  try {
    for (const path of ['/api/state', '/api/registry', '/api/simulator', '/api/simulator/audit', '/openapi.json']) {
      const response = await fetch(base + path);
      record('anonymous-read', { path, status: response.status });
    }
    const response = await fetch(base + '/api/state', { headers: { Host: 'untrusted.example', Origin: 'https://untrusted.example' } });
    record('host-and-response-headers', { status: response.status, csp: response.headers.get('content-security-policy'), frameOptions: response.headers.get('x-frame-options'), cacheControl: response.headers.get('cache-control'), allowOrigin: response.headers.get('access-control-allow-origin') });
    originServer = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><html lang="en"><title>Local hostile-origin simulation</title><body>Security test origin</body></html>');
    });
    await new Promise((resolve, reject) => { originServer.once('error', reject); originServer.listen(0, '127.0.0.1', resolve); });
    foreign = await context.newPage();
    const browserMessages = [];
    foreign.on('console', message => { if (message.type() === 'error') browserMessages.push(message.text()); });
    await foreign.goto(`http://127.0.0.1:${originServer.address().port}/`);
    const websocket = await foreign.evaluate(() => new Promise(resolve => {
      const socket = new WebSocket('ws://127.0.0.1:8000/api/ws');
      const timeout = setTimeout(() => { socket.close(); resolve({ accepted: false, reason: 'timeout' }); }, 8000);
      socket.onmessage = ({ data }) => { clearTimeout(timeout); const message = JSON.parse(data); socket.close(); resolve({ accepted: true, type: message.type, containsTelemetry: Boolean(message.current), browserOrigin: location.origin }); };
      socket.onerror = () => { clearTimeout(timeout); resolve({ accepted: false, reason: 'browser connection rejected', browserOrigin: location.origin }); };
    }));
    record('cross-origin-websocket', { ...websocket, browserMessages });
    const audit = await (await fetch(base + '/api/simulator/audit')).json();
    const reference = audit.find(entry => entry.event === 'proposed')?.payload.source_trace_id;
    if (!reference) { record('trace-discovery', { available: false }); result.completed = true; return; }
    const trace = await fetch(`${base}/api/agent/traces/${reference}`);
    record('trace-discovery', { source: 'anonymous audit → source_trace_id → trace', status: trace.status });
    for (let attempt = 1; attempt <= 2; attempt++) {
      const proposal = await fetch(base + '/api/simulator/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_trace_id: reference, intent: 'Hold the local demo value unchanged.' }) });
      if (proposal.status !== 200) { record('anonymous-proposal-and-reused-trace', { attempt, status: proposal.status }); continue; }
      const created = await proposal.json();
      record('anonymous-proposal-and-reused-trace', { attempt, status: proposal.status, proposalStatus: created.status });
      const decision = await fetch(`${base}/api/simulator/proposals/${created.id}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve: true, confirm: true, expected_revision: created.expected_revision }) });
      assert.equal(decision.status, 401);
      record('approval-boundary', { unauthenticatedDecisionStatus: decision.status });
    }
    result.completed = true;
  } catch (error) {
    result.error = String(error.stack ?? error);
    throw error;
  } finally {
    await foreign?.close();
    if (originServer) await new Promise(resolve => originServer.close(resolve));
    writeFileSync(resolve(directory, 'observations.json'), JSON.stringify(result, null, 2));
  }
}
