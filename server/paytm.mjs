// The live link to Paytm: its hosted MCP server, reached with OAuth 2.1 and PKCE, the
// way any MCP client connects. Nothing here claims more than it has checked: status
// reports what the server answered just now, and tools only appear after a real
// sign-in. Every action that changes something is off the allow-list unless the
// customer asked for it on this call.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { countCall } from './ops.mjs';

const MCP_URL = process.env.PAYTM_MCP_URL || 'https://mcp.paytmpayments.com/mcp';
const MCP_ORIGIN = new URL(MCP_URL).origin;
const DATA_DIR = path.resolve(process.env.MITRA_DATA_DIR || path.join(process.cwd(), '.data'));
const TOKEN_FILE = path.join(DATA_DIR, 'paytm-token.json');
const CLIENT_FILE = path.join(DATA_DIR, 'paytm-client.json');

const pendingLogins = new Map();
let tools = null;
let lastError = null;
let mcpSession = null;
let checkedAt = 0;
let reachable = null;
let authServer = null;

const readJson = async (file) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
async function writeSecret(file, value) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
}
const base64url = (buffer) => buffer.toString('base64url');
const redirectFor = (req) => `${process.env.PUBLIC_HOST ? `https://${process.env.PUBLIC_HOST}` : `http://${String(req.headers.host).replace('127.0.0.1', 'localhost')}`}/api/paytm/callback`;

async function discover() {
  const resource = await fetch(`${MCP_ORIGIN}/.well-known/oauth-protected-resource`, { signal: AbortSignal.timeout(8000) }).then((res) => res.json());
  const meta = await fetch(`${MCP_ORIGIN}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(8000) }).then((res) => res.json());
  authServer = meta;
  return { resource, meta };
}

export async function paytmStatus() {
  const token = await readJson(TOKEN_FILE);
  if (Date.now() - checkedAt > 30_000) {
    checkedAt = Date.now();
    const started = Date.now();
    try {
      const probe = await fetch(MCP_URL, { method: 'POST', signal: AbortSignal.timeout(8000), headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":0,"method":"ping"}' });
      // Without a token, a 401 is the right answer: the server is up and wants a login.
      reachable = probe.status === 401 || probe.ok;
      countCall('paytm/mcp', { ms: Date.now() - started, ok: reachable, status: probe.status });
      if (!authServer) await discover();
      lastError = reachable ? lastError : `The server answered ${probe.status}`;
    } catch (error) { reachable = false; lastError = error.message; }
  }
  return {
    server: MCP_URL, reachable, signInAt: authServer?.issuer || null, connected: Boolean(token?.access_token),
    tools: tools ? tools.map((tool) => tool.name) : null, lastError, checkedAt: new Date(checkedAt).toISOString(),
  };
}

// Dynamic client registration: Paytm's server issues the client on the first connect.
async function clientFor(req) {
  const redirect = redirectFor(req);
  const saved = await readJson(CLIENT_FILE);
  if (saved?.client_id && saved.redirect === redirect) return saved;
  const { meta } = await discover();
  const res = await fetch(meta.registration_endpoint, {
    method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'MITRA', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.client_id) throw Object.assign(new Error(data.error_description || data.error || `Registration returned ${res.status}`), { status: 502 });
  const client = { ...data, redirect };
  await writeSecret(CLIENT_FILE, client);
  return client;
}

export async function startLogin(req) {
  const client = await clientFor(req);
  const { meta } = await discover();
  const verifier = base64url(randomBytes(32));
  const state = base64url(randomBytes(16));
  pendingLogins.set(state, { verifier, client, at: Date.now() });
  const url = new URL(meta.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: client.client_id, redirect_uri: client.redirect, scope: 'openid profile email', state, resource: MCP_URL,
    code_challenge: base64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
  });
  return url.toString();
}

export async function finishLogin(params) {
  const pending = pendingLogins.get(params.get('state'));
  if (params.get('error')) throw Object.assign(new Error(params.get('error_description') || params.get('error')), { status: 400 });
  if (!pending || Date.now() - pending.at > 600_000) throw Object.assign(new Error('That sign-in has expired. Please start again.'), { status: 400 });
  pendingLogins.delete(params.get('state'));
  const { meta } = await discover();
  const res = await fetch(meta.token_endpoint, {
    method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: params.get('code'), redirect_uri: pending.client.redirect, client_id: pending.client.client_id, code_verifier: pending.verifier, resource: MCP_URL, ...(pending.client.client_secret ? { client_secret: pending.client.client_secret } : {}) }),
  });
  const token = await res.json().catch(() => ({}));
  if (!res.ok || !token.access_token) throw Object.assign(new Error(token.error_description || token.error || `Token request returned ${res.status}`), { status: 502 });
  await writeSecret(TOKEN_FILE, { ...token, savedAt: Date.now() });
  mcpSession = null;
  tools = null;
  await listTools();
  return tools;
}

// Signing out forgets the merchant's pulled records too, not only the token.
export async function disconnect() {
  await rm(TOKEN_FILE, { force: true });
  await rm(path.join(DATA_DIR, 'paytm-snapshot.json'), { force: true });
  tools = null;
  mcpSession = null;
}

// MCP over streamable HTTP. A reply can be JSON or one server-sent event.
const parseReply = async (res) => {
  const text = await res.text();
  if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
    const data = text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter(Boolean).at(-1);
    return data ? JSON.parse(data) : {};
  }
  return text ? JSON.parse(text) : {};
};

// An access token lasts hours, a pull of six months takes many calls, so an expired
// token is renewed once with the refresh token before the customer has to sign in again.
async function refreshToken(token) {
  if (!token?.refresh_token) return null;
  const client = await readJson(CLIENT_FILE);
  const { meta } = await discover();
  const res = await fetch(meta.token_endpoint, {
    method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token, client_id: client?.client_id || '', resource: MCP_URL, ...(client?.client_secret ? { client_secret: client.client_secret } : {}) }),
  });
  const fresh = await res.json().catch(() => ({}));
  if (!res.ok || !fresh.access_token) return null;
  const saved = { ...token, ...fresh, savedAt: Date.now() };
  await writeSecret(TOKEN_FILE, saved);
  return saved;
}

let rpcId = 1;
async function rpc(method, params = {}, { notify = false, retried = false } = {}) {
  const token = await readJson(TOKEN_FILE);
  if (!token?.access_token) throw Object.assign(new Error('Paytm is not connected'), { status: 409 });
  const started = Date.now();
  const res = await fetch(MCP_URL, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token.access_token}`, ...(mcpSession ? { 'mcp-session-id': mcpSession } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(notify ? {} : { id: rpcId++ }) }),
  });
  countCall('paytm/mcp', { ms: Date.now() - started, ok: res.ok, status: res.status });
  // A 401 is an expired token; a 404 with a session is an expired MCP session. Each is retried once.
  const expired = res.status === 401 ? await refreshToken(token) : res.status === 404 && mcpSession;
  if (expired && !retried) {
    mcpSession = null;
    if (method !== 'initialize') await ensureSession();
    return rpc(method, params, { notify, retried: true });
  }
  mcpSession = res.headers.get('mcp-session-id') || mcpSession;
  if (notify) return null;
  if (!res.ok) throw Object.assign(new Error(`Paytm MCP returned ${res.status}`), { status: res.status === 401 ? 409 : 502 });
  const reply = await parseReply(res);
  if (reply.error) throw Object.assign(new Error(reply.error.message || 'Paytm MCP error'), { status: 502 });
  return reply.result;
}

