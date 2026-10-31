// A merchant's own records, pulled from Paytm's MCP server and turned into a profile
// and suggestions. Only read tools are called. Paytm publishes each tool's schema but
// not its answers, so arguments are built from the schema (date windows and pages)
// and every record is read by the tolerant lookups in paytmInsights.js.
//
// What is kept: normalised records, with each payer id replaced by a keyed hash, in a
// file only the owner can read. Disconnecting Paytm removes it.
import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callTool, knownTools, paytmConnected } from './paytm.mjs';
import { merchantInsights, normaliseLinks, normaliseOrders, normaliseRefunds, normaliseSettlements, salesSummaryFrom } from '../src/journeys/engines/paytmInsights.js';
import { samplePaytmRecords, SAMPLE_PAYTM_NOW } from '../src/journeys/samplePaytm.js';
import { MERCHANT_OFFER } from '../src/journeys/sampleData.js';

const DATA_DIR = path.resolve(process.env.MITRA_DATA_DIR || path.join(process.cwd(), '.data'));
const SNAPSHOT_FILE = path.join(DATA_DIR, 'paytm-snapshot.json');
const SALT_FILE = path.join(DATA_DIR, 'paytm-salt');
const IST_MS = 19_800_000;
const DAY_MS = 86_400_000;
// Six full months for a working capital check, and this one so far.
const FULL_MONTHS = Number(process.env.PAYTM_PULL_MONTHS || 6);
// Paytm's order and refund lists take at most 30 days a query.
const WINDOW_DAYS = 30;
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const STALE_MS = 6 * 3_600_000;

// Which tool answers which question, in order of preference. A prefixed name such as
// `paytm_fetch_all_orders` is accepted too. Sales come from a `whole` source, so a
// month Paytm refused is never counted as a month with no sales.
export const SOURCES = Object.freeze([
  { key: 'orders', tools: ['fetch_all_orders'], normalise: normaliseOrders, whole: true },
  { key: 'refunds', tools: ['fetch_refunds'], normalise: normaliseRefunds },
  { key: 'settlements', tools: ['fetch_settlement_orders', 'fetch_settlements_by_date'], normalise: normaliseSettlements, whole: true },
  { key: 'links', tools: ['fetch_payment_links'], normalise: normaliseLinks },
]);

const readJson = async (file) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
async function writeSecret(file, value) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
}

async function payerHasher() {
  let salt = await readFile(SALT_FILE, 'utf8').catch(() => null);
  if (!salt) { salt = randomBytes(32).toString('hex'); await writeSecret(SALT_FILE, salt); }
  return (id) => createHmac('sha256', salt).update(id).digest('hex').slice(0, 16);
}

// ── arguments from a tool's schema ──────────────────────────────
const DATE_FROM = /^(from|start)$|(from|start).?(date|time)|(date|time).?(from|start)/i;
const DATE_TO = /^(to|end)$|(to|end).?(date|time)|(date|time).?(to|end)/i;
const PAGE = /^page$|page.?(num|no|number|index)$/i;
const SIZE = /page.?size|^size$|^limit$|^count$|per.?page|max.?results/i;
const OFFSET = /^offset$|^skip$/i;

const two = (n) => String(n).padStart(2, '0');
export function dateValue(spec, ms) {
  const hint = `${spec.format || ''} ${spec.pattern || ''} ${spec.description || ''} ${spec.example ?? ''}`;
  if (spec.type === 'integer' || spec.type === 'number') return /second/i.test(hint) && !/milli/i.test(hint) ? Math.floor(ms / 1000) : ms;
  const d = new Date(ms + IST_MS);
  const [y, m, day, hh, mm, ss] = [d.getUTCFullYear(), two(d.getUTCMonth() + 1), two(d.getUTCDate()), two(d.getUTCHours()), two(d.getUTCMinutes()), two(d.getUTCSeconds())];
  if (/dd[-/]MM[-/]yyyy/.test(hint)) return `${day}${hint.match(/dd([-/])MM/)[1]}${m}${hint.match(/dd([-/])MM/)[1]}${y}${/HH/.test(hint) ? ` ${hh}:${mm}:${ss}` : ''}`;
  if (spec.format === 'date' || (/yyyy-MM-dd/.test(hint) && !/HH/.test(hint))) return `${y}-${m}-${day}`;
  if (/yyyy-MM-dd HH/.test(hint)) return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
  return `${y}-${m}-${day}T${hh}:${mm}:${ss}+05:30`;
}

