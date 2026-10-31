// The RM desk has MITRA's Sarvam voice agent call a customer, as the customer page does.
// A fake Sarvam stands in; nothing is dialled.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSession, takeTurn } from '../src/journeys/orchestrator.js';

const NOW = Date.parse('2026-10-31T10:00:00Z');
const data = mkdtempSync(path.join(tmpdir(), 'mitra-deskcall-'));
process.env.MITRA_DATA_DIR = data;
after(() => rmSync(data, { recursive: true, force: true }));
// Loaded only now: the store reads MITRA_DATA_DIR when it loads, and must never see the real data.
const { deskAgent, placeDeskCall, refreshDeskCall } = await import('../server/deskCall.mjs');

const ENV = {
  SARVAM_AGENT_API_KEY: 'sk_test', SARVAM_ORG_ID: 'org', SARVAM_WORKSPACE_ID: 'ws', SARVAM_AGENT_APP_ID: 'onboard', SARVAM_AGENT_APP_VERSION: '2',
  SARVAM_CONNECTION_ID: 'conn', SARVAM_AGENT_NUMBER: '+918000000000',
};
const BRIEF = { id: 'HB-26-1031-0007', why: 'The customer asked for a person.', asked: { english: 'handover to RM' }, next: 'Call back in Hindi', calls: [] };

function fakeSarvam({ attempts = [], transcript = [] } = {}) {
  const sent = [];
  const fetcher = async (url, init = {}) => {
    sent.push({ url, init });
    const out = url.includes('/outbounds') ? { attempt_id: 'att_1' } : url.includes('/attempts') ? { items: attempts } : { messages: transcript };
    return { ok: true, status: 200, json: async () => out };
  };
  return { fetcher, sent };
}

test('the same outbound call as the customer page, to the customer’s mobile, in their language', async () => {
  const { fetcher, sent } = fakeSarvam();
  const call = await placeDeskCall({ phone: '98765 43210', name: 'Ramesh K.', lang: 'hi', brief: BRIEF, rm: 'Priya' }, { env: ENV, fetcher, now: NOW });
  assert.match(sent[0].url, /\/outbounds\/v1\/orgs\/org\/workspaces\/ws\/outbounds$/);
  assert.equal(sent[0].init.headers['x-api-key'], 'sk_test');
  const body = JSON.parse(sent[0].init.body);
  assert.equal(body.user_config.user_phone_number, '+919876543210');
  assert.equal(body.app_config.app_id, 'onboard');
  assert.deepEqual(body.app_config.agent_variables, { customer_name: 'Ramesh K.', preferred_language: 'Hindi', work_known: 'unknown', city_known: 'unknown' }, 'only the variables the onboarding agent declares');
  assert.deepEqual({ to: call.to, status: call.status, by: call.by, agent: call.agent }, { to: '+91 ••••• 43210', status: 'calling', by: 'Priya', agent: 'onboarding' });
});

test('a follow-up agent made for RMs gets the case as well', async () => {
  const env = { ...ENV, SARVAM_RM_APP_ID: 'rm-follow', SARVAM_RM_APP_VERSION: '1' };
  assert.equal(deskAgent(env).own, true);
  const { fetcher, sent } = fakeSarvam();
  await placeDeskCall({ phone: '9876543210', name: 'Ramesh K.', lang: 'en', brief: BRIEF, rm: 'Priya' }, { env, fetcher, now: NOW });
  const body = JSON.parse(sent[0].init.body);
  assert.equal(body.app_config.app_id, 'rm-follow');
  assert.equal(body.app_config.agent_variables.case_id, BRIEF.id);
  assert.equal(body.app_config.agent_variables.rm_name, 'Priya');
});

