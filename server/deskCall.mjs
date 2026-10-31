// The RM desk asks MITRA's Sarvam voice agent to ring a customer, the same Instant
// Outbound call the customer page uses. The result is polled from Sarvam analytics and
// kept on the case, so it works with no public address. The key stays on this server.
import { randomBytes } from 'node:crypto';
import { agentSettings, LANGUAGE, plainFailure, pollAttempts, transcriptFor } from './agentCall.mjs';
import { normalisePhone } from './accounts.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });

const CALLS_PER_CASE_PER_DAY = 5;
const POLL_GAP_MS = 8_000;
const GIVE_UP_MS = 30 * 60_000;
// Sarvam writes the transcript shortly after the call ends; keep asking this long.
const READING_MS = 3 * 60_000;
const FINAL = new Set(['connected', 'no_answer', 'busy', 'failed', 'lost']);

// A separate agent for RM follow-ups can be set up on Sarvam; until then the
// onboarding agent is used, with only the variables it already declares.
export function deskAgent(env = process.env) {
  const settings = agentSettings(env);
  const own = Boolean(env.SARVAM_RM_APP_ID && env.SARVAM_RM_APP_VERSION);
  return {
    ...settings,
    appId: own ? env.SARVAM_RM_APP_ID : settings.appId,
    appVersion: own ? Number(env.SARVAM_RM_APP_VERSION) : settings.appVersion,
    own,
  };
}

export const maskPhone = (mobile) => (mobile ? `+91 ••••• ${mobile.slice(-5)}` : null);

export function deskOutbound({ agent, mobile, name, lang, brief, rm }) {
  const variables = { customer_name: name, preferred_language: LANGUAGE[lang] || 'English', work_known: 'unknown', city_known: 'unknown' };
  if (agent.own) Object.assign(variables, { rm_name: rm, case_id: brief.id, case_reason: brief.why, customer_question: brief.asked?.english || '', next_step: brief.next });
  return {
    app_config: {
      app_id: agent.appId, app_version: agent.appVersion,
      connection_config: { connection_id: agent.connectionId, agent_phone_number: agent.agentNumber },
      agent_variables: variables,
      app_overrides: { initial_language_name: LANGUAGE[lang] || 'English' },
    },
    user_config: { user_phone_number: `+91${mobile}` },
  };
}

export async function placeDeskCall({ phone, name, lang, brief, rm }, { env = process.env, fetcher = fetch, now = Date.now() } = {}) {
  const agent = deskAgent(env);
  if (!agent.configured) throw fail(409, `The Sarvam voice agent is not switched on. Missing from .env: ${agent.missing.join(', ')}.`);
  const mobile = normalisePhone(phone);
  if (!mobile) throw fail(422, 'There is no mobile number for this customer. Enter the 10-digit number they gave you.');
  const today = (brief.calls || []).filter((call) => now - Date.parse(call.at) < 86_400_000);
  if (today.length >= CALLS_PER_CASE_PER_DAY) throw fail(429, 'This customer has had enough calls today.');
  if (today.some((call) => !FINAL.has(call.status))) throw fail(409, 'A call to this customer is already under way.');
  const code = LANGUAGE[lang] ? lang : 'en';

  let res;
  try {
    res = await fetcher(`${agent.base}/outbounds/v1/orgs/${agent.org}/workspaces/${agent.workspace}/outbounds`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': agent.key },
      body: JSON.stringify(deskOutbound({ agent, mobile, name, lang: code, brief, rm })), signal: AbortSignal.timeout(15000),
    });
  } catch { throw fail(502, 'Could not reach Sarvam. Please try again.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.attempt_id) {
    console.error(`Sarvam outbound from the desk returned ${res.status}`);
    throw fail(502, 'Sarvam could not place the call. Please try again in a little while.');
  }
  return {
    id: `dcall_${randomBytes(6).toString('hex')}`, attemptId: data.attempt_id, by: rm, at: new Date(now).toISOString(), placedAt: now,
    to: maskPhone(mobile), lang: code, agent: agent.own ? 'rm' : 'onboarding', status: 'calling',
  };
}

const done = (call, now) => FINAL.has(call.status) && (call.status !== 'connected' || call.transcript?.length || now - (call.endedAt || now) > READING_MS);

// Asks Sarvam about one call, at most every few seconds. Returns true when the call changed.
export async function refreshDeskCall(call, { env = process.env, fetcher = fetch, now = Date.now() } = {}) {
  if (done(call, now) || now - (call.polledAt || 0) < POLL_GAP_MS) return false;
  const agent = deskAgent(env);
  if (!agent.configured) return false;
  call.polledAt = now;
  let items = [];
  try { items = await pollAttempts(agent, call.placedAt, fetcher); } catch { return true; }
  const item = items.find((attempt) => attempt.attempt_id === call.attemptId);
  const finished = item && (item.connectivity_status === 'connected' ? item.end_datetime : ['no_answer', 'busy', 'failed'].includes(item.connectivity_status));
  if (!finished) {
    if (now - call.placedAt > GIVE_UP_MS) Object.assign(call, { status: 'lost', endedAt: now, problem: 'Sarvam did not report on this call.' });
    return true;
  }
  const status = item.ended_by === 'VOICEMAIL' ? 'no_answer' : item.connectivity_status;
  Object.assign(call, { status, endedAt: call.endedAt || now, duration: Math.round(Number(item.duration_in_seconds) || 0) });
  if (status !== 'connected') call.problem = plainFailure(item.failure_reason === 'NO_FAILURE_REASON' ? null : item.failure_reason);
  if (status === 'connected') {
    call.outcome = item.agent_variables?.call_outcome || call.outcome || null;
    const transcript = item.interaction_id ? await transcriptFor(agent, item.interaction_id, fetcher) : [];
    if (transcript.length) {
      call.transcript = transcript.slice(0, 200).map((turn) => ({
        who: turn.role === 'user' ? 'customer' : 'agent',
        text: String(turn.en_text ?? turn.content ?? turn.text ?? '').slice(0, 600),
      })).filter((turn) => turn.text);
    }
  }
  return true;
}