async function ensureSession() {
  if (mcpSession) return;
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mitra', version: '1.0' } });
  await rpc('notifications/initialized', {}, { notify: true });
}

let toolsAt = 0;
export async function listTools() {
  await ensureSession();
  tools = (await rpc('tools/list')).tools || [];
  toolsAt = Date.now();
  return tools;
}

// The list barely changes, so a pull of many pages asks for it once.
export async function knownTools(maxAgeMs = 300_000) {
  return tools && Date.now() - toolsAt < maxAgeMs ? tools : listTools();
}

export const paytmConnected = async () => Boolean((await readJson(TOKEN_FILE))?.access_token);

// Reading is free. Anything that changes something must be named here on purpose,
// and only runs after the customer has said yes on this call.
const READ_ONLY = /^(get|fetch|list|search|check|view|read|track)/i;
const ALLOWED_WRITES = /(create|generate).*(link)/i;

export async function callTool(name, args, { confirmed = false } = {}) {
  const tool = (await knownTools()).find((item) => item.name === name);
  if (!tool) throw Object.assign(new Error('Paytm has no such tool'), { status: 404 });
  const read = READ_ONLY.test(name);
  if (!read && !(ALLOWED_WRITES.test(name) && confirmed)) throw Object.assign(new Error('This action needs the customer’s confirmation and is not on the allow-list'), { status: 403 });
  return rpc('tools/call', { name, arguments: args || {} });
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const readBody = async (req) => {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) throw Object.assign(new Error('Too large'), { status: 413 }); }
  return raw ? JSON.parse(raw) : {};
};

export async function handlePaytm(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/api/paytm/status') return send(res, 200, await paytmStatus());
    if (req.method === 'GET' && url.pathname === '/api/paytm/connect') {
      res.writeHead(302, { location: await startLogin(req), 'cache-control': 'no-store' });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/api/paytm/callback') {
      await finishLogin(url.searchParams);
      res.writeHead(302, { location: '/?paytm=connected', 'cache-control': 'no-store' });
      return res.end();
    }
    if (req.method === 'POST' && url.pathname === '/api/paytm/disconnect') { await disconnect(); return send(res, 200, { connected: false }); }
    // The merchant's profile and suggestions, from what the read tools return.
    if (url.pathname === '/api/paytm/profile' || url.pathname === '/api/paytm/sync') return (await import('./paytmProfile.mjs')).handleProfile(req, res, url);
    if (req.method === 'GET' && url.pathname === '/api/paytm/tools') return send(res, 200, { tools: (await listTools()).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    if (req.method === 'POST' && url.pathname === '/api/paytm/tool') {
      const input = await readBody(req);
      return send(res, 200, await callTool(String(input.name || ''), input.arguments, { confirmed: input.confirmed === true }));
    }
    return send(res, 404, { title: 'Not found' });
  } catch (error) {
    lastError = error.message;
    if (url.pathname === '/api/paytm/callback' || url.pathname === '/api/paytm/connect') {
      res.writeHead(302, { location: `/?paytm=failed&reason=${encodeURIComponent(error.message.slice(0, 160))}`, 'cache-control': 'no-store' });
      return res.end();
    }
    return send(res, error.status || 502, { title: error.message });
  }
}
