import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.MITRA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mitra-agent-call-'));
const agent = await import('../server/agentCall.mjs');
const accounts = await import('../server/accounts.mjs');
const { readStore } = await import('../server/store.mjs');

const ENV = {
  SARVAM_AGENT_API_KEY: 'k', SARVAM_ORG_ID: 'org', SARVAM_WORKSPACE_ID: 'ws', SARVAM_AGENT_APP_ID: 'app', SARVAM_AGENT_APP_VERSION: '3',
  SARVAM_CONNECTION_ID: 'conn', SARVAM_AGENT_NUMBER: '+918000000000', SARVAM_AGENTS_BASE: 'http://sarvam.test/api',
};
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

let phone = 9000000000;
async function freshUser() {
  phone += 1;
  const { user } = await accounts.signUp({ name: 'Asha Rao', phone: String(phone), pin: '4321' });
  return readStore((db) => db.users[user.id]);
}
const stored = (id) => readStore((db) => db.users[id]);

test('calls are off until every Sarvam setting is present', async () => {
  assert.equal(agent.agentSettings({}).configured, false);
  assert.equal(agent.agentSettings(ENV).configured, true);
  const user = await freshUser();
  await assert.rejects(agent.requestCall(user, { consent: true }, { env: {} }), { status: 409 });
});

test('a call needs consent, and rings the login number through the outbound API', async () => {
  const user = await freshUser();
  await assert.rejects(agent.requestCall(user, {}, { env: ENV }), { status: 422 });
  const seen = [];
  const fetcher = async (url, init) => { seen.push({ url, init }); return json(200, { attempt_id: 'att-1' }); };
  const call = await agent.requestCall(user, { consent: true, lang: 'ta' }, { env: { ...ENV, PUBLIC_HOST: 'mitra.example' }, fetcher });
  assert.equal(call.status, 'calling');
  assert.equal(seen[0].url, 'http://sarvam.test/api/outbounds/v1/orgs/org/workspaces/ws/outbounds');
  assert.equal(seen[0].init.headers['x-api-key'], 'k');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.user_config.user_phone_number, `+91${user.phone}`);
  assert.equal(body.app_config.app_id, 'app');
  assert.equal(body.app_config.app_version, 3);
  assert.equal(body.app_config.connection_config.connection_id, 'conn');
  assert.equal(body.app_config.app_overrides.initial_language_name, 'Tamil');
  assert.equal(body.app_config.agent_variables.customer_name, 'Asha Rao');
  assert.match(body.webhook_config.url, /^https:\/\/mitra\.example\/api\/voice-agent\/webhook\/[0-9a-f]{40}$/);
  assert.ok(!JSON.stringify(accounts.publicUser(await stored(user.id))).includes('att-1'), 'the attempt id stays on the server');
  await assert.rejects(agent.requestCall(await stored(user.id), { consent: true }, { env: ENV, fetcher }), { status: 409 });
});

test('a refused or unreachable call says so, without leaking why', async () => {
  const user = await freshUser();
  const refused = await agent.requestCall(user, { consent: true }, { env: ENV, fetcher: async () => json(403, { detail: 'secret detail' }) });
  assert.equal(refused.status, 'failed');
  assert.ok(!refused.problem.includes('secret'));
  const down = await agent.requestCall(await stored(user.id), { consent: true }, { env: ENV, fetcher: async () => { throw new Error('down'); } });
  assert.equal(down.status, 'failed');
});

test('a webhook brings the details in, and nothing counts until the customer confirms', async () => {
  const user = await freshUser();
  const fetcher = async () => json(200, { attempt_id: 'att-2' });
  const placed = await agent.requestCall(user, { consent: true }, { env: ENV, fetcher });
  assert.equal(await agent.recordWebhook({ attempt_id: 'someone-else', status: 'connected', final_agent_variables: { monthly_income: '1 lakh' } }), false);
  const delivered = await agent.recordWebhook({
    attempt_id: 'att-2', status: 'connected', duration: 92.4, interaction_id: '20261031/x',
    webhook_config: { metadata: { callId: placed.id } },
    final_agent_variables: { work_type: 'gig', city: ' Bengaluru ', monthly_income: '45 thousand', dependants: '3', existing_life_cover: '10 lakh', existing_health_cover: 'none', main_goal: 'A term plan', preferred_language: 'Tamil' },
    interaction_transcript: [{ role: 'agent', en_text: 'Hello Asha' }, { role: 'user', en_text: 'Yes, this is Asha' }],
  });
  assert.equal(delivered, true);
  let now = await stored(user.id);
  assert.deepEqual(now.agentCall.details, { name: null, city: 'Bengaluru', lang: 'ta', work: 'gig', income: 45000, dependants: 3, existingLife: 1000000, existingHealth: 0, goal: 'A term plan', doubts: [] });
  assert.equal(now.agentCall.transcript[1].who, 'you');
  assert.ok(!now.work);
  assert.equal(now.spoken, undefined);
  assert.equal(accounts.carriedSpoken(now), null);

  // The customer corrects one line, and that is what is kept.
  const out = await accounts.confirmCall(now, { accept: true, edits: { income: '50000' } });
  assert.equal(out.spoken.income, 50000);
  assert.equal(out.work, 'gig');
  assert.equal(out.city, 'Bengaluru');
  assert.equal(out.lang, 'ta');
  now = await stored(user.id);
  assert.equal(accounts.carriedSpoken(now).dependants, 3);
  await assert.rejects(accounts.confirmCall(now, { accept: true }), { status: 409 });
});

