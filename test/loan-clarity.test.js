import test from 'node:test';
import assert from 'node:assert/strict';
import { amortisation, emiFor, explainLoanOffer, principalFor } from '../src/journeys/engines/lending.js';
import { cashFlowWithLoan, classifyCredit, classifyDebit, comfortableLoan, feePctOf, incomeProfile, mergeReceipts, statedProfile } from '../src/journeys/engines/income.js';
import { applyEdits, incomeReadBackLine, interpretIncomeDocument, parseRupees, parseStatementDate, profileFromDocuments } from '../src/journeys/incomeRead.js';
import { INCOME_SAMPLES } from '../src/journeys/sampleIncome.js';
import { LOAN_OFFERS } from '../src/journeys/sampleData.js';
import { grantConsent, readFact, recordFact, revokeConsent } from '../src/journeys/consent.js';
import { routeBroad, routeByRules } from '../src/journeys/router.js';
import { validateToolCall } from '../src/journeys/tools.js';
import { createSession, takeTurn } from '../src/journeys/orchestrator.js';

const OFFER = LOAN_OFFERS['KFS-v3-0412'];
const NOW = Date.parse('2026-10-31T10:00:00Z');
const say = (session, text, extra = {}) => takeTurn(session, { text, textEn: text, lang: 'en', ...extra }, { now: NOW, modelOff: true });

// What Sarvam Vision returns for a sample, as it really read them: day-first dates and plain numbers.
const ddmmyyyy = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const statementRead = (sample) => ({
  result: {
    doc_kind: 'bank_statement', holder: sample.holder, issuer: sample.statement.bank, period_from: ddmmyyyy(sample.statement.from), period_to: ddmmyyyy(sample.statement.to),
    transactions: sample.statement.rows.map((row) => ({ date: ddmmyyyy(row.date), description: row.description, debit: row.debit, credit: row.credit })),
  },
});
const receiptRead = (receipt) => ({ result: { doc_kind: 'payment_receipt', receipt_amount: receipt.amount, receipt_date: '25 Oct 2026'.replace('25', receipt.date.slice(8)), receipt_from: receipt.payer, receipt_reference: receipt.reference } });
const riderDocs = () => {
  const rider = INCOME_SAMPLES.rider;
  return [
    interpretIncomeDocument(statementRead(rider), { hash: 'a'.repeat(64), name: rider.statement.file }),
    ...rider.receipts.map((receipt, i) => interpretIncomeDocument(receiptRead(receipt), { hash: `${i}`.repeat(64), name: receipt.file })),
    interpretIncomeDocument({ result: { doc_kind: 'income_tax_return', assessment_year: '2026-27', gross_total_income: 468000 } }, { hash: 'c'.repeat(64), name: rider.tax.file }),
  ];
};
const riderProfile = () => profileFromDocuments(riderDocs());

// ── the engine ──────────────────────────────────────────────────
test('every way a gig worker or shop is paid is sorted, and money that is not earned is left out', () => {
  assert.equal(classifyCredit('NEFT CR ZIPEATS PARTNER PAYOUTS WK19'), 'platform');
  assert.equal(classifyCredit('IMPS CR QUICKRIDE DRIVER EARNINGS'), 'platform');
  assert.equal(classifyCredit('UPI SETTLEMENT SOUNDBOX LAKSHMI STORES'), 'upi');
  assert.equal(classifyCredit('CASH DEPOSIT CDM ANNA NAGAR'), 'cash');
  assert.equal(classifyCredit('NEFT CR ACME PVT LTD SALARY OCT'), 'salary');
  assert.equal(classifyCredit('UPI CR REFUND ZIPEATS ORDER CANCEL'), 'excluded');
  assert.equal(classifyCredit('IMPS CR SELF TRANSFER RAMESH K SAVINGS'), 'excluded');
  assert.equal(classifyCredit('NEFT CR PERSONAL LOAN DISBURSAL'), 'excluded');
  assert.equal(classifyCredit('NEFT CR R SURESH'), 'other');
  assert.equal(classifyDebit('ACH DR TWO WHEELER LOAN EMI SAMPLE AUTO FIN'), 'emi');
  assert.equal(classifyDebit('NEFT DR SRI MURUGAN WHOLESALE TRADERS'), 'business');
  assert.equal(classifyDebit('UPI DR RENT TO S MURUGAN'), 'rent');
  assert.equal(classifyDebit('UPI DR SAMPLE FUELS'), 'spend');
});

