import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readStore } from './store.mjs';
import { aiStatus, proxySarvam } from './aiProxy.mjs';
import { flushSessions, handleJourney } from './journeyApi.mjs';
import { handleAuth } from './accounts.mjs';
import { serveStatic } from './staticFiles.mjs';
import { acceptStream, handlePhone } from './telephony.mjs';
import { handleVoice } from './voiceStream.mjs';
import { handlePaytm } from './paytm.mjs';
import { opsSnapshot, prometheus } from './ops.mjs';

const PORT = Number(process.env.PORT || process.env.MITRA_API_PORT || 8787);
const HOST = process.env.MITRA_HOST || '127.0.0.1';

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function problem(res, status, title, detail = title) {
  json(res, status, { type: 'about:blank', title, status, detail });
}

// Fonts come from Google, as the page already declares. Everything else is our own.
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'permissions-policy': 'microphone=(self), camera=(self), geolocation=()',
  'strict-transport-security': 'max-age=31536000',
};
const LOG_JSON = process.env.MITRA_LOG === 'json';
const startedAt = Date.now();

// The path only: a voice URL carries the customer's words in its query string.
function logRequest(req, res, id, pathname, started) {
  if (!LOG_JSON) return;
  console.log(JSON.stringify({ at: new Date().toISOString(), id, method: req.method, path: pathname, status: res.statusCode, ms: Date.now() - started }));
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const requestId = randomUUID();
  res.setHeader('x-request-id', requestId);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    res.on('finish', () => logRequest(req, res, requestId, url.pathname, started));
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { status: 'ok', service: 'mitra-api', uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
    if (req.method === 'GET' && url.pathname === '/api/ready') {
      const store = await readStore(() => true).catch(() => false);
      const voiceReady = aiStatus().sarvam;
      const breakers = opsSnapshot().breakers;
      const open = Object.entries(breakers).filter(([, state]) => state.open).map(([name]) => name);
      return json(res, store ? 200 : 503, { ready: Boolean(store), store: Boolean(store), sarvamConfigured: voiceReady, degraded: open, note: open.length || !voiceReady ? 'Running on engines and rules: voice or model is unavailable' : 'All systems normal' });
    }
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
    if (url.pathname.startsWith('/api/auth/')) return await handleAuth(req, res, url);
    if (url.pathname.startsWith('/api/journey')) return await handleJourney(req, res, url);
    if (url.pathname.startsWith('/api/phone')) return await handlePhone(req, res, url);
    if (url.pathname.startsWith('/api/voice/')) return await handleVoice(req, res, url);
    if (url.pathname.startsWith('/api/paytm/')) return await handlePaytm(req, res, url);
    if (req.method === 'GET' && url.pathname === '/api/ops/metrics') {
      if (url.searchParams.get('format') === 'prometheus') { res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }); return res.end(prometheus()); }
      return json(res, 200, opsSnapshot());
    }

    // Sarvam, proxied so its key stays on the server. Bounded inside aiProxy.mjs.
    if (req.method === 'GET' && url.pathname === '/api/ai/status') return json(res, 200, aiStatus());
    if (req.method === 'POST' && url.pathname.startsWith('/api/ai/sarvam/')) return proxySarvam(req, res, url.pathname.slice('/api/ai/sarvam'.length));

    return problem(res, 404, 'Not found');
  } catch (error) {
    console.error(error);
    return problem(res, error.status || 500, error.status ? error.message : 'Internal server error');
  }
});

server.on('upgrade', acceptStream);

server.listen(PORT, HOST, () => console.log(`MITRA API listening on http://${HOST}:${server.address().port}`));

// A deploy waits for calls in progress, then exits cleanly.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => flushSessions().finally(() => process.exit(0)));
    setTimeout(() => flushSessions().finally(() => process.exit(0)), 8000).unref();
  });
}