// Fills dates and paging; anything else required that MITRA cannot know is reported.
export function argsFor(schema, { from, to, page = 0, pageSize = PAGE_SIZE }) {
  const args = {}, missing = [];
  const shape = { windowed: false, paged: false };
  for (const [name, spec = {}] of Object.entries(schema?.properties || {})) {
    if (spec.type === 'object' && spec.properties) {
      const inner = argsFor(spec, { from, to, page, pageSize });
      if (Object.keys(inner.args).length) args[name] = inner.args;
      missing.push(...inner.missing.map((field) => `${name}.${field}`));
      shape.windowed ||= inner.shape.windowed; shape.paged ||= inner.shape.paged;
    } else if (DATE_FROM.test(name)) { args[name] = dateValue(spec, from); shape.windowed = true; }
    else if (DATE_TO.test(name)) { args[name] = dateValue(spec, to); shape.windowed = true; }
    else if (PAGE.test(name)) { args[name] = (spec.minimum ?? 1) + page; shape.paged = true; }
    else if (SIZE.test(name)) args[name] = Math.min(pageSize, spec.maximum ?? pageSize);
    else if (OFFSET.test(name)) { args[name] = page * Math.min(pageSize, spec.maximum ?? pageSize); shape.paged = true; }
    else if ((schema.required || []).includes(name)) {
      if (spec.default !== undefined) args[name] = spec.default;
      else if (spec.enum?.length) [args[name]] = spec.enum;
      else missing.push(name);
    }
  }
  const sized = Object.entries(args).find(([name]) => SIZE.test(name));
  return { args, missing, shape, pageSize: sized ? sized[1] : pageSize };
}

// ── reading what a tool returned ────────────────────────────────
export function toolData(result) {
  const texts = (result?.content || []).filter((item) => item.type === 'text').map((item) => item.text);
  if (result?.isError) throw new Error(texts.join(' ').slice(0, 200) || 'Paytm returned an error');
  if (result?.structuredContent) return result.structuredContent;
  for (const text of texts) { try { return JSON.parse(text); } catch { /* not JSON */ } }
  return texts.join('\n');
}

// The records are the largest list of objects anywhere in the answer.
export function recordsIn(data, depth = 0) {
  if (Array.isArray(data)) {
    if (data.length && data.every((item) => item && typeof item === 'object' && !Array.isArray(item))) return data;
    return data.reduce((best, item) => { const found = recordsIn(item, depth + 1); return found.length > best.length ? found : best; }, []);
  }
  if (!data || typeof data !== 'object' || depth > 4) return [];
  return Object.values(data).reduce((best, value) => { const found = recordsIn(value, depth + 1); return found.length > best.length ? found : best; }, []);
}

const findTool = (tools, names) => {
  for (const name of names) {
    const hit = tools.find((tool) => tool.name === name) || tools.find((tool) => tool.name.endsWith(`_${name}`) || tool.name.endsWith(`.${name}`));
    if (hit) return hit;
  }
  return null;
};

// Windows of at most 30 days, newest last, from the first day of the earliest full month.
export function pullWindows(now = Date.now(), months = FULL_MONTHS) {
  const today = new Date(now + IST_MS);
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - months, 1) - IST_MS;
  const out = [];
  for (let from = start; from < now; from += WINDOW_DAYS * DAY_MS) out.push({ from, to: Math.min(from + WINDOW_DAYS * DAY_MS - 1000, now) });
  return out;
}

async function pages(tool, window, stats) {
  const all = [];
  let previousFirst = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const built = argsFor(tool.inputSchema, { ...window, page });
    if (built.missing.length) throw new Error(`needs ${built.missing.join(', ')}, which MITRA cannot know`);
    stats.calls += 1;
    const records = recordsIn(toolData(await callTool(tool.name, built.args)));
    // A server that ignores the page number answers the same page again.
    const first = records[0] ? JSON.stringify(records[0]) : null;
    if (!records.length || first === previousFirst) break;
    all.push(...records);
    previousFirst = first;
    if (!built.shape.paged || records.length < built.pageSize) break;
  }
  return all;
}

async function pullSource(source, tools, windows, stats) {
  const tool = findTool(tools, source.tools);
  if (!tool) return { tool: null, raw: [], note: `${source.key}: this account shows no ${source.tools.join(' or ')} tool` };
  const { shape } = argsFor(tool.inputSchema, windows[0]);
  const raw = [], failed = [];
  // For refunds and links, a window Paytm refuses costs that month, not the whole source.
  for (const window of shape.windowed ? windows : [windows[0]]) {
    try { raw.push(...await pages(tool, window, stats)); } catch (error) { failed.push(error); }
  }
  if (failed.length && (source.whole || !raw.length)) throw failed[0];
  return { tool: tool.name, raw, note: failed.length ? `${source.key}: ${failed.length} of ${windows.length} date windows failed (${failed[0].message})` : null };
}

// ── the snapshot ────────────────────────────────────────────────
let inFlight = null;

