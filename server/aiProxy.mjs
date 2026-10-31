// AI provider proxy — the only place DeepSeek and Sarvam keys exist.
//
// The browser calls /api/ai/sarvam/<path>; this module adds the key and
// forwards the request. Keys come from the server
// environment (DEEPSEEK_API_KEY / SARVAM_API_KEY; the older VITE_* names are
// accepted so an existing .env keeps working locally). They are never sent
// to the browser and never bundled into the web build.
//
// Requests are bounded so the proxy can't be used as a free general-purpose
// LLM endpoint: an allow-list of Sarvam paths and a per-client rate limit.

import { countCall, watch } from './ops.mjs';
import { cacheKey, readVoiceCache, writeVoiceCache } from './voiceCache.mjs';

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const SARVAM_BASE = 'https://api.sarvam.ai';
const SARVAM_PATHS = new Set(['/text-to-speech', '/speech-to-text', '/translate', '/text-lid', '/transliterate', '/v1/chat/completions']);
const SARVAM_CHAT_MODEL = 'sarvam-105b';
// No reasoning step, so it answers in a fraction of a second. On the 155 questions of
// the blind test it routed 91% right, against 89% for the model it replaced, and the
// customer's words stay on Sarvam's India-hosted platform. See docs/blind-test.
const SARVAM_ROUTER_MODEL = process.env.MITRA_ROUTER_MODEL || 'sarvam-105b-conversations';
const CACHED_SARVAM_PATHS = new Set(['/text-to-speech', '/translate']);

export const deepseekKey = () => (process.env.DEEPSEEK_API_KEY || process.env.VITE_DEEPSEEK_API_KEY || '').trim();
export const sarvamKey = () => (process.env.SARVAM_API_KEY || process.env.VITE_SARVAM_API_KEY || '').trim();

export const aiStatus = () => ({ llm: Boolean(deepseekKey()), sarvam: Boolean(sarvamKey()) });

// Sliding one-minute window per client. Per instance only — enough to stop a
// runaway loop or casual abuse of a public demo, not a production limiter.
const WINDOW_MS = 60_000;
// A translated reply costs ~10 Sarvam calls (one per line, speech batches,
// language ID), so its limit is set per conversation turn, not per request.
const LIMITS = { sarvam: 300, journey: 240, auth: 30 };
const hits = new Map();
export function rateLimited(client, bucket, now = Date.now()) {
  const key = `${bucket}:${client}`;
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMITS[bucket]) { hits.set(key, recent); return true; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

// A forwarded address can be forged, so it only counts behind a proxy we run.
export function clientId(req) {
  const forwarded = process.env.MITRA_TRUST_PROXY === '1' ? req.headers['x-forwarded-for'] : null;
  return String(forwarded || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

async function rawBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request is too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const problem = (res, status, title) => send(res, status, { type: 'about:blank', title, status });

// One routing decision from whichever model is configured. The caller validates
// the result against the allow-list, so a bad answer here can only route badly.
export async function modelToolCall({ messages, tools, signal }) {
  const timeout = AbortSignal.timeout(8000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  // DeepSeek only when asked for, or when there is no Sarvam key at all.
  const key = process.env.MITRA_ROUTER === 'deepseek' || !sarvamKey() ? deepseekKey() : '';
  const body = { messages, tools, tool_choice: 'required', temperature: 0 };
  const started = Date.now();
  const upstream = await watch('router', () => (key
    ? fetch(DEEPSEEK_URL, {
      method: 'POST', signal: combined,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ ...body, max_tokens: 200, model: DEEPSEEK_MODEL, thinking: { type: 'disabled' } }),
    })
    : fetch(`${SARVAM_BASE}/v1/chat/completions`, {
      method: 'POST', signal: combined,
      headers: { 'content-type': 'application/json', 'api-subscription-key': sarvamKey() },
      body: JSON.stringify({ ...body, max_tokens: 300, model: SARVAM_ROUTER_MODEL }),
    })));
  countCall(key ? 'deepseek/chat' : '/v1/chat/completions', { ms: Date.now() - started, ok: upstream.ok, status: upstream.status });
  if (!upstream.ok) throw new Error(`Router model returned ${upstream.status}`);
  const data = await upstream.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0]?.function;
  if (!call?.name) throw new Error('Router model chose no tool');
  let args;
  try { args = JSON.parse(call.arguments || '{}'); } catch { throw new Error('Router model sent invalid arguments'); }
  return { name: call.name, arguments: args };
}

// A one-word opinion on whether a request looks like a scam. The caller lets this
// raise an alarm only, and an unexpected answer counts as no opinion.
export async function modelRiskOpinion(text) {
  const call = await modelToolCall({
    messages: [
      { role: 'system', content: 'You assess whether what an Indian customer describes is likely a financial scam: a stranger or an unexpected message, pressure, or a request for money or personal details. Call report_risk once.' },
      { role: 'user', content: text },
    ],
    tools: [{ type: 'function', function: { name: 'report_risk', description: 'Report how this looks.', parameters: { type: 'object', additionalProperties: false, properties: { risk: { type: 'string', enum: ['likely_scam', 'unsure', 'looks_normal'] } }, required: ['risk'] } } }],
  });
  return ['likely_scam', 'unsure', 'looks_normal'].includes(call.arguments?.risk) ? call.arguments.risk : 'unsure';
}

// Byte-for-byte forward so the multipart speech-to-text upload works too.
export async function proxySarvam(req, res, path) {
  const key = sarvamKey();
  if (!key) return problem(res, 503, 'Sarvam is not configured on the server');
  if (!SARVAM_PATHS.has(path)) return problem(res, 404, 'Not found');
  if (rateLimited(clientId(req), 'sarvam')) return problem(res, 429, 'Too many voice requests — try again in a minute');
  let body;
  try { body = await rawBody(req, 15_000_000); }
  catch (error) { return problem(res, error.status || 400, error.message); }
  if (path === '/v1/chat/completions') {
    // Same fence as DeepSeek: fixed model, bounded tokens.
    try {
      const input = JSON.parse(body.toString('utf8'));
      body = Buffer.from(JSON.stringify({ ...input, model: SARVAM_CHAT_MODEL, max_tokens: Math.min(Number(input.max_tokens) || 220, 1000) }));
    } catch { return problem(res, 400, 'Request body must be valid JSON'); }
  }
  // Speech and translation of the same text never change, so a repeat is served
  // from disk: instant, and it survives the venue's Wi-Fi going down.
  const key2 = CACHED_SARVAM_PATHS.has(path) ? cacheKey(path, body.toString('utf8')) : null;
  if (key2) {
    const cached = await readVoiceCache(key2);
    if (cached) return send(res, 200, cached, 'application/json');
  }
  try {
    const upstream = await fetch(SARVAM_BASE + path, {
      method: 'POST',
      headers: { 'api-subscription-key': key, 'content-type': req.headers['content-type'] || 'application/json' },
      body,
      signal: AbortSignal.timeout(25_000),
    });
    const out = Buffer.from(await upstream.arrayBuffer());
    if (key2 && upstream.ok) await writeVoiceCache(key2, out);
    return send(res, upstream.status, out, upstream.headers.get('content-type') || 'application/json');
  } catch {
    return problem(res, 504, 'Sarvam did not respond in time');
  }
}