test('the rider’s six months come out to the figures shown on the demo', () => {
  const p = incomeProfile({ transactions: INCOME_SAMPLES.rider.statement.rows });
  assert.deepEqual(p.months.map((month) => month.net), [47260, 36320, 45430, 48980, 52310, 55200]);
  assert.equal(p.average, 47583);
  assert.equal(p.median, 48120);
  assert.equal(p.weakAverage, 43003);
  assert.equal(p.counted, 43000, 'the lower of median and weak months, rounded down');
  assert.equal(p.existingEmi, 3200);
  assert.equal(p.comfortableEmi, 9700, '30% of 43,000 less the existing EMI');
  assert.equal(p.stretchEmi, 14000);
  assert.equal(p.excluded.length, 2);
  assert.deepEqual(p.streams.map((stream) => stream.id), ['platform', 'cash']);
  assert.equal(p.steadiness, 'steady');
  assert.equal(p.enoughHistory, true);
});

test('a shop counts what it keeps after stock, and a GST return far from the bank is flagged', () => {
  const kirana = INCOME_SAMPLES.kirana;
  const p = incomeProfile({ transactions: kirana.statement.rows, declared: [{ kind: 'turnover', annual: kirana.tax.turnover, label: 'GST return' }] });
  assert.equal(p.months[0].income, 345400);
  assert.equal(p.months[0].business, 272900);
  assert.equal(p.months[0].net, 72500);
  assert.equal(p.counted, 72500);
  assert.equal(p.existingEmi, 0);
  assert.equal(p.declared[0].monthly, 240000);
  assert.equal(p.declared[0].observed, 371350, 'turnover is compared with sales, not with what is kept');
  assert.equal(p.declared[0].gapPct, 54.7);
  assert.equal(p.declared[0].flagged, true);
});

test('existing EMIs that already use the safe share leave no room, never a negative EMI', () => {
  const rows = ['2026-08', '2026-09', '2026-10'].flatMap((month) => [
    { date: `${month}-01`, description: 'NEFT CR ZIPEATS PARTNER PAYOUTS', credit: 20000, debit: 0 },
    { date: `${month}-05`, description: 'ACH DR PERSONAL LOAN EMI', credit: 0, debit: 9000 },
  ]);
  const p = incomeProfile({ transactions: rows });
  assert.equal(p.comfortableEmi, 0);
  assert.equal(p.stretchEmi, 0);
  assert.equal(comfortableLoan(p, { ratePct: 14, months: 24 }), 0);
});

test('two months of statements is labelled as too short', () => {
  const rows = INCOME_SAMPLES.rider.statement.rows.filter((row) => row.date >= '2026-09-01');
  const p = incomeProfile({ transactions: rows });
  assert.equal(p.monthCount, 2);
  assert.equal(p.enoughHistory, false);
});

test('a tax return alone is used, and labelled as declared', () => {
  const p = incomeProfile({ declared: [{ kind: 'income', annual: 468000, label: 'income tax return' }] });
  assert.equal(p.basis, 'declared');
  assert.equal(p.counted, 39000);
  assert.equal(p.enoughHistory, false);
});

test('a receipt already on the statement counts once, and one after it ends is not counted', () => {
  const rows = INCOME_SAMPLES.rider.statement.rows;
  const receipts = [
    { date: '2026-10-25', description: 'UPI receipt from ZIPEATS PARTNER PAYOUTS', credit: 11640, debit: 0 },
    { date: '2026-10-30', description: 'UPI receipt from S KUMAR', credit: 1500, debit: 0 },
    { date: '2026-11-02', description: 'UPI receipt from S KUMAR', credit: 900, debit: 0 },
  ];
  const merged = mergeReceipts(rows, receipts, { from: '2026-05-01', to: '2026-10-31' });
  assert.equal(merged.duplicates.length, 1);
  assert.equal(merged.added.length, 1);
  assert.equal(merged.outside.length, 1);
  assert.equal(merged.transactions.length, rows.length + 1);
});

