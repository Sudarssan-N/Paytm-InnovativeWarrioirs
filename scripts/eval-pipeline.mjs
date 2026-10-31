// The blind test's 192 unseen customer questions, through the whole live pipeline.
//   node scripts/eval-pipeline.mjs [api]     (the server must be running)
import { readFileSync, writeFileSync } from 'node:fs';

const API = process.argv[2] || 'http://127.0.0.1:8787';
const set = JSON.parse(readFileSync('docs/blind-test/final-unseen-set.json', 'utf8'));
const post = async (route, body) => {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(`${API}/api/journey${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 429 && attempt < 5) { await new Promise((resolve) => setTimeout(resolve, 5000)); continue; }
    if (!res.ok) throw new Error(`${route} ${res.status}`);
    return res.json();
  }
};
const SAFE = new Set(['clarify_request', 'handoff_to_human', 'say_simpler']);
const rows = [];
for (const q of set) {
  const started = Date.now();
  try {
    const { state } = await post('/session', { customerId: q.intent === 'merchant_eligibility' ? 'lakshmi' : 'ramesh' });
    const turn = await post(`/${state.sessionId}/turn`, { text: q.text });
    // What the router chose. A tool may then ask for income first, which is still right.
    const routed = turn.trace.map((event) => (event.kind === 'route' ? event.label.match(/chose (\w+)/)?.[1] : null)).find(Boolean);
    const tool = routed || turn.tool;
    const want = q.intent === 'OUT_OF_SCOPE' ? 'clarify_request' : q.intent;
    const result = tool === want || (q.good && tool === q.tool) ? 'correct' : SAFE.has(tool) ? 'safe_miss' : 'wrong';
    rows.push({ intent: q.intent, lang: q.lang, text: q.text.slice(0, 120), tool, finalTool: turn.tool, result, replyLang: turn.reply.lang, rejected: turn.reply.rejected, ms: Date.now() - started });
  } catch (error) { rows.push({ intent: q.intent, lang: q.lang, text: q.text.slice(0, 120), tool: null, result: 'error', error: error.message, ms: Date.now() - started }); }
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
const count = (name) => rows.filter((row) => row.result === name).length;
const ms = rows.map((row) => row.ms).sort((a, b) => a - b);
const report = { ranOn: new Date().toISOString(), questions: rows.length, correct: count('correct'), safeMiss: count('safe_miss'), wrong: count('wrong'), errors: count('error'), sentencesRejected: rows.reduce((sum, row) => sum + (row.rejected || 0), 0), p50: ms[Math.floor(ms.length * 0.5)], p90: ms[Math.floor(ms.length * 0.9)], rows };
writeFileSync('docs/evaluations/pipeline-sarvam.json', `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify({ ...report, rows: undefined }));
for (const row of rows.filter((item) => item.result === 'wrong')) console.log(`${row.intent} -> ${row.tool} [${row.lang}] ${row.text}`);
process.exit(0);