test('discarding keeps nothing, and a bad figure on screen is refused', async () => {
  const user = await freshUser();
  await agent.requestCall(user, { consent: true }, { env: ENV, fetcher: async () => json(200, { attempt_id: 'att-3' }) });
  await agent.recordWebhook({ attempt_id: 'att-3', status: 'connected', final_agent_variables: { monthly_income: '45000', city: 'Pune' }, interaction_transcript: [{ role: 'user', en_text: 'Pune' }] });
  await assert.rejects(accounts.confirmCall(await stored(user.id), { accept: true, edits: { income: 'lots' } }), { status: 422 });
  await accounts.confirmCall(await stored(user.id), { accept: false });
  const now = await stored(user.id);
  assert.equal(now.agentCall.details, null);
  assert.deepEqual(now.agentCall.transcript, []);
  assert.equal(now.spoken, undefined);
  assert.ok(!now.city);
});

test('no answer, busy and Do Not Disturb are reported plainly', async () => {
  const user = await freshUser();
  await agent.requestCall(user, { consent: true }, { env: ENV, fetcher: async () => json(200, { attempt_id: 'att-4' }) });
  await agent.recordWebhook({ attempt_id: 'att-4', status: 'no_answer', duration: null, final_agent_variables: null });
  assert.equal((await stored(user.id)).agentCall.status, 'no_answer');
  await agent.requestCall(await stored(user.id), { consent: true }, { env: ENV, fetcher: async () => json(200, { attempt_id: 'att-5' }) });
  await agent.recordWebhook({ attempt_id: 'att-5', status: 'failed', failure_reason: 'exotel: Phone number is registered under TRAI NDNC' });
  assert.match((await stored(user.id)).agentCall.problem, /Do Not Disturb/);
});

test('a later call waits for its time, and polling works with no public address', async () => {
  const user = await freshUser();
  const start = Date.now();
  const dials = [];
  const fetcher = async (url) => {
    if (url.includes('/outbounds')) { dials.push(url); return json(200, { attempt_id: 'att-6' }); }
    if (url.includes('/attempts')) return json(200, { items: [{ attempt_id: 'att-6', connectivity_status: 'connected', end_datetime: '2026-10-31T10:00:00', interaction_id: '20261031/y', duration_in_seconds: 60, failure_reason: 'NO_FAILURE_REASON', agent_variables: { monthly_income: '30000', dependants: 'wife and 2 kids' } }] });
    if (url.includes('/transcripts/20261031/y')) return json(200, { messages: [{ role: 'assistant', content: 'Namaste' }, { role: 'user', content: 'Haan' }] });
    throw new Error(`unexpected ${url}`);
  };
  const later = new Date(start + 3600000).toISOString();
  assert.equal((await agent.requestCall(user, { consent: true, when: later }, { env: ENV, fetcher, now: start })).status, 'scheduled');
  await agent.runDueCalls({ env: ENV, fetcher, now: start + 60000 });
  assert.equal(dials.length, 0);
  await assert.rejects(agent.requestCall(await stored(user.id), { consent: true }, { env: ENV, fetcher }), { status: 409 });
  await agent.runDueCalls({ env: ENV, fetcher, now: start + 3700000 });
  assert.equal(dials.length, 1);
  await agent.runDueCalls({ env: ENV, fetcher, now: start + 3760000 });
  const call = (await stored(user.id)).agentCall;
  assert.equal(call.status, 'connected');
  assert.equal(call.details.income, 30000);
  assert.equal(call.details.dependants, 3);
  assert.equal(call.transcript[0].text, 'Namaste');
  await assert.rejects(agent.requestCall(user, { consent: true, when: new Date(start + 30 * 86400000).toISOString() }, { env: ENV, fetcher, now: start }), { status: 422 });
});

