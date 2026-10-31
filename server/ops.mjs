// What an operator watches: calls, latency, errors and cost per provider, what the
// fences caught, and a circuit breaker per voice model so a stalled provider fails
// fast into the fallback instead of leaving a customer in silence. In memory, per
// instance. A real deployment would scrape /api/ops/metrics into Prometheus.

// Pay-as-you-go list prices from Sarvam's pricing page, 31 Oct 2026. Estimates only.
const PRICE_PER_CHAR = { '/translate': 20 / 10000, '/transliterate': 20 / 10000, '/text-to-speech': 30 / 10000, '/text-to-speech/stream': 30 / 10000 };
const PRICE_PER_LID_CHAR = 3.5 / 10000;
const PRICE_PER_AUDIO_SECOND = 29.4 / 3600;

const startedAt = Date.now();
const providers = new Map();
const turns = { count: 0, ms: [], byTool: {}, byLang: {}, fenceBlocked: 0, figuresChecked: 0, routedBy: {} };
const voice = { checked: 0, failed: 0, figures: 0, lastFailure: null };
const breakers = new Map();
const events = { speechDropped: 0, documentsRead: 0, understandingChecks: 0, gameRuns: 0, erasures: 0 };

const keep = (list, value, limit = 500) => { list.push(value); if (list.length > limit) list.shift(); };
const percentile = (list, p) => {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

export function countCall(path, { ms = null, ok = true, status = null, chars = 0, cached = false, audioSeconds = 0, tokens = 0 } = {}) {
  const row = providers.get(path) || { path, calls: 0, cached: 0, errors: 0, ms: [], chars: 0, audioSeconds: 0, tokens: 0, rateLimited: 0, cost: 0 };
  row.calls += 1;
  if (cached) row.cached += 1;
  if (!ok) row.errors += 1;
  if (status === 429) row.rateLimited += 1;
  if (ms != null) keep(row.ms, ms);
  if (!cached && ok) {
    row.chars += chars;
    row.audioSeconds += audioSeconds;
    row.tokens += tokens;
    row.cost += (PRICE_PER_CHAR[path] || (path === '/text-lid' ? PRICE_PER_LID_CHAR : 0)) * chars + PRICE_PER_AUDIO_SECOND * audioSeconds;
  }
  providers.set(path, row);
}

export function recordTurn({ ms, tool, lang, blocked = 0, figures = 0, routedBy = null }) {
  turns.count += 1;
  keep(turns.ms, ms);
  turns.byTool[tool] = (turns.byTool[tool] || 0) + 1;
  turns.byLang[lang] = (turns.byLang[lang] || 0) + 1;
  turns.fenceBlocked += blocked;
  turns.figuresChecked += figures;
  if (routedBy) turns.routedBy[routedBy] = (turns.routedBy[routedBy] || 0) + 1;
}

export function recordVoiceCheck({ ok, figures = 0, missing = [] }) {
  voice.checked += 1;
  voice.figures += figures;
  if (!ok) { voice.failed += 1; voice.lastFailure = { missing, at: new Date().toISOString() }; }
}

export const bump = (name, by = 1) => { events[name] = (events[name] || 0) + by; };

// Five failures in a row open the breaker for twenty seconds. A 4xx is our own bad
// request, not an outage, and does not count.
const FAILURES_TO_OPEN = 5;
const OPEN_MS = 20_000;

export async function watch(name, call) {
  const state = breakers.get(name) || { failures: 0, openUntil: 0, opened: 0 };
  breakers.set(name, state);
  if (Date.now() < state.openUntil) throw Object.assign(new Error(`${name} is resting after repeated failures`), { status: 503, breaker: true });
  try {
    const result = await call();
    const down = result && result.ok === false && (result.status >= 500 || result.status === 429);
    if (down) throw Object.assign(new Error(`${name} returned ${result.status}`), { result });
    state.failures = 0;
    return result;
  } catch (error) {
    if (error.name === 'AbortError' && !error.result) throw error; // the caller hung up
    state.failures += 1;
    if (state.failures >= FAILURES_TO_OPEN) { state.openUntil = Date.now() + OPEN_MS; state.opened += 1; state.failures = 0; }
    if (error.result) return error.result;
    throw error;
  }
}

export function opsSnapshot() {
  const rows = [...providers.values()].map((row) => ({
    path: row.path, calls: row.calls, cached: row.cached, errors: row.errors, rateLimited: row.rateLimited,
    p50: percentile(row.ms, 0.5), p95: percentile(row.ms, 0.95), chars: row.chars, audioSeconds: Math.round(row.audioSeconds),
    tokens: row.tokens, costRupees: Number(row.cost.toFixed(2)),
  })).sort((a, b) => b.calls - a.calls);
  const cost = rows.reduce((sum, row) => sum + row.costRupees, 0);
  const calls = rows.reduce((sum, row) => sum + row.calls, 0);
  const cached = rows.reduce((sum, row) => sum + row.cached, 0);
  return {
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    providers: rows,
    turns: { count: turns.count, p50: percentile(turns.ms, 0.5), p95: percentile(turns.ms, 0.95), byTool: turns.byTool, byLang: turns.byLang, routedBy: turns.routedBy },
    fence: { figuresChecked: turns.figuresChecked, sentencesBlocked: turns.fenceBlocked },
    voice: { ...voice },
    events: { ...events },
    breakers: Object.fromEntries([...breakers].map(([name, state]) => [name, { open: Date.now() < state.openUntil, failures: state.failures, timesOpened: state.opened }])),
    costRupees: Number(cost.toFixed(2)),
    costPerTurn: turns.count ? Number((cost / turns.count).toFixed(2)) : null,
    cacheHitPct: calls ? Math.round((cached / calls) * 100) : null,
    pricing: 'Estimated at Sarvam pay-as-you-go list prices, 31 Oct 2026',
  };
}

export function prometheus() {
  const snap = opsSnapshot();
  const lines = [
    `mitra_uptime_seconds ${snap.uptimeSeconds}`, `mitra_turns_total ${snap.turns.count}`, `mitra_turn_latency_p95_ms ${snap.turns.p95 ?? 0}`,
    `mitra_fence_figures_checked_total ${snap.fence.figuresChecked}`, `mitra_fence_sentences_blocked_total ${snap.fence.sentencesBlocked}`,
    `mitra_voice_checks_total ${snap.voice.checked}`, `mitra_voice_check_failures_total ${snap.voice.failed}`, `mitra_cost_rupees_total ${snap.costRupees}`,
  ];
  for (const row of snap.providers) {
    const label = `path="${row.path}"`;
    lines.push(`mitra_provider_calls_total{${label}} ${row.calls}`, `mitra_provider_errors_total{${label}} ${row.errors}`, `mitra_provider_latency_p95_ms{${label}} ${row.p95 ?? 0}`);
  }
  for (const [name, state] of Object.entries(snap.breakers)) lines.push(`mitra_breaker_open{name="${name}"} ${state.open ? 1 : 0}`);
  return `${lines.join('\n')}\n`;
}