export async function pullFromPaytm({ now = Date.now() } = {}) {
  inFlight ||= (async () => {
    const started = Date.now();
    const tools = await knownTools(0);
    const windows = pullWindows(now);
    const hashId = await payerHasher();
    const stats = { calls: 0 };
    const snapshot = { pulledAt: new Date(now).toISOString(), from: new Date(windows[0].from).toISOString(), tools: {}, recognised: {}, skipped: {}, counts: {}, notes: [], data: {}, merchantName: null };
    for (const source of SOURCES) {
      try {
        const pulled = await pullSource(source, tools, windows, stats);
        if (pulled.note) snapshot.notes.push(pulled.note);
        snapshot.tools[source.key] = pulled.tool;
        const out = source.normalise(pulled.raw, { hashId });
        snapshot.data[source.key] = out.records;
        snapshot.recognised[source.key] = out.recognised;
        snapshot.skipped[source.key] = out.skipped;
        snapshot.counts[source.key] = pulled.raw.length;
        snapshot.merchantName ||= pulled.raw.map((record) => record.merchantName || record.mercName || record.merchantDisplayName).find(Boolean) || null;
      } catch (error) {
        snapshot.data[source.key] = [];
        snapshot.notes.push(`${source.key}: ${error.message}`);
      }
    }
    snapshot.calls = stats.calls;
    snapshot.ms = Date.now() - started;
    await writeSecret(SNAPSHOT_FILE, snapshot);
    return snapshot;
  })().finally(() => { inFlight = null; });
  return inFlight;
}

export const readSnapshot = () => readJson(SNAPSHOT_FILE);

function insightsFrom(snapshot, { now, name }) {
  return merchantInsights(snapshot.data, { now, name: name || snapshot.merchantName || 'Your business', source: 'Paytm, through its MCP server', pulledAt: snapshot.pulledAt, offer: MERCHANT_OFFER });
}

let sampleCache = null;
export function sampleInsights() {
  if (sampleCache) return sampleCache;
  const raw = samplePaytmRecords();
  const hashId = (id) => createHmac('sha256', 'sample').update(id).digest('hex').slice(0, 16);
  const data = Object.fromEntries(SOURCES.map((source) => [source.key, source.normalise(raw[source.key], { hashId }).records]));
  sampleCache = {
    live: false, sample: true, pulledAt: null, tools: {}, notes: ['Sample records in Paytm’s format. Nothing here came from Paytm.'],
    ...merchantInsights(data, { now: SAMPLE_PAYTM_NOW, name: raw.merchantName, source: 'Sample records in Paytm’s format', offer: MERCHANT_OFFER }),
  };
  return sampleCache;
}

export async function paytmInsights({ refresh = false, now = Date.now() } = {}) {
  if (!(await paytmConnected())) return null;
  let snapshot = await readSnapshot();
  if (refresh || !snapshot || now - Date.parse(snapshot.pulledAt) > STALE_MS) snapshot = await pullFromPaytm({ now });
  return {
    live: true, sample: false, pulledAt: snapshot.pulledAt, tools: snapshot.tools, recognised: snapshot.recognised, counts: snapshot.counts, notes: snapshot.notes, calls: snapshot.calls, ms: snapshot.ms,
    ...insightsFrom(snapshot, { now }),
  };
}

// What a merchant's call carries: the live profile when Paytm is connected, otherwise
// the labelled sample. Live sales replace the sample sales summary; sample ones do not.
export async function paytmForSession({ now = Date.now() } = {}) {
  let live = null;
  try {
    const snapshot = (await paytmConnected()) ? await readSnapshot() : null;
    if (snapshot) live = { live: true, sample: false, pulledAt: snapshot.pulledAt, ...insightsFrom(snapshot, { now }) };
  } catch { /* a call never waits on Paytm */ }
  const insights = live || sampleInsights();
  return { live: Boolean(live), source: insights.profile.source, pulledAt: insights.pulledAt, sales: live ? salesSummaryFrom(insights.profile) : null, insights: compact(insights) };
}

// A session is saved with every turn, so it carries the profile without the hourly detail.
const compact = ({ profile: { rhythm, ...profile }, segments, suggestions, pack, sample }) => ({
  profile: { ...profile, rhythm: { peak: rhythm.peak, bestDay: rhythm.bestDay, quietestDay: rhythm.quietestDay } }, segments, suggestions: suggestions.map(({ eligibility, ...rest }) => rest), pack, sample: Boolean(sample),
});

// ── routes ──────────────────────────────────────────────────────
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export async function handleProfile(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/api/paytm/profile') {
      if (url.searchParams.get('sample') === '1') return send(res, 200, sampleInsights());
      const insights = await paytmInsights();
      return insights ? send(res, 200, insights) : send(res, 409, { title: 'Paytm is not connected', connected: false });
    }
    if (req.method === 'POST' && url.pathname === '/api/paytm/sync') {
      const insights = await paytmInsights({ refresh: true });
      return insights ? send(res, 200, insights) : send(res, 409, { title: 'Paytm is not connected', connected: false });
    }
    return send(res, 404, { title: 'Not found' });
  } catch (error) {
    return send(res, error.status || 502, { title: error.message });
  }
}