test('answers that arrive after the call has ended still reach the screen', async () => {
  const user = await freshUser();
  let variables = { customer_name: 'Asha Rao', preferred_language: 'Hindi', monthly_income: '', city: '' };
  const fetcher = async (url) => {
    if (url.includes('/outbounds')) return json(200, { attempt_id: 'att-r' });
    if (url.includes('/attempts')) return json(200, { items: [{ attempt_id: 'att-r', connectivity_status: 'connected', end_datetime: '2026-10-31T10:00:00', interaction_id: '20261031/r', duration_in_seconds: 60, failure_reason: 'NO_FAILURE_REASON', agent_variables: variables }] });
    return json(200, { messages: [{ role: 'assistant', content: 'Namaste' }] });
  };
  await agent.requestCall(user, { consent: true }, { env: ENV, fetcher });
  await agent.runDueCalls({ env: ENV, fetcher });
  let view = agent.publicCall(await stored(user.id));
  assert.equal(view.status, 'connected');
  assert.equal(view.reading, true, 'the name and language sent to the agent are not answers');
  variables = { ...variables, monthly_income: '45000', city: 'Pune' };
  await agent.runDueCalls({ env: ENV, fetcher });
  view = agent.publicCall(await stored(user.id));
  assert.equal(view.reading, false);
  assert.equal(view.details.income, 45000);
  assert.equal(view.details.city, 'Pune');
  variables = { monthly_income: '1' };
  await agent.runDueCalls({ env: ENV, fetcher });
  assert.equal(agent.publicCall(await stored(user.id)).details.income, 45000, 'a settled answer is not asked for again');
});

test('a call under way is not reported as failed, and a voicemail counts as no answer', async () => {
  const user = await freshUser();
  let item = { attempt_id: 'att-v', connectivity_status: 'ringing' };
  const fetcher = async (url) => (url.includes('/outbounds') ? json(200, { attempt_id: 'att-v' }) : json(200, { items: [item], messages: [] }));
  await agent.requestCall(user, { consent: true }, { env: ENV, fetcher });
  await agent.runDueCalls({ env: ENV, fetcher });
  assert.equal((await stored(user.id)).agentCall.status, 'calling');
  item = { attempt_id: 'att-v', connectivity_status: 'connected', ended_by: 'VOICEMAIL', end_datetime: '2026-10-31T10:00:00', interaction_id: '20261031/v', agent_variables: {} };
  await agent.runDueCalls({ env: ENV, fetcher });
  assert.equal((await stored(user.id)).agentCall.status, 'no_answer');
});

test('a due call rings on the quick tick, which leaves Sarvam reporting alone', async () => {
  const user = await freshUser();
  const start = Date.now();
  const asked = [];
  const fetcher = async (url) => { asked.push(url); return url.includes('/outbounds') ? json(200, { attempt_id: 'att-q' }) : json(200, { items: [] }); };
  await agent.requestCall(user, { consent: true, when: new Date(start + 120000).toISOString() }, { env: ENV, fetcher, now: start });
  await agent.runDueCalls({ env: ENV, fetcher, now: start + 119000, poll: false });
  assert.equal(asked.length, 0, 'not before its time');
  await agent.runDueCalls({ env: ENV, fetcher, now: start + 120000, poll: false });
  assert.equal(asked.length, 1);
  assert.match(asked[0], /outbounds/);
  await agent.runDueCalls({ env: ENV, fetcher, now: start + 125000, poll: false });
  assert.equal(asked.length, 1, 'rings once, and does not poll');
});

test('a call one minute away waits, and the screen can name the number it rings', async () => {
  const user = await freshUser();
  const start = Date.now();
  const call = await agent.requestCall(user, { consent: true, when: new Date(start + 59000).toISOString() }, { env: ENV, fetcher: async () => { throw new Error('must not ring yet'); }, now: start });
  assert.equal(call.status, 'scheduled');
  assert.equal(accounts.publicUser(user).phoneFull, `+91 ${user.phone.slice(0, 5)} ${user.phone.slice(5)}`);
  await agent.runDueCalls({ env: ENV, fetcher: async () => json(200, { attempt_id: 'att-to' }), now: start + 60000, poll: false });
  assert.equal(agent.publicCall(await stored(user.id)).to, accounts.publicUser(user).phoneFull);
});

