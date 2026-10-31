import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let child, api, data;
before(async () => {
  data = mkdtempSync(path.join(tmpdir(), 'mitra-prod-'));
  child = spawn('node', ['server/index.mjs'], { env: { PATH: process.env.PATH, PORT: '0', MITRA_DATA_DIR: data, MITRA_DESK_TOKEN: 'staff' }, stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve) => child.stdout.on('data', (chunk) => { const found = String(chunk).match(/:(\d+)$/m); if (found) resolve(found[1]); }));
  api = `http://127.0.0.1:${port}`;
});
after(() => { child.kill(); rmSync(data, { recursive: true, force: true }); });

const post = (route, body = {}) => fetch(`${api}/api/journey${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('every response carries security headers and a request id', async () => {
  const res = await fetch(`${api}/api/health`);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(res.headers.get('x-request-id'));
});

test('readiness says it is degraded, instead of pretending', async () => {
  const body = await (await fetch(`${api}/api/ready`)).json();
  assert.equal(body.ready, true);
  assert.equal(body.sarvamConfigured, false);
  assert.match(body.note, /engines and rules/);
});

test('with no provider at all, the engines still answer with real figures', async () => {
  const { state } = await (await post('/session', { customerId: 'ramesh' })).json();
  const turn = await (await post(`/${state.sessionId}/turn`, { text: 'What does this loan really cost?' })).json();
  assert.equal(turn.tool, 'explain_loan_offer');
  assert.match(turn.reply.english, /17\.7%/);
});

test('erasing a journey removes it, and leaves only a tombstone', async () => {
  const { state } = await (await post('/session', { customerId: 'ramesh' })).json();
  await post(`/${state.sessionId}/turn`, { text: 'My monthly income is 45,000' });
  const erased = await (await fetch(`${api}/api/journey/${state.sessionId}`, { method: 'DELETE' })).json();
  assert.ok(erased.erasedAt);
  assert.ok(erased.receipts >= 1);
  assert.equal(erased.customer, undefined);
  assert.equal((await fetch(`${api}/api/journey/${state.sessionId}/state`)).status, 410);
});

test('the expert desk needs a staff token when one is set', async () => {
  assert.equal((await fetch(`${api}/api/journey/desk`)).status, 401);
  assert.equal((await fetch(`${api}/api/journey/desk`, { headers: { 'x-desk-token': 'staff' } })).status, 200);
});

test('a forged forwarded address does not dodge the rate limit', async () => {
  const hit = () => fetch(`${api}/api/journey/phone-status`, { headers: { 'x-forwarded-for': `9.9.9.${Math.floor(Math.random() * 255)}` } });
  const statuses = [];
  for (let i = 0; i < 260; i++) statuses.push((await hit()).status);
  assert.ok(statuses.includes(429));
});

test('metrics are served in Prometheus format', async () => {
  const text = await (await fetch(`${api}/api/ops/metrics?format=prometheus`)).text();
  assert.match(text, /mitra_turns_total/);
});