test('the simulator gives the KFS figures at the offer’s terms, and a longer term lowers the EMI but costs more', () => {
  const p = incomeProfile({ transactions: INCOME_SAMPLES.rider.statement.rows });
  const feePct = feePctOf(OFFER);
  const offer = cashFlowWithLoan(p, { principal: OFFER.principal, ratePct: OFFER.ratePct, months: OFFER.months, feePct });
  const kfs = explainLoanOffer(OFFER);
  assert.equal(offer.emi, kfs.emi);
  assert.equal(offer.fees, kfs.fees);
  assert.equal(offer.aprPct, kfs.aprPct);
  assert.equal(offer.sharePct, 29.8, '(9,603 + 3,200) of 43,000');
  assert.equal(offer.band, 'fits');
  assert.equal(offer.monthly.length, 6);
  assert.equal(offer.tightMonths, 0);
  const longer = cashFlowWithLoan(p, { principal: OFFER.principal, ratePct: OFFER.ratePct, months: 36, feePct });
  assert.ok(longer.emi < offer.emi);
  assert.ok(longer.totalCost > offer.totalCost);
  const big = cashFlowWithLoan(p, { principal: 500000, ratePct: OFFER.ratePct, months: 24, feePct });
  assert.equal(big.band, 'stretch');
  assert.ok(big.tightMonths >= 1);
  assert.equal(cashFlowWithLoan(null, { principal: 100000, ratePct: 12, months: 12 }).band, null);
});

test('the largest comfortable loan has an EMI inside the comfortable band', () => {
  const p = incomeProfile({ transactions: INCOME_SAMPLES.rider.statement.rows });
  const loan = comfortableLoan(p, { ratePct: 14, months: 24 });
  assert.ok(emiFor(loan, 14, 24) <= p.comfortableEmi);
  assert.ok(emiFor(loan + 2000, 14, 24) > p.comfortableEmi - 100);
  assert.ok(Math.abs(principalFor(emiFor(200000, 14, 24), 14, 24) - 200000) < 50);
});

test('the yearly schedule repays the whole loan, and the first year is the most interest', () => {
  const years = amortisation(200000, 14, 24);
  assert.equal(years.length, 2);
  assert.equal(years.reduce((total, year) => total + year.principal, 0), 200000);
  assert.equal(years.at(-1).balance, 0);
  assert.ok(years[0].interest > years[1].interest);
});

test('a stated income is labelled as the customer’s word', () => {
  const p = statedProfile(45000);
  assert.equal(p.basis, 'stated');
  assert.equal(p.comfortableEmi, 13500);
});

// ── reading the papers ──────────────────────────────────────────
test('statement dates and amounts are read the way Indian statements write them', () => {
  assert.equal(parseStatementDate('04-05-2026'), '2026-05-04');
  assert.equal(parseStatementDate('04/05/26'), '2026-05-04');
  assert.equal(parseStatementDate('4 May 2026'), '2026-05-04');
  assert.equal(parseStatementDate('04-May-2026'), '2026-05-04');
  assert.equal(parseStatementDate('Oct 25, 2026'), '2026-10-25');
  assert.equal(parseStatementDate('2026-10-25'), '2026-10-25');
  assert.equal(parseStatementDate('31-13-2026'), null);
  assert.equal(parseStatementDate('soon'), null);
  assert.equal(parseRupees('₹1,02,443.00'), 102443);
  assert.equal(parseRupees('9,850.00 Cr'), 9850);
  assert.equal(parseRupees('-'), 0);
  assert.equal(parseRupees(-500), 0);
});

test('a statement as Sarvam Vision reads it gives back every line, and unreadable lines are left out', () => {
  const rider = INCOME_SAMPLES.rider;
  const doc = interpretIncomeDocument(statementRead(rider), { name: 'statement.pdf' });
  assert.equal(doc.usable, true);
  assert.equal(doc.transactions.length, rider.statement.rows.length);
  assert.deepEqual(doc.period, { from: '2026-05-01', to: '2026-10-31' });
  const messy = interpretIncomeDocument({ result: { doc_kind: 'bank_statement', transactions: [{ date: '??', description: 'smudge', credit: 500 }, { date: '01-10-2026', description: 'NEFT CR X', credit: '₹2,000.00' }] } });
  assert.equal(messy.transactions.length, 1);
  assert.equal(messy.transactions[0].credit, 2000);
  assert.match(messy.problems[0], /1 lines could not be read/);
});