test('no agent, no number, or a call already under way: nothing is dialled', async () => {
  const { fetcher, sent } = fakeSarvam();
  await assert.rejects(placeDeskCall({ phone: '9876543210', name: 'R', lang: 'en', brief: BRIEF, rm: 'P' }, { env: { ...ENV, SARVAM_CONNECTION_ID: '' }, fetcher, now: NOW }), /SARVAM_CONNECTION_ID/);
  await assert.rejects(placeDeskCall({ phone: '12345', name: 'R', lang: 'en', brief: BRIEF, rm: 'P' }, { env: ENV, fetcher, now: NOW }), /no mobile number/);
  const busy = { ...BRIEF, calls: [{ at: new Date(NOW).toISOString(), status: 'calling' }] };
  await assert.rejects(placeDeskCall({ phone: '9876543210', name: 'R', lang: 'en', brief: busy, rm: 'P' }, { env: ENV, fetcher, now: NOW }), /already under way/);
  assert.equal(sent.length, 0);
});

test('the result comes back from Sarvam: answered with a transcript, or not answered', async () => {
  const answered = { attemptId: 'att_1', placedAt: NOW, status: 'calling' };
  const { fetcher } = fakeSarvam({
    attempts: [{ attempt_id: 'att_1', connectivity_status: 'connected', end_datetime: '2026-10-31T10:03:00', duration_in_seconds: 95.2, interaction_id: 'int_1', agent_variables: { call_outcome: 'details_collected' } }],
    transcript: [{ role: 'assistant', en_text: 'Namaste, this is MITRA, an AI assistant.' }, { role: 'user', en_text: 'Yes, I asked for my RM.' }],
  });
  assert.equal(await refreshDeskCall(answered, { env: ENV, fetcher, now: NOW + 200_000 }), true);
  assert.equal(answered.status, 'connected');
  assert.equal(answered.duration, 95);
  assert.equal(answered.outcome, 'details_collected');
  assert.deepEqual(answered.transcript.map((turn) => turn.who), ['agent', 'customer']);
  assert.equal(await refreshDeskCall(answered, { env: ENV, fetcher, now: NOW + 400_000 }), false, 'a finished call is not asked about again');

  const missed = { attemptId: 'att_1', placedAt: NOW, status: 'calling' };
  await refreshDeskCall(missed, { env: ENV, fetcher: fakeSarvam({ attempts: [{ attempt_id: 'att_1', connectivity_status: 'no_answer', failure_reason: 'NO_FAILURE_REASON' }] }).fetcher, now: NOW + 60_000 });
  assert.equal(missed.status, 'no_answer');
});

test('from the desk: the number on the account is used, and the call is logged on the case', async () => {
  const session = createSession({ id: 'jrn-desk-call', customerId: 'ramesh', now: NOW });
  session.accountId = 'usr_1';
  session.lang = 'ta';
  await takeTurn(session, { text: 'handover to RM', textEn: 'handover to RM', lang: 'ta' }, { now: NOW, modelOff: true });
  writeFileSync(path.join(data, 'mitra.json'), JSON.stringify({ users: { usr_1: { id: 'usr_1', phone: '9876543210' } }, journeySessions: { [session.id]: JSON.parse(JSON.stringify(session)) } }));
  const { callFromDesk, deskBriefs, deskCallStatus } = await import('../server/journeyApi.mjs');

  const [brief] = await deskBriefs();
  assert.equal(brief.context.phoneOnFile, '+91 ••••• 43210');
  assert.equal(brief.context.lang, 'ta');

  const { fetcher, sent } = fakeSarvam({ attempts: [{ attempt_id: 'att_1', connectivity_status: 'busy' }] });
  const { call } = await callFromDesk(brief.id, { rm: 'Priya', customerPhone: '9111111111', sessionId: session.id }, { env: ENV, fetcher, now: NOW });
  assert.equal(JSON.parse(sent[0].init.body).user_config.user_phone_number, '+919876543210', 'the number on file wins over a typed one');
  assert.equal(JSON.parse(sent[0].init.body).app_config.agent_variables.preferred_language, 'Tamil');
  assert.equal(call.attemptId, undefined, 'Sarvam’s ids stay on the server');

  const status = await deskCallStatus(brief.id, call.id, { env: ENV, fetcher }, session.id);
  assert.equal(status.call.status, 'busy');
  const [after] = await deskBriefs();
  assert.equal(after.calls[0].status, 'busy');
  assert.equal(after.owner.name, 'Priya');
  assert.ok(!JSON.stringify(after).includes('9876543210'), 'the full number never reaches the desk');
});
