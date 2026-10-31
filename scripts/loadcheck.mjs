// How much the engines, fences and receipts can carry on one Node process, with no
// provider in the path. Runs its own server on a temporary data folder.
//   node scripts/loadcheck.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const data = mkdtempSync(path.join(tmpdir(), 'mitra-load-'));
const child = spawn('node', ['server/index.mjs'], { env: { PATH: process.env.PATH, PORT: '0', MITRA_DATA_DIR: data, MITRA_TRUST_PROXY: '1', MITRA_VOICE_CACHE: 'off' }, stdio: ['ignore', 'pipe', 'inherit'] });
const port = await new Promise((resolve) => child.stdout.on('data', (chunk) => { const found = String(chunk).match(/:(\d+)$/m); if (found) resolve(found[1]); }));
const API = `http://127.0.0.1:${port}/api/journey`;
const LINES = ['What does this loan really cost?', '45,000 a month', 'How much insurance do I need?', 'My claim was cut, why?', 'Is this message a scam?'];
let count = 0;
const call = async (who, route, body) => {
  const res = await fetch(`${API}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.${count++ % 250}.${who >> 8}.${who & 255}` }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
};

async function run(concurrency, seconds) {
  const stop = Date.now() + seconds * 1000;
  const times = [];
  let errors = 0;
  await Promise.all(Array.from({ length: concurrency }, async (_, who) => {
    while (Date.now() < stop) {
      try {
        const { state } = await call(who, '/session', { customerId: 'ramesh' });
        for (const text of LINES) {
          if (Date.now() >= stop) break;
          const started = performance.now();
          await call(who, `/${state.sessionId}/turn`, { text, modelOff: true });
          times.push(performance.now() - started);
        }
      } catch { errors += 1; }
    }
  }));
  times.sort((a, b) => a - b);
  return { concurrency, turns: times.length, turnsPerSecond: Math.round(times.length / seconds), p50: Math.round(times[Math.floor(times.length * 0.5)] || 0), p95: Math.round(times[Math.floor(times.length * 0.95)] || 0), errors };
}

const results = [];
for (const concurrency of [1, 10, 50, 200]) {
  const row = await run(concurrency, 8);
  results.push(row);
  console.log(row);
}
writeFileSync('docs/evaluations/load-test.json', `${JSON.stringify({ ranOn: new Date().toISOString(), note: 'One Node process, engines and fences only, no provider calls', results }, null, 1)}\n`);
child.kill();
rmSync(data, { recursive: true, force: true });
process.exit(0);
