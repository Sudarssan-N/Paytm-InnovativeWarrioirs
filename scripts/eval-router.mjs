// Replays the blind-test questions through the production router and scam opinion.
//   node --env-file=.env scripts/eval-router.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { modelRiskOpinion, modelToolCall } from '../server/aiProxy.mjs';
import { modelInput, routeWithModel } from '../src/journeys/router.js';
import { checkPaymentRequest } from '../src/journeys/engines/payments.js';
import { SCAM_DECK } from '../src/journeys/game/scamDeck.js';

const all = JSON.parse(readFileSync('docs/blind-test/final-unseen-set.json', 'utf8'));
const set = all.filter((q) => q.src === 'model');
const results = [];
let at = 0;
// One at a time: the pay-as-you-go plan allows 60 chat calls a minute.
const paced = () => new Promise((resolve) => setTimeout(resolve, 1050));
const worker = async () => {
  while (at < set.length) {
    const q = set[at++];
    await paced();
    const started = Date.now();
    try {
      const call = await routeWithModel(modelInput(q.en, q.text), { complete: modelToolCall });
      results.push({ tool: call.name, want: q.intent, before: q.tool, wasGood: q.good, ms: Date.now() - started });
    } catch (error) { results.push({ tool: null, want: q.intent, before: q.tool, wasGood: q.good, ms: Date.now() - started, error: error.message }); }
  }
};
await worker();
const right = results.filter((r) => r.tool === r.want || (r.tool === r.before && r.wasGood)).length;
const ms = results.filter((r) => r.tool).map((r) => r.ms).sort((a, b) => a - b);
const scams = [];
for (const card of SCAM_DECK) {
  const engine = checkPaymentRequest(card.text);
  await paced();
  const opinion = await modelRiskOpinion(card.text).catch(() => 'unavailable');
  scams.push({ text: card.text.slice(0, 70), scam: card.scam, engine: engine.verdict, opinion });
}
const report = {
  model: process.env.MITRA_ROUTER_MODEL || 'sarvam-105b-conversations', ranOn: new Date().toISOString(),
  routing: { questions: results.length, answered: ms.length, right, pct: Math.round((right / results.length) * 100), p50: ms[Math.floor(ms.length * 0.5)], p90: ms[Math.floor(ms.length * 0.9)] },
  scamDeck: { cards: scams.length, stopped: scams.filter((s) => s.scam && (s.engine !== 'clear' || s.opinion === 'likely_scam')).length, scams: scams.filter((s) => s.scam).length, falseAlarms: scams.filter((s) => !s.scam && s.engine === 'stop').length, rows: scams },
};
writeFileSync('docs/evaluations/router-sarvam.json', `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify({ routing: report.routing, stopped: report.scamDeck.stopped, of: report.scamDeck.scams, falseAlarms: report.scamDeck.falseAlarms }));
for (const row of scams) console.log(row.scam ? 'SCAM ' : 'NORM ', row.engine.padEnd(8), row.opinion.padEnd(13), row.text);
process.exit(0);