test('five calls a day is the limit, and a cancelled call never rings', async () => {
  const user = await freshUser();
  const fetcher = async () => json(200, { attempt_id: 'att-c' });
  await agent.requestCall(user, { consent: true, when: new Date(Date.now() + 3600000).toISOString() }, { env: ENV, fetcher });
  assert.equal((await agent.cancelCall(user)).status, 'cancelled');
  await agent.runDueCalls({ env: ENV, fetcher: async () => { throw new Error('must not ring'); }, now: Date.now() + 7200000 });
  for (let at = 0; at < 4; at += 1) {
    await agent.requestCall(await stored(user.id), { consent: true }, { env: ENV, fetcher: async () => json(500, {}) });
  }
  await assert.rejects(agent.requestCall(await stored(user.id), { consent: true }, { env: ENV, fetcher }), { status: 429 });
});

test('the login number changes only with the PIN, and sign-in follows it', async () => {
  const user = await freshUser();
  const other = await freshUser();
  await assert.rejects(accounts.changePhone(user, { phone: '9876512345', pin: '0000' }), { status: 401 });
  await assert.rejects(accounts.changePhone(user, { phone: 'abc', pin: '4321' }), { status: 422 });
  await assert.rejects(accounts.changePhone(user, { phone: other.phone, pin: '4321' }), { status: 409 });
  const out = await accounts.changePhone(user, { phone: '+91 98765 12345', pin: '4321' });
  assert.equal(out.phone, '+91 ••••• 12345');
  await assert.rejects(accounts.signIn({ phone: user.phone, pin: '4321' }));
  assert.equal((await accounts.signIn({ phone: '9876512345', pin: '4321' })).user.id, user.id);
});

test('unbelievable answers are never filled in, and the customer sees what was heard', async () => {
  // The answers from a real test call on 2026-10-31.
  const variables = { work_type: 'other', city: 'Goutham City', monthly_income: '999', dependants: '900', existing_life_cover: '90000000', existing_health_cover: '990000000', main_goal: 'Loan of 90 lakhs', call_outcome: 'details_collected' };
  const read = agent.readAgentDetails(variables);
  assert.deepEqual([read.income, read.dependants, read.existingLife, read.existingHealth], [null, null, null, null]);
  assert.deepEqual(read.doubts, [{ field: 'income', said: 999 }, { field: 'dependants', said: 900 }, { field: 'existingLife', said: 90000000 }, { field: 'existingHealth', said: 990000000 }]);

  const user = await freshUser();
  await agent.requestCall(user, { consent: true }, { env: ENV, fetcher: async () => json(200, { attempt_id: 'att-d' }) });
  await agent.recordWebhook({ attempt_id: 'att-d', status: 'connected', final_agent_variables: variables, interaction_transcript: [] });
  const view = agent.publicCall(await stored(user.id));
  assert.equal(view.doubtful, true, 'the agent called it a success, and the app still warns');
  assert.equal(view.reading, false);
  const out = await accounts.confirmCall(await stored(user.id), { accept: true, edits: { income: '', dependants: '', existingLife: '', existingHealth: '' } });
  assert.deepEqual([out.spoken.income, out.spoken.dependants, out.spoken.existingLife, out.spoken.existingHealth], [null, null, null, null]);
});

test('ordinary answers pass, and one odd answer does not condemn the call', () => {
  const read = agent.readAgentDetails({ monthly_income: '45000', dependants: '5', existing_life_cover: '10 lakh', existing_health_cover: 'none' });
  assert.deepEqual(read.doubts, []);
  assert.equal(read.existingLife, 1000000);
  const odd = agent.readAgentDetails({ monthly_income: '45000', dependants: '90', existing_life_cover: '10 lakh' });
  assert.deepEqual(odd.doubts, [{ field: 'dependants', said: 90 }]);
  assert.equal(odd.income, 45000);
  assert.equal(agent.readAgentDetails({ monthly_income: '20 thousand', existing_life_cover: '5 crore' }).existingLife, null, 'a cover far beyond the income is doubted');
});

test('what the agent says is checked, not trusted', () => {
  const read = agent.readAgentDetails;
  assert.equal(read({ monthly_income: '12' }).income, null);
  assert.equal(read({ monthly_income: 'Rs 45,000 a month' }).income, 45000);
  assert.equal(read({ existing_life_cover: 'no' }).existingLife, 0);
  assert.equal(read({ dependants: '99' }).dependants, null);
  assert.equal(read({ city: 'NA' }).city, null);
  assert.equal(read({ preferred_language: 'Klingon' }).lang, null);
  assert.equal(read({ work_type: 'I drive a cab' }).work, 'gig');
  const { doubts, ...nothing } = read(null);
  assert.deepEqual(doubts, []);
  assert.deepEqual(Object.values(nothing).filter((value) => value !== null), []);
});
