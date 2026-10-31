// The onboarding call: a Sarvam voice agent rings the customer, asks a few questions,
// and what it heard comes back here. Nothing it heard is used until the customer has
// seen it on screen and said yes. Instant Outbound API; the key stays on this server.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readStore, updateStore } from './store.mjs';
import { parseAmount, parseDependants } from '../src/journeys/money.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const newId = () => `call_${randomBytes(8).toString('hex')}`;

const DAILY_CALLS = 5;
const LATEST_LATER_DAYS = 14;
// A call nobody has reported on after this long is treated as lost.
const GIVE_UP_MS = 30 * 60_000;
// Due calls are looked for often, so one rings when its countdown ends. Sarvam is asked less.
const SCHEDULER_MS = 5_000;
const POLL_EVERY_TICKS = 4;
// Sarvam fills the answers in from the transcript shortly after the call ends, so a
// report can arrive before them. Keep asking for this long before accepting it has none.
const READING_MS = 3 * 60_000;

const ACTIVE = new Set(['scheduled', 'placing', 'calling']);
const ANSWERS = ['city', 'work', 'income', 'dependants', 'existingLife', 'existingHealth', 'goal'];
const heardAnything = (details) => ANSWERS.some((name) => details?.[name] != null) || Boolean(details?.doubts?.length);
// Past these, an answer is more likely misheard or not serious than true. It is not
// refused: the customer can still type it in, knowing what they are confirming.
const MOST_DEPENDANTS = 12;
const LOWEST_INCOME = 3000;
const HIGHEST_INCOME = 1000000;
const HIGHEST_COVER = 50000000;
const COVER_YEARS_OF_INCOME = 100;
const stillReading = (call, now = Date.now()) => call.status === 'connected' && !call.decided && !heardAnything(call.details) && now - (call.endedAt || now) < READING_MS;

