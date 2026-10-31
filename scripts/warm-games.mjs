// Translates every line in the games ahead of time, one a second, so a language opens
// instantly on stage. It goes through the same figures fence as anything else.
//   node --env-file=.env scripts/warm-games.mjs [langs] [api]
import { buildLevel, LABELS, lessonLine, levelIds, quizFor } from '../src/journeys/game/loanGame.js';
import { gradeCard, SCAM_DECK } from '../src/journeys/game/scamDeck.js';

const LANGS = (process.argv[2] || 'ta,hi,te,kn,bn,mr,gu,ml,od,pa').split(',');
const API = process.argv[3] || 'http://127.0.0.1:8787';
const SCAM_UI = ['Ten requests. Block the trap, or pay the real one. One wrong tap can cost you everything, so read each one.', 'Block it', 'It is safe', 'Right.', 'Careful.', 'Next', 'This was a trap', 'This one was real', 'Play again', 'Your Fraud IQ', 'Sealed on your Journey Passport', 'Check a real message with MITRA'];
const CLAIM_UI = ['The insurer cut this hospital bill. Some cuts follow the policy, and some do not. Tap every line you think was cut unfairly.', 'Bill item', 'Billed', 'Paid', 'Looks wrong', 'Looks fair', 'Open the case', 'Try again', 'You found', 'Why', 'Draft the grievance with MITRA', 'Right', 'Missed', 'This cut was fair', 'Money you are owed'];
const level = buildLevel('personal');
const lines = new Set([...Object.values(LABELS), ...SCAM_UI, ...CLAIM_UI, ...SCAM_DECK.flatMap((card) => [card.text, gradeCard(card, card.scam).why])]);
for (const id of levelIds()) {
  const each = buildLevel(id);
  lines.add(lessonLine('fee', each));
  lines.add(lessonLine('apr', each));
  for (const question of quizFor(each)) { lines.add(question.q); for (const option of question.options) lines.add(option); }
}
for (const id of ['scam', 'bill', 'repair', 'shield_buy', 'shield_used']) lines.add(lessonLine(id, level, { amount: level[id === 'scam' ? 'scam' : id === 'repair' ? 'repair' : id === 'shield_buy' ? 'premium' : 'medical'] }));

const list = [...lines];
console.log(`${list.length} lines, ${LANGS.length} languages`);
for (const lang of LANGS) {
  let done = 0;
  for (const line of list) {
    try {
      await fetch(`${API}/api/journey/game/translate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang, lines: { line } }) });
      done += 1;
    } catch { /* picked up next time */ }
    await new Promise((resolve) => setTimeout(resolve, 1050));
  }
  console.log(`${lang}: ${done}/${list.length}`);
}
process.exit(0);
