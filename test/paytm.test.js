// Paytm's login needs a real merchant, so this runs the whole client against a local
// stand-in for the same protocol: discovery, registration, PKCE, tokens and MCP.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let mock, base, paytm, dataDir;
const seen = { calls: [], verifier: null, challenge: null, registered: null };
const TOOLS = [
  { name: 'create_link', description: 'Create a payment link', inputSchema: { type: 'object', properties: { amount: { type: 'number' } } } },
  { name: 'fetch_transactions', description: 'List transactions', inputSchema: { type: 'object', properties: {} } },
  { name: 'initiate_refund', description: 'Refund a payment', inputSchema: { type: 'object', properties: {} } },
];

before(async () => {
  mock = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const send = (status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
    const url = new URL(req.url, base);
    if (url.pathname === '/.well-known/oauth-protected-resource') return send(200, { authorization_servers: [base] });
    if (url.pathname === '/.well-known/oauth-authorization-server') return send(200, { issuer: base, authorization_endpoint: `${base}/login`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register` });
    if (url.pathname === '/register') {
      seen.registered = JSON.parse(raw);
      // Paytm's real server answers 500 if a scope is sent here.
      if (seen.registered.scope) return send(500, { message: 'internal server error' });
      return send(200, { client_id: 'MITRA', client_secret: 'shh', redirect_uris: seen.registered.redirect_uris });
    }
    if (url.pathname === '/token') {
      const form = new URLSearchParams(raw);
      seen.verifier = form.get('code_verifier');
      if (createHash('sha256').update(seen.verifier).digest('base64url') !== seen.challenge) return send(400, { error: 'invalid_grant' });
      return send(200, { access_token: 'token-1', token_type: 'bearer' });
    }
    if (url.pathname === '/mcp') {
      if (req.headers.authorization !== 'Bearer token-1') return send(401, { error: 'unauthorized' });
      const rpc = JSON.parse(raw);
      if (rpc.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
      if (rpc.method === 'initialize') return send(200, { jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2025-03-26' } }, { 'mcp-session-id': 'sess-1' });
      assert.equal(req.headers['mcp-session-id'], 'sess-1');
      if (rpc.method === 'tools/list') {
        // Paytm may answer as one server-sent event, so that path is the one tested.
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { tools: TOOLS } })}\n\n`);
      }
      if (rpc.method === 'tools/call') {
        seen.calls.push(rpc.params);
        return send(200, { jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: `done: ${rpc.params.name}` }] } });
      }
    }
    return send(404, {});
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${mock.address().port}`;
  dataDir = mkdtempSync(path.join(tmpdir(), 'mitra-paytm-'));
  process.env.PAYTM_MCP_URL = `${base}/mcp`;
  process.env.MITRA_DATA_DIR = dataDir;
  paytm = await import('../server/paytm.mjs');
});

after(() => { mock.close(); rmSync(dataDir, { recursive: true, force: true }); });

const fakeReq = { headers: { host: '127.0.0.1:8787' } };

test('before sign-in, the server is reachable and nothing claims to be connected', async () => {
  const status = await paytm.paytmStatus();
  assert.equal(status.reachable, true, 'a 401 means it is up and wants a login');
  assert.equal(status.connected, false);
  assert.equal(status.tools, null);
  await assert.rejects(paytm.callTool('fetch_transactions', {}), /not connected/);
});

test('sign-in follows OAuth with PKCE, then the tools appear', async () => {
  const url = new URL(await paytm.startLogin(fakeReq));
  assert.equal(seen.registered.scope, undefined, 'registration must not send a scope');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:8787/api/paytm/callback');
  seen.challenge = url.searchParams.get('code_challenge');
  const tools = await paytm.finishLogin(new URLSearchParams({ code: 'abc', state: url.searchParams.get('state') }));
  assert.deepEqual(tools.map((tool) => tool.name), ['create_link', 'fetch_transactions', 'initiate_refund']);
  assert.ok(seen.verifier.length >= 43);
  assert.equal(statSync(path.join(dataDir, 'paytm-token.json')).mode & 0o077, 0, 'the token is readable by its owner only');
  const status = await paytm.paytmStatus();
  assert.equal(status.connected, true);
  assert.equal(status.tools.length, 3);
});

test('a stale or forged sign-in is refused', async () => {
  await assert.rejects(paytm.finishLogin(new URLSearchParams({ code: 'abc', state: 'forged' })), /expired/);
  await assert.rejects(paytm.finishLogin(new URLSearchParams({ error: 'access_denied', state: 'x' })), /access_denied/);
});

test('reading is free, a payment link needs a yes, and a refund can never run', async () => {
  const read = await paytm.callTool('fetch_transactions', {});
  assert.equal(read.content[0].text, 'done: fetch_transactions');
  await assert.rejects(paytm.callTool('create_link', { amount: 1 }), /confirmation/);
  assert.equal(seen.calls.filter((call) => call.name === 'create_link').length, 0);
  const made = await paytm.callTool('create_link', { amount: 1 }, { confirmed: true });
  assert.equal(made.content[0].text, 'done: create_link');
  await assert.rejects(paytm.callTool('initiate_refund', {}, { confirmed: true }), /allow-list/);
  assert.equal(seen.calls.filter((call) => call.name === 'initiate_refund').length, 0);
  await assert.rejects(paytm.callTool('no_such_tool', {}), /no such tool/);
});

test('disconnecting forgets the token', async () => {
  await paytm.disconnect();
  assert.equal((await paytm.paytmStatus()).connected, false);
});