const LANGUAGE = { en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', od: 'Odia' };
const LANG_BY_NAME = Object.fromEntries(Object.entries(LANGUAGE).map(([code, name]) => [name.toLowerCase(), code]));
const WORK_WORDS = [['gig', /\b(gig|deliver|driv|rider|freelanc|cab|auto)/i], ['shop', /\b(shop|store|kirana|business|stall|trade|dukan)/i], ['salaried', /\b(salar|job|employ|office)/i], ['other', /\b(other|else)/i]];

const NEEDED = ['SARVAM_AGENT_API_KEY', 'SARVAM_ORG_ID', 'SARVAM_WORKSPACE_ID', 'SARVAM_AGENT_APP_ID', 'SARVAM_AGENT_APP_VERSION', 'SARVAM_CONNECTION_ID', 'SARVAM_AGENT_NUMBER'];

export function agentSettings(env = process.env) {
  const missing = NEEDED.filter((name) => !env[name]);
  return {
    configured: missing.length === 0,
    missing,
    base: (env.SARVAM_AGENTS_BASE || 'https://apps.sarvam.ai/api').replace(/\/$/, ''),
    key: env.SARVAM_AGENT_API_KEY,
    org: env.SARVAM_ORG_ID,
    workspace: env.SARVAM_WORKSPACE_ID,
    appId: env.SARVAM_AGENT_APP_ID,
    appVersion: Number(env.SARVAM_AGENT_APP_VERSION),
    connectionId: env.SARVAM_CONNECTION_ID,
    agentNumber: env.SARVAM_AGENT_NUMBER,
    publicHost: env.PUBLIC_HOST || null,
  };
}

const hookToken = (key) => createHash('sha256').update(`mitra-agent-webhook:${key}`).digest('hex').slice(0, 40);

export function outboundRequest(user, call, settings) {
  const body = {
    app_config: {
      app_id: settings.appId,
      app_version: settings.appVersion,
      connection_config: { connection_id: settings.connectionId, agent_phone_number: settings.agentNumber },
      agent_variables: { customer_name: user.name, preferred_language: LANGUAGE[call.lang] || 'English', work_known: user.work || 'unknown', city_known: user.city || 'unknown' },
      app_overrides: { initial_language_name: LANGUAGE[call.lang] || 'English' },
    },
    user_config: { user_phone_number: `+91${user.phone}` },
  };
  if (settings.publicHost) {
    body.webhook_config = { url: `https://${settings.publicHost}/api/voice-agent/webhook/${hookToken(settings.key)}`, metadata: { callId: call.id } };
  }
  return body;
}

// What the agent says it heard, checked and turned into fields. Anything unclear is left
// empty, and anything unbelievable is left empty with a note of what was said.
export function readAgentDetails(vars) {
  const text = (name) => {
    const value = vars?.[name];
    if (value == null) return null;
    const clean = String(value).replace(/\s+/g, ' ').trim().slice(0, 120);
    return clean && !/^(na|n\/a|none given|unknown|not provided|null)$/i.test(clean) ? clean : null;
  };
  const amount = (name) => {
    const said = text(name);
    if (said == null) return null;
    return /^(no|none|nothing|zero|nil)\b/i.test(said) ? 0 : parseAmount(said);
  };
  const dependantsSaid = text('dependants');
  // parseDependants reads up to two digits, and 900 still has to be seen to be doubted.
  const dependants = dependantsSaid == null ? null : parseDependants(dependantsSaid) ?? (/^\d+$/.test(dependantsSaid) ? Number(dependantsSaid) : null);
  const income = amount('monthly_income');
  const doubts = [];
  const believable = (field, value, ok) => {
    if (value == null || ok) return value;
    doubts.push({ field, said: value });
    return null;
  };
  const cover = (field, value) => believable(field, value, value <= HIGHEST_COVER && (!income || value <= income * 12 * COVER_YEARS_OF_INCOME));
  const langSaid = text('preferred_language');
  const workSaid = text('work_type');
  return {
    name: text('customer_name'),
    city: text('city'),
    lang: langSaid ? LANG_BY_NAME[langSaid.toLowerCase()] || null : null,
    work: workSaid ? WORK_WORDS.find(([, words]) => words.test(workSaid))?.[0] || null : null,
    income: believable('income', income, income >= LOWEST_INCOME && income <= HIGHEST_INCOME),
    dependants: believable('dependants', dependants, dependants >= 0 && dependants <= MOST_DEPENDANTS),
    existingLife: cover('existingLife', amount('existing_life_cover')),
    existingHealth: cover('existingHealth', amount('existing_health_cover')),
    goal: text('main_goal'),
    doubts,
  };
}

function normaliseStatus(status, endedBy) {
  if (endedBy === 'VOICEMAIL') return 'no_answer';
  if (status === 'connected') return 'connected';
  if (status === 'no_answer' || status === 'busy') return status;
  return 'failed';
}

const plainFailure = (reason) => {
  const text = String(reason || '');
  if (/NDNC|DND/i.test(text)) return 'This number is on the Do Not Disturb list, so it cannot be called.';
  return text ? 'The call could not be placed. Please try again in a little while.' : null;
};

export function publicCall(user) {
  const call = user?.agentCall;
  if (!call) return null;
  return {
    id: call.id, status: call.status, to: call.to ? `+91 ${call.to.slice(0, 5)} ${call.to.slice(5)}` : null, lang: call.lang, requestedAt: call.requestedAt, scheduledFor: call.scheduledFor || null,
    endedAt: call.endedAt || null, duration: call.duration ?? null, problem: call.problem || null,
    details: call.details || null, transcript: call.transcript || [], decided: call.decided || null, reading: stillReading(call),
    doubtful: call.outcome === 'answers_doubtful' || (call.details?.doubts?.length || 0) >= 2,
  };
}

export function agentCallReady(env = process.env) {
  return agentSettings(env).configured;
}

async function dial(userId, callId, settings, fetcher = fetch) {
  const user = await readStore((db) => db.users?.[userId] || null);
  if (!user?.agentCall || user.agentCall.id !== callId) return;
  const body = outboundRequest(user, user.agentCall, settings);
  let attemptId = null;
  let problem = null;
  try {
    const res = await fetcher(`${settings.base}/outbounds/v1/orgs/${settings.org}/workspaces/${settings.workspace}/outbounds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': settings.key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.attempt_id) {
      console.error(`Sarvam outbound returned ${res.status}`);
      problem = 'The call could not be placed. Please try again in a little while.';
    } else attemptId = data.attempt_id;
  } catch {
    problem = 'Could not reach the calling service. Please try again.';
  }
  await updateStore((db) => {
    const stored = db.users?.[userId];
    if (!stored?.agentCall || stored.agentCall.id !== callId) return;
    if (attemptId) {
      stored.agentCall.attemptId = attemptId;
      stored.agentCall.to = user.phone;
      // A very fast webhook may already have closed this call.
      if (ACTIVE.has(stored.agentCall.status)) stored.agentCall.status = 'calling';
      stored.agentCall.placedAt = Date.now();
    } else {
      stored.agentCall.status = 'failed';
      stored.agentCall.problem = problem;
      stored.agentCall.endedAt = Date.now();
    }
  });
}

export async function requestCall(user, { consent, when, lang } = {}, { env = process.env, fetcher = fetch, now = Date.now() } = {}) {
  const settings = agentSettings(env);
  if (!settings.configured) throw fail(409, 'Phone calls are not switched on for this server yet.');
  if (consent !== true) throw fail(422, 'Please agree to the call first.');
  if (!user.phone) throw fail(422, 'Add your mobile number first.');
  const code = LANGUAGE[lang] ? lang : user.lang || 'en';
  let scheduledFor = null;
  if (when && when !== 'now') {
    scheduledFor = Date.parse(when);
    if (!Number.isFinite(scheduledFor)) throw fail(422, 'Please pick a valid time.');
    if (scheduledFor < now + 30_000) scheduledFor = null;
    else if (scheduledFor > now + LATEST_LATER_DAYS * 86_400_000) throw fail(422, `Please pick a time in the next ${LATEST_LATER_DAYS} days.`);
  }
  const callId = newId();
  await updateStore((db) => {
    const stored = db.users?.[user.id];
    if (!stored) throw fail(404, 'Account not found');
    if (stored.agentCall && ACTIVE.has(stored.agentCall.status)) throw fail(409, 'A call is already on its way. Please finish that one first.');
    const recent = (stored.agentCallLog || []).filter((at) => now - at < 86_400_000);
    if (recent.length >= DAILY_CALLS) throw fail(429, 'That is enough calls for today. Please try again tomorrow.');
    stored.agentCallLog = [...recent, now];
    stored.agentCall = {
      id: callId, status: scheduledFor ? 'scheduled' : 'placing', lang: code, requestedAt: now, scheduledFor,
      consent: { words: 'Agreed on screen to a call from MITRA about setting up this account', at: new Date(now).toISOString() },
    };
  });
  if (!scheduledFor) await dial(user.id, callId, settings, fetcher);
  return readStore((db) => publicCall(db.users?.[user.id]));
}

export async function cancelCall(user) {
  return updateStore((db) => {
    const stored = db.users?.[user.id];
    if (stored?.agentCall?.status === 'scheduled') { stored.agentCall.status = 'cancelled'; stored.agentCall.endedAt = Date.now(); }
    return publicCall(stored);
  });
}

// One report on a call, from the webhook or from polling. Reports may repeat.
function settle(stored, report) {
  const call = stored.agentCall;
  const status = normaliseStatus(report.status, report.endedBy);
  if (call.decided || (call.status !== 'connected' && call.status !== 'calling' && call.status !== 'placing')) return;
  // Keep what is already known if a thinner report follows.
  if (call.status === 'connected' && (status !== 'connected' || heardAnything(call.details))) return;
  call.status = status;
  call.endedAt = call.endedAt || Date.now();
  if (report.duration != null) call.duration = Number(report.duration) || 0;
  if (report.interactionId) call.interactionId = report.interactionId;
  call.problem = status === 'connected' ? null : plainFailure(report.failure) || call.problem || null;
  if (status === 'connected') {
    if (report.variables) {
      call.details = readAgentDetails(report.variables);
      call.outcome = report.variables.call_outcome || null;
    }
    if (Array.isArray(report.transcript) && report.transcript.length > (call.transcript?.length || 0)) {
      call.transcript = report.transcript.slice(0, 200).map((turn) => ({
        who: turn.role === 'user' ? 'you' : 'mitra',
        text: String(turn.en_text ?? turn.content ?? turn.text ?? '').slice(0, 600),
      })).filter((turn) => turn.text);
    }
  }
}

export async function recordWebhook(payload) {
  const callId = payload?.webhook_config?.metadata?.callId;
  const attemptId = payload?.attempt_id;
  if (!callId && !attemptId) return false;
  return updateStore((db) => {
    const stored = Object.values(db.users || {}).find((user) => {
      const call = user.agentCall;
      if (!call) return false;
      return attemptId && call.attemptId ? call.attemptId === attemptId : call.id === callId;
    });
    if (!stored) return false;
    settle(stored, {
      status: payload.status, duration: payload.duration, interactionId: payload.interaction_id, failure: payload.failure_reason,
      variables: payload.final_agent_variables, transcript: payload.interaction_transcript,
    });
    return true;
  });
}

async function pollAttempts(settings, since, fetcher) {
  const query = new URLSearchParams({
    start_datetime: new Date(since - 300_000).toISOString(), end_datetime: new Date(Date.now() + 60_000).toISOString(),
    sort_by: 'attempted_at', sort_order: 'desc', limit: '100',
  });
  const res = await fetcher(`${settings.base}/analytics/v1/${settings.org}/${settings.workspace}/${settings.appId}/attempts?${query}`, {
    headers: { 'x-api-key': settings.key }, signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Sarvam analytics returned ${res.status}`);
  return (await res.json()).items || [];
}

async function transcriptFor(settings, interactionId, fetcher) {
  try {
    const res = await fetcher(`${settings.base}/analytics/v1/${settings.org}/${settings.workspace}/${settings.appId}/transcripts/${interactionId}`, {
      headers: { 'x-api-key': settings.key }, signal: AbortSignal.timeout(15000),
    });
    return res.ok ? (await res.json()).messages || [] : [];
  } catch { return []; }
}

// Dials what has come due, and asks Sarvam about calls with no report yet. Polling is
// what makes this work with no public address: the webhook only makes it quicker.
export async function runDueCalls({ env = process.env, fetcher = fetch, now = Date.now(), poll = true } = {}) {
  const settings = agentSettings(env);
  if (!settings.configured) return;
  const users = await readStore((db) => Object.values(db.users || {}).filter((user) => user.agentCall && (ACTIVE.has(user.agentCall.status) || stillReading(user.agentCall, now))).map((user) => ({ id: user.id, call: user.agentCall })));
  for (const { id, call } of users) {
    if (call.status === 'scheduled' && call.scheduledFor <= now) {
      const claimed = await updateStore((db) => {
        const stored = db.users?.[id];
        if (stored?.agentCall?.id !== call.id || stored.agentCall.status !== 'scheduled') return false;
        stored.agentCall.status = 'placing';
        return true;
      });
      if (claimed) await dial(id, call.id, settings, fetcher);
    }
  }
  const waiting = users.filter(({ call }) => (call.status === 'calling' || call.status === 'connected') && call.attemptId);
  if (!poll || !waiting.length) return;
  let items = [];
  try {
    items = await pollAttempts(settings, Math.min(...waiting.map(({ call }) => call.placedAt || now)), fetcher);
  } catch { /* the next pass asks again */ }
  for (const { id, call } of waiting) {
    const item = items.find((attempt) => attempt.attempt_id === call.attemptId);
    // Any other status means the call is still under way.
    const finished = item && (item.connectivity_status === 'connected' ? item.end_datetime : ['no_answer', 'busy', 'failed'].includes(item.connectivity_status));
    if (finished) {
      const transcript = item.connectivity_status === 'connected' && item.interaction_id ? await transcriptFor(settings, item.interaction_id, fetcher) : [];
      await updateStore((db) => {
        const stored = db.users?.[id];
        if (stored?.agentCall?.id !== call.id) return;
        settle(stored, {
          status: item.connectivity_status, endedBy: item.ended_by, duration: item.duration_in_seconds, interactionId: item.interaction_id,
          failure: item.failure_reason === 'NO_FAILURE_REASON' ? null : item.failure_reason, variables: item.agent_variables, transcript,
        });
      });
    } else if (call.status === 'calling' && now - (call.placedAt || now) > GIVE_UP_MS) {
      await updateStore((db) => {
        const stored = db.users?.[id];
        if (stored?.agentCall?.id === call.id && stored.agentCall.status === 'calling') {
          stored.agentCall.status = 'lost';
          stored.agentCall.problem = 'We did not hear back about this call. Please try again.';
          stored.agentCall.endedAt = now;
        }
      });
    }
  }
}

export function startCallScheduler() {
  if (!agentCallReady()) return null;
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    runDueCalls({ poll: tick % POLL_EVERY_TICKS === 0 }).catch((error) => console.error('Call scheduler', error.message));
  }, SCHEDULER_MS);
  timer.unref();
  return timer;
}