test('a receipt, a tax return and something else are each read for what they are', () => {
  const receipt = interpretIncomeDocument({ result: { doc_kind: 'payment_receipt', receipt_amount: 1500, receipt_date: '30 Oct 2026', receipt_from: 'S KUMAR' } });
  assert.equal(receipt.receipts[0].credit, 1500);
  assert.equal(receipt.receipts[0].stream, 'upi');
  const gst = interpretIncomeDocument({ result: { doc_kind: 'gst_return', financial_year: '2025-26', aggregate_turnover: 2880000 } });
  assert.deepEqual(gst.declared[0], { kind: 'turnover', annual: 2880000, label: 'GST return', source: 'GST return, FY 2025-26' });
  const blank = interpretIncomeDocument({ result: { doc_kind: 'payment_receipt' } });
  assert.equal(blank.usable, false);
  assert.equal(interpretIncomeDocument({ result: { doc_kind: 'insurance_policy' } }).usable, false);
});

test('the customer’s corrections are applied, and nonsense amounts are ignored', () => {
  const docs = riderDocs();
  const firstPayout = docs[0].transactions.findIndex((row) => row.credit === 9850);
  const { docs: edited, changed } = applyEdits(docs, [
    { doc: 0, row: firstPayout, include: false },
    { doc: 0, row: firstPayout + 1, amount: -5 },
    { doc: 0, row: firstPayout + 1, amount: 1e12 },
    { doc: 9, row: 0, include: false },
  ]);
  assert.equal(changed, 1);
  assert.equal(edited[0].transactions[firstPayout].include, false);
  assert.equal(docs[0].transactions[firstPayout].include, true, 'the original is untouched');
  const before = profileFromDocuments(docs), after = profileFromDocuments(edited);
  assert.equal(before.months[0].net - after.months[0].net, 9850);
});

test('all the rider’s papers together: one receipt counted once, one added, the ITR cross-checked', () => {
  const p = riderProfile();
  assert.equal(p.receipts.duplicates, 1);
  assert.equal(p.receipts.added, 1);
  assert.equal(p.months.at(-1).net, 55200 + 1500);
  assert.equal(p.declared[0].source, 'Income tax return, AY 2026-27');
  assert.equal(p.declared[0].flagged, false);
  assert.equal(p.documents.length, 4);
  assert.match(incomeReadBackLine(riderDocs()), /bank statement with 38 money-in lines, a receipt for ₹11,640, a receipt for ₹1,500 and your income tax return/);
});

// ── consent, routing and the agent ──────────────────────────────
test('income from papers is read only by the lending agent, and only under its own consent', () => {
  const session = createSession({ id: 's1', now: NOW });
  recordFact(session, 'incomeProfile', riderProfile(), { agent: 'lending', firstFor: 'lending', now: NOW });
  assert.equal(readFact(session, { agent: 'lending', field: 'incomeProfile', purpose: 'affordability', now: NOW }).status, 'no_consent');
  grantConsent(session, 'affordability', { now: NOW });
  assert.equal(readFact(session, { agent: 'lending', field: 'incomeProfile', purpose: 'affordability', now: NOW }).status, 'ok');
  assert.equal(readFact(session, { agent: 'insurance', field: 'incomeProfile', purpose: 'affordability', now: NOW }).status, 'denied');
  revokeConsent(session, 'affordability', { now: NOW });
  assert.equal(readFact(session, { agent: 'lending', field: 'incomeProfile', purpose: 'affordability', now: NOW }).status, 'no_consent');
});

test('affordability and what-if questions reach the new tools, and older routes still hold', () => {
  const to = (text) => routeByRules(text)?.name;
  assert.equal(to('Can I afford this loan?'), 'check_affordability');
  assert.equal(to('I deliver food and have no salary slip. How much can I borrow?'), 'check_affordability');
  assert.equal(to('How much can I safely borrow?'), 'check_affordability');
  assert.equal(to('Am I eligible for this loan?'), 'check_affordability');
  assert.equal(to('What if I take it for 36 months?'), 'simulate_terms');
  assert.equal(to('What if I borrow ₹2,50,000 for 36 months?'), 'simulate_terms');
  assert.equal(to('Can I reduce my EMI?'), 'simulate_terms');
  assert.equal(to('What if I borrow 1.5 lakh for 24 months?'), 'simulate_terms');
  assert.equal(to('I need money for stock for my shop'), 'merchant_eligibility');
  assert.equal(to('I took a loan of 2 lakh at 14% for 2 years, what does it cost?'), 'explain_loan_offer');
  assert.equal(to('I cannot afford my EMI, I lost my job'), 'handoff_to_human');
  assert.equal(to('Should I prepay or invest ₹50,000?'), 'prepay_vs_invest');
  assert.equal(routeBroad('my income changes every month, can I take this')?.name, 'check_affordability');
  assert.equal(validateToolCall({ name: 'simulate_terms', arguments: { offer_id: OFFER.id } }).ok, true);
  assert.equal(validateToolCall({ name: 'check_affordability', arguments: { amount: 500000 } }).ok, false);
});

