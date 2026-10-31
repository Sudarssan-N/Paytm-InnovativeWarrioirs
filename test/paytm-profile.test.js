// Pulling a merchant's records through MCP, against a local stand-in for Paytm's
// server: it refuses a query longer than 30 days, pages its answers, has one tool
// that needs an argument MITRA cannot know, and expires the token half-way through.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let mock, base, dataDir, paytm, profile;
const NOW = Date.parse('2026-10-31T10:00:00+05:30');
const seen = { calls: [], refreshed: 0, tokens: new Set(['token-1']) };

// One successful order a day from 1 April, payer ids that look like phone numbers.
const ORDERS = [];
for (let day = Date.parse('2026-04-01T11:00:00+05:30'); day < NOW; day += 86_400_000) {
  const d = new Date(day + 19_800_000);
  const stamp = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} 11:00:00`;
  ORDERS.push({ orderId: `ORD${ORDERS.length}`, txnAmount: '1000.00', txnDate: stamp, status: 'TXN_SUCCESS', paymentMode: 'UPI', custId: `98765${String(ORDERS.length % 7).padStart(5, '0')}`, merchantName: 'Test Kirana' });
}

const TOOLS = [
  { name: 'fetch_all_orders', inputSchema: { type: 'object', properties: { fromDate: { type: 'string', description: 'yyyy-MM-ddTHH:mm:ss+05:30' }, toDate: { type: 'string' }, pageNumber: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', maximum: 20 } }, required: ['fromDate', 'toDate'] } },
  { name: 'fetch_refunds', inputSchema: { type: 'object', properties: { startDate: { type: 'string', format: 'date' }, endDate: { type: 'string', format: 'date' } } } },
  { name: 'fetch_settlements_by_date', inputSchema: { type: 'object', properties: { mid: { type: 'string' }, settlementDate: { type: 'string' } }, required: ['mid', 'settlementDate'] } },
  { name: 'fetch_payment_links', inputSchema: { type: 'object', properties: {} } },
  { name: 'initiate_refund', inputSchema: { type: 'object', properties: {} } },
];

function answer(name, args) {
  if (name === 'fetch_all_orders') {
    const from = Date.parse(args.fromDate), to = Date.parse(args.toDate);
    if (to - from > 31 * 86_400_000) return { isError: true, content: [{ type: 'text', text: 'Date range cannot exceed 30 days' }] };
    const hits = ORDERS.filter((o) => { const t = Date.parse(`${o.txnDate.replace(' ', 'T')}+05:30`); return t >= from && t <= to; });
    const size = args.pageSize, page = args.pageNumber;
    return { content: [{ type: 'text', text: JSON.stringify({ body: { resultInfo: { resultStatus: 'S' }, orders: hits.slice((page - 1) * size, page * size) } }) }] };
  }
  if (name === 'fetch_refunds') {
    assert.match(args.startDate, /^\d{4}-\d{2}-\d{2}$/, 'a date-only field gets a date only');
    return { structuredContent: { refunds: args.startDate.startsWith('2026-09') ? [{ refundId: 'R1', orderId: 'ORD160', refundAmount: '1000.00', refundDate: '2026-09-15', status: 'SUCCESS' }] : [] } };
  }
  if (name === 'fetch_payment_links') return { content: [{ type: 'text', text: JSON.stringify([{ linkId: 'L1', amount: 2500, status: 'ACTIVE' }, { linkId: 'L2', amount: 900, status: 'PAID' }]) }] };
  throw new Error(`unexpected ${name}`);
}

before(async () => {
  mock = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const send = (status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
    const url = new URL(req.url, base);
    if (url.pathname === '/.well-known/oauth-protected-resource') return send(200, { authorization_servers: [base] });
    if (url.pathname === '/.well-known/oauth-authorization-server') return send(200, { issuer: base, authorization_endpoint: `${base}/login`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register` });
    if (url.pathname === '/token') {
      const form = new URLSearchParams(raw);
      assert.equal(form.get('grant_type'), 'refresh_token');
      assert.equal(form.get('refresh_token'), 'refresh-1');
      seen.refreshed += 1;
      seen.tokens.add('token-2');
      return send(200, { access_token: 'token-2', token_type: 'bearer' });
    }
    if (url.pathname !== '/mcp') return send(404, {});
    const bearer = String(req.headers.authorization).slice(7);
    if (!seen.tokens.has(bearer)) return send(401, { error: 'unauthorized' });
    const rpc = JSON.parse(raw);
    if (rpc.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
    if (rpc.method === 'initialize') return send(200, { jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2025-03-26' } }, { 'mcp-session-id': `sess-${bearer}` });
    if (rpc.method === 'tools/list') return send(200, { jsonrpc: '2.0', id: rpc.id, result: { tools: TOOLS } });
    if (rpc.method === 'tools/call') {
      seen.calls.push(rpc.params);
      // The first token expires after a few calls, as a real one would mid-pull.
      if (bearer === 'token-1' && seen.calls.length > 3) { seen.tokens.delete('token-1'); return send(401, { error: 'expired' }); }
      return send(200, { jsonrpc: '2.0', id: rpc.id, result: answer(rpc.params.name, rpc.params.arguments) });
    }
    return send(400, {});
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${mock.address().port}`;
  dataDir = mkdtempSync(path.join(tmpdir(), 'mitra-paytm-profile-'));
  process.env.PAYTM_MCP_URL = `${base}/mcp`;
  process.env.MITRA_DATA_DIR = dataDir;
  paytm = await import('../server/paytm.mjs');
  profile = await import('../server/paytmProfile.mjs');
});

after(() => { mock.close(); rmSync(dataDir, { recursive: true, force: true }); });

test('without a sign-in there is no live profile, and a call gets the labelled sample', async () => {
  assert.equal(await profile.paytmInsights({ now: NOW }), null);
  const forCall = await profile.paytmForSession({ now: NOW });
  assert.equal(forCall.live, false);
  assert.equal(forCall.sales, null, 'sample records never stand in for a shop’s real sales');
  assert.equal(forCall.insights.sample, true);
});

test('arguments follow each tool’s schema: windows, pages, and what cannot be known', () => {
  const windows = profile.pullWindows(NOW);
  assert.equal(new Date(windows[0].from + 19_800_000).toISOString().slice(0, 10), '2026-04-01', 'six full months back');
  assert.ok(windows.every((w) => w.to - w.from < 30 * 86_400_000));
  const built = profile.argsFor(TOOLS[0].inputSchema, { ...windows[0], page: 2 });
  assert.equal(built.args.pageNumber, 3);
  assert.equal(built.args.pageSize, 20, 'the tool’s maximum page size is respected');
  assert.match(built.args.fromDate, /^2026-04-01T00:00:00\+05:30$/);
  assert.deepEqual(profile.argsFor(TOOLS[2].inputSchema, windows[0]).missing, ['mid', 'settlementDate']);
});

test('a pull reads every page of every window, renews the token, and keeps no payer id', async () => {
  writeFileSync(path.join(dataDir, 'paytm-token.json'), JSON.stringify({ access_token: 'token-1', refresh_token: 'refresh-1' }));
  const insights = await profile.paytmInsights({ now: NOW, refresh: true });
  assert.equal(seen.refreshed, 1, 'the expired token was renewed once');
  assert.equal(insights.live, true);
  assert.equal(insights.profile.name, 'Test Kirana');
  assert.equal(insights.profile.coverage.orders, ORDERS.filter((o) => o.txnDate >= '2026-04-01').length, 'every page of every window');
  assert.deepEqual(insights.profile.months.map((m) => m.month), ['Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026']);
  assert.equal(insights.profile.months[0].sales, 30000);
  assert.equal(insights.profile.thisMonth.sales, 30000, 'October so far: the 31st’s order is after 10 am');
  assert.equal(insights.profile.refunds.total, 1000);
  assert.equal(insights.profile.links.activeValue, 2500);
  assert.ok(insights.notes.some((note) => /settlements: needs mid, settlementDate/.test(note)), insights.notes.join(' | '));
  assert.ok(insights.suggestions.some((s) => s.id === 'working_capital'));
  assert.ok(!seen.calls.some((call) => call.name === 'initiate_refund'), 'only read tools are called');

  const file = path.join(dataDir, 'paytm-snapshot.json');
  assert.equal(statSync(file).mode & 0o077, 0, 'the snapshot is readable by its owner only');
  const stored = readFileSync(file, 'utf8');
  assert.ok(!stored.includes('98765'), 'payer ids are stored only as a keyed hash');
});

test('a call on a connected shop speaks from the live records', async () => {
  const forCall = await profile.paytmForSession({ now: NOW });
  assert.equal(forCall.live, true);
  assert.equal(forCall.sales.months.length, 6);
  assert.match(forCall.sales.source, /Paytm/);
  assert.ok(!('byHour' in forCall.insights.profile.rhythm), 'a session carries the profile without the hourly detail');
});

test('disconnecting forgets the token and the pulled records', async () => {
  await paytm.disconnect();
  assert.throws(() => statSync(path.join(dataDir, 'paytm-snapshot.json')));
  assert.equal(await profile.paytmInsights({ now: NOW }), null);
});