// Details are saved only as the customer left them on screen.
export function cleanConfirmed(edits, known) {
  const number = (value, low, high) => {
    if (value === '' || value == null) return null;
    const parsed = Number(String(value).replace(/[, ]/g, ''));
    if (!Number.isFinite(parsed) || parsed < low || parsed > high) throw fail(422, 'One of those numbers does not look right. Please check it.');
    return Math.round(parsed);
  };
  const merged = { ...known, ...edits };
  return {
    city: merged.city ? String(merged.city).trim().slice(0, 40) : null,
    work: ['gig', 'shop', 'salaried', 'other'].includes(merged.work) ? merged.work : null,
    lang: LANGUAGE[merged.lang] ? merged.lang : null,
    income: number(merged.income, 100, 100000000),
    dependants: number(merged.dependants, 0, 20),
    existingLife: number(merged.existingLife, 0, 500000000),
    existingHealth: number(merged.existingHealth, 0, 500000000),
    goal: merged.goal ? String(merged.goal).trim().slice(0, 120) : null,
  };
}

// ── the webhook ─────────────────────────────────────────────────
export async function handleAgentWebhook(req, res, url) {
  const answer = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const settings = agentSettings();
  const given = Buffer.from(url.pathname.split('/').pop() || '');
  const expected = Buffer.from(settings.key ? hookToken(settings.key) : randomBytes(20).toString('hex'));
  if (req.method !== 'POST' || !settings.configured || given.length !== expected.length || !timingSafeEqual(given, expected)) return answer(404, { title: 'Not found' });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 512_000) return answer(413, { title: 'Too large' });
    chunks.push(chunk);
  }
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    await recordWebhook(payload);
    return answer(200, { ok: true });
  } catch {
    return answer(400, { title: 'Bad payload' });
  }
}

export const webhookTokenForTests = hookToken;
