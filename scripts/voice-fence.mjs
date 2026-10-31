// The spoken-figure check, on what MITRA really says, in every language it speaks.
// Bulbul says it, Saaras hears it back, and every figure must be heard as written.
// It fills the voice cache as it goes. Run it before a release:
//   node --env-file=.env scripts/voice-fence.mjs [langs]
import { writeFileSync } from 'node:fs';
import { splitSentences, translateFenced } from '../server/sarvamServer.mjs';
import { streamSpeech, verifySpeech } from '../server/voiceStream.mjs';
import { explainLoanOffer } from '../src/journeys/engines/lending.js';
import { explainMerchantOffer, merchantEligibility } from '../src/journeys/engines/merchant.js';
import { inr, pct } from '../src/journeys/money.js';
import { LOAN_OFFERS, MERCHANT_OFFER, MERCHANT_SALES } from '../src/journeys/sampleData.js';

const loan = explainLoanOffer(LOAN_OFFERS['KFS-v3-0412']);
const shop = explainMerchantOffer(MERCHANT_OFFER, merchantEligibility(MERCHANT_SALES));
const LINES = [
  `With the ${inr(loan.fees)} fee, the APR is ${pct(loan.aprPct)}.`,
  `You get ${inr(loan.net)} and repay ${inr(loan.totalRepay)}, at ${inr(loan.emi)} a month.`,
  'The APR is 21%, not the 14% shown.',
  `The working capital loan is ${inr(shop.principal)}, at ${inr(shop.dailyRepayment)} a day, and the APR is ${pct(shop.aprPct)}.`,
  'The insurer paid ₹93,750, and ₹14,250 looks wrong.',
  'You need about ₹71,00,000 more life cover.',
  // Figures chosen to break a voice: tens after hundreds, nines, and round lakhs.
  'The amounts are ₹590, ₹1,250, ₹7,890, ₹12,345, ₹99,990 and ₹3,41,250.',
];
const LANGS = (process.argv[2] || 'en,hi,ta,te,bn,mr,gu,kn,ml,od,pa').split(',');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const retry = async (work) => {
  for (let attempt = 0; ; attempt += 1) {
    try { return await work(); } catch (error) {
      if (attempt >= 5) throw error;
      await pause(3000 * (attempt + 1));
    }
  }
};

const rows = [];
for (const lang of LANGS) {
  for (const english of LINES) {
    const fenced = lang === 'en' ? { native: english, lines: [{ ok: true }] } : await translateFenced(english, lang);
    const spec = { text: fenced.native, lang, speaker: 'neha', pace: 1 };
    let row = { lang, english, native: fenced.native, textFence: fenced.lines.every((line) => line.ok !== false) };
    try {
      await retry(() => streamSpeech(spec, () => {}));
      const out = await retry(() => verifySpeech(spec));
      row = { ...row, spokenFence: out.ok, missing: out.missing, dateMisread: out.dateMisread, heard: out.heard };
    } catch (error) { row = { ...row, spokenFence: null, error: error.message }; }
    rows.push(row);
    process.stdout.write(row.spokenFence ? '.' : row.spokenFence === false ? 'x' : '?');
    await pause(300);
  }
  const mine = rows.filter((row) => row.lang === lang);
  console.log(` ${lang}: ${mine.filter((row) => row.spokenFence).length}/${mine.length}`);
}
const checked = rows.filter((row) => row.spokenFence != null);
const report = { ranOn: new Date().toISOString(), voice: 'bulbul:v3, neha', hearing: 'saaras:v3, translate mode', lines: LINES.length, languages: LANGS.length, passed: checked.filter((row) => row.spokenFence).length, checked: checked.length, dateMisreads: rows.filter((row) => row.dateMisread).length, failures: rows.filter((row) => row.spokenFence === false), errors: rows.filter((row) => row.spokenFence == null).length, rows };
writeFileSync('docs/evaluations/voice-fence.json', `${JSON.stringify(report, null, 1)}\n`);
console.log(`\n${report.passed}/${report.checked} sentences heard as written. Date misreads: ${report.dateMisreads}. Errors: ${report.errors}.`);
for (const row of report.failures) console.log(`  ${row.lang} | ${row.native}\n     missing ${row.missing?.join(', ')} | heard: ${row.heard}`);
process.exit(0);