test('without papers, MITRA asks for them and offers one number instead', async () => {
  const session = createSession({ id: 's2', now: NOW });
  const turn = await say(session, 'Can I afford this loan?');
  assert.equal(turn.tool, 'check_affordability');
  assert.ok(!turn.blocked);
  assert.match(turn.reply, /Read my income papers/);
  assert.match(turn.reply, /What is your monthly income\?/);
  const answer = await say(session, '₹45,000 a month');
  assert.equal(answer.tool, 'check_affordability');
  assert.ok(!answer.blocked, answer.trace.find((event) => event.kind === 'grounding')?.detail);
  assert.match(answer.reply, /On the ₹45,000 income you told me, an EMI up to ₹13,500 is comfortable/);
  assert.equal(answer.passport.title, 'Affordability worked out from the income the customer said');
});

const sessionWithPapers = (id) => {
  const session = createSession({ id, now: NOW });
  recordFact(session, 'incomeProfile', riderProfile(), { agent: 'lending', firstFor: 'lending', now: NOW });
  grantConsent(session, 'affordability', { now: NOW });
  return session;
};

test('with confirmed papers, affordability is explained from them, every figure grounded', async () => {
  const session = sessionWithPapers('s3');
  const turn = await say(session, 'Can I afford this loan?', { tapped: true });
  assert.equal(turn.tool, 'check_affordability');
  assert.ok(!turn.blocked, turn.trace.find((event) => event.kind === 'grounding')?.detail);
  assert.equal(turn.card.type, 'affordability');
  assert.match(turn.reply, /From 6 months of your papers, you earned ₹47,833 a month on average/);
  assert.match(turn.reply, /I count ₹43,000/);
  assert.match(turn.reply, /After your existing EMI of ₹3,200, an EMI up to ₹9,700 is comfortable/);
  assert.match(turn.reply, /This offer's EMI of ₹9,603 fits comfortably/);
  assert.match(turn.reply, /In your weakest month, Jun 2026/);
  assert.equal(turn.passport.consent[0].purpose, 'affordability');
  assert.ok(turn.trace.some((event) => event.kind === 'consent' && /Read income from your papers/.test(event.label)));
});

test('the loan explainer uses the papers instead of asking for income, and lists the charges to watch', async () => {
  const session = sessionWithPapers('s4');
  const turn = await say(session, 'What does this loan really cost?');
  assert.equal(turn.tool, 'explain_loan_offer');
  assert.ok(!turn.blocked);
  assert.doesNotMatch(turn.reply, /What is your monthly income/);
  assert.match(turn.reply, /With your existing EMI of ₹3,200, your EMIs would be 30% of the ₹43,000 I count from your papers/);
  assert.equal(turn.card.data.charges.find((charge) => charge.label === 'Closing early').known, false);
  assert.equal(turn.card.data.schedule.length, 2);
});

test('what-if turns compare with the offer and stay grounded', async () => {
  const session = sessionWithPapers('s5');
  const longer = await say(session, 'What if I take it for 36 months?');
  assert.equal(longer.tool, 'simulate_terms');
  assert.ok(!longer.blocked, longer.trace.find((event) => event.kind === 'grounding')?.detail);
  const emi36 = emiFor(200000, 14, 36);
  assert.match(longer.reply, new RegExp(`over 36 months: the EMI is ₹${emi36.toLocaleString('en-IN')}`));
  assert.match(longer.reply, /less than the offer's ₹9,603/);
  assert.match(longer.reply, /because you pay interest for longer/);
  const lower = await say(session, 'Can I reduce my EMI?');
  assert.equal(lower.card.data.sim.months, 36);
  const bigger = await say(session, 'What if I borrow ₹5,00,000 for 24 months?');
  assert.ok(!bigger.blocked);
  assert.equal(bigger.card.data.sim.principal, 500000);
  assert.match(bigger.reply, /is more than I would call safe/);
  assert.match(bigger.reply, /tight in \d of your 6 months/);
});
