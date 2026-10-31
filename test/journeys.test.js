import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as edSign, verify as edVerify } from 'node:crypto';
import { aprPct, coolingOffStatus, emiFor, explainLoanOffer, foreclosureTerms, periodicIrr, prepayVsInvest } from '../src/journeys/engines/lending.js';
import { explainPlans, freeLookStatus, protectionGap } from '../src/journeys/engines/insurance.js';
import { claimChecklist, draftGrievance, explainDeductions } from '../src/journeys/engines/claims.js';
import { checkPaymentRequest, isOnlyAsking } from '../src/journeys/engines/payments.js';
import { explainMerchantOffer, merchantEligibility } from '../src/journeys/engines/merchant.js';
import { CLAIM, INSURANCE_PLANS, ISSUED_POLICY, LOAN_OFFERS, MERCHANT_OFFER, MERCHANT_SALES, POLICY_WORDING, SAMPLE_MESSAGES } from '../src/journeys/sampleData.js';
import { assertGrounded, checkFigures, parseAmount, parseDependants, parseLoanTerms, parseYesNo } from '../src/journeys/money.js';
import { readFact, recordFact, grantConsent, revokeConsent } from '../src/journeys/consent.js';
import { sealPassport, verifyChain } from '../src/journeys/passport.js';
import { routeBroad, routeByRules } from '../src/journeys/router.js';
import { TOOLS, toolsForModel, validateToolCall } from '../src/journeys/tools.js';
import { createSession, takeTurn } from '../src/journeys/orchestrator.js';

const OFFER = LOAN_OFFERS['KFS-v3-0412'];
const NOW = Date.parse('2026-10-31T10:00:00Z');
const TODAY = '2026-10-31';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const say = (session, text, extra = {}) => takeTurn(session, { text, textEn: text, lang: 'en', ...extra }, { now: NOW, modelOff: true });

// ── lending ────────────────────────────────────────────────────
test('the loan on slide 5 comes out to the deck’s exact figures', () => {
  const r = explainLoanOffer(OFFER, { income: 45000 });
  assert.equal(r.emi, 9603);
  assert.equal(r.fees, 7080);
  assert.equal(r.net, 192920);
  assert.equal(r.totalRepay, 230472);
  assert.equal(r.aprPct, 17.7);
  assert.equal(Math.round(r.fit.sharePct), 21);
  assert.equal(r.fit.band, 'fits');
  assert.equal(r.formula, 'APR = 12 × monthly IRR(+192920, 24 × −9603)');
});

test('IRR recovers a known rate and refuses impossible cash flows', () => {
  assert.ok(Math.abs(aprPct(emiFor(100000, 12, 12) * 11.2551, emiFor(100000, 12, 12), 12, 12) - 12) < 0.01);
  assert.ok(Math.abs(periodicIrr(100000, 10000, 10)) < 1e-9);
  assert.throws(() => periodicIrr(100000, 1000, 10), RangeError);
  assert.throws(() => periodicIrr(0, 1000, 10), RangeError);
});

test('a zero-rate loan does not divide by zero', () => {
  assert.equal(emiFor(120000, 0, 12), 10000);
});

test('EMI bands move with income', () => {
  assert.equal(explainLoanOffer(OFFER, { income: 25000 }).fit.band, 'tight');
  assert.equal(explainLoanOffer(OFFER, { income: 20000 }).fit.band, 'stretch');
  assert.equal(explainLoanOffer(OFFER).fit, null);
});

test('cooling-off runs from signing and exit cost uses days held', () => {
  assert.equal(coolingOffStatus(OFFER, { today: TODAY }).signed, false);
  const r = coolingOffStatus(OFFER, { signedOn: TODAY, today: TODAY });
  assert.equal(r.endsOn, '2026-11-03');
  assert.equal(r.remindOn, '2026-11-02');
  assert.equal(r.daysLeft, 3);
  assert.equal(r.exitCost, 200000 + Math.round((200000 * 0.177 * 3) / 365));
  assert.equal(coolingOffStatus(OFFER, { signedOn: '2026-10-01', today: TODAY }).open, false);
});

test('foreclosure: unknown stays unknown, and only the settled RBI case is answered', () => {
  assert.equal(foreclosureTerms(OFFER).known, false);
  const floating = { ...OFFER, rateType: 'floating', issuedOn: '2026-02-01' };
  assert.equal(foreclosureTerms(floating).terms, 'no pre-payment charge');
  assert.equal(foreclosureTerms({ ...floating, purpose: 'business' }).known, false);
  assert.equal(foreclosureTerms({ ...floating, issuedOn: '2025-12-31' }).known, false);
  assert.equal(foreclosureTerms({ ...OFFER, foreclosure: '2% of outstanding' }).terms, '2% of outstanding');
});

test('prepaying saves real interest and shortens the loan', () => {
  const r = prepayVsInvest(OFFER, { extra: 50000 });
  assert.ok(r.interestSaved > 0 && r.monthsSaved >= 1);
  assert.equal(r.better, r.interestSaved >= r.investGain ? 'prepay' : 'invest');
});

// ── insurance ──────────────────────────────────────────────────
test('protection gap follows income, dependants and existing cover', () => {
  const r = protectionGap({ income: 45000, dependants: 3, existingLife: 1000000, existingHealth: 300000, city: 'Chennai' });
  assert.equal(r.life.target, 8100000);
  assert.equal(r.life.gap, 7100000);
  assert.equal(r.health.target, 1500000);
  assert.equal(r.health.gap, 1200000);
  assert.equal(protectionGap({ income: 45000, dependants: 0, existingLife: 99999999, city: 'Madurai' }).life.gap, 0);
  assert.equal(protectionGap({ income: 45000, dependants: 0, city: 'Madurai' }).health.target, 1000000);
  assert.equal(protectionGap({ income: 45000, dependants: 9 }).multiple, 15);
});

test('the free-look window is 30 days from receipt', () => {
  const r = freeLookStatus(ISSUED_POLICY, { today: TODAY });
  assert.equal(r.days, 30);
  assert.equal(r.endsOn, '2026-11-11');
  assert.equal(r.remindOn, '2026-11-08');
  assert.equal(r.daysLeft, 11);
  assert.equal(freeLookStatus(ISSUED_POLICY, { today: '2026-12-01' }).open, false);
});

test('plans are compared with the gap they close', () => {
  const gap = protectionGap({ income: 45000, dependants: 3, existingLife: 1000000, existingHealth: 300000, city: 'Chennai' });
  const r = explainPlans(INSURANCE_PLANS, gap);
  assert.equal(r.plans.find((plan) => plan.id === 'term-a').closesGap, true);
  assert.equal(explainPlans(INSURANCE_PLANS, null).plans[0].closesGap, null);
});

// ── claims ─────────────────────────────────────────────────────
test('claim explainer catches the proportionate cut on pharmacy and diagnostics', () => {
  const r = explainDeductions({ claim: CLAIM, wording: POLICY_WORDING });
  assert.equal(r.billed, 152400);
  assert.equal(r.paid, 93750);
  assert.equal(r.allowed, 108000);
  assert.equal(r.shortBy, 14250);
  assert.deepEqual(r.flagged, ['pharmacy', 'diagnostics']);
  assert.equal(r.lines.find((line) => line.id === 'room').status, 'as-per-policy');
  assert.equal(r.lines.find((line) => line.id === 'doctor').allowed, 50000);
  assert.equal(r.lines.find((line) => line.id === 'nonpayable').allowed, 0);
});

test('a correctly settled claim flags nothing', () => {
  const fair = { ...CLAIM, insurerPaid: { room: 20000, doctor: 50000, pharmacy: 24000, diagnostics: 14000, nonpayable: 0 } };
  const r = explainDeductions({ claim: fair, wording: POLICY_WORDING });
  assert.equal(r.shortBy, 0);
  assert.deepEqual(r.flagged, []);
});

test('the checklist tracks documents and deadlines, and the grievance is only a draft', () => {
  const r = claimChecklist({ claim: CLAIM, wording: POLICY_WORDING, have: ['discharge', 'bills'], today: TODAY });
  assert.equal(r.total, 7);
  assert.equal(r.missing, 5);
  assert.equal(r.documentsBy, '2026-10-27');
  assert.equal(r.late, true);
  assert.equal(claimChecklist({ claim: CLAIM, wording: POLICY_WORDING, today: '2026-10-20' }).daysLeft, 7);
  const analysis = explainDeductions({ claim: CLAIM, wording: POLICY_WORDING });
  const letter = draftGrievance({ claim: CLAIM, analysis, customerName: 'Ramesh K.', today: TODAY });
  assert.equal(letter.status, 'Draft, not sent');
  assert.equal(letter.shortBy, 14250);
  assert.ok(letter.body.join(' ').includes('₹14,250'));
});

// ── payment safety ─────────────────────────────────────────────
test('Offer X-Ray stops the classic scams and explains why', () => {
  const loan = checkPaymentRequest(SAMPLE_MESSAGES.loanScam);
  assert.equal(loan.verdict, 'stop');
  assert.ok(loan.flags.some((flag) => flag.id === 'upfront_fee'));
  assert.ok(loan.flags.some((flag) => flag.id === 'personal_upi'));
  const collect = checkPaymentRequest(SAMPLE_MESSAGES.collect);
  assert.equal(collect.verdict, 'stop');
  assert.ok(collect.flags.some((flag) => flag.id === 'pin_to_receive'));
  assert.ok(collect.flags.every((flag) => flag.why.length > 10));
  for (const scam of ['Share the OTP you received with our officer', 'You are under digital arrest, pay now', 'Install AnyDesk so that we can verify your KYC']) {
    assert.equal(checkPaymentRequest(scam).verdict, 'stop', scam);
  }
});

test('Offer X-Ray does not cry wolf on ordinary messages', () => {
  assert.equal(checkPaymentRequest(SAMPLE_MESSAGES.genuine).verdict, 'clear');
  assert.equal(checkPaymentRequest('Rent for November, paying my landlord as usual').verdict, 'clear');
  assert.equal(checkPaymentRequest('Limited time: guaranteed cashback').verdict, 'caution');
  assert.ok(checkPaymentRequest('').flags.length === 0);
});

// ── merchant ───────────────────────────────────────────────────
test('merchant eligibility and daily-repayment APR come from the sales summary', () => {
  const e = merchantEligibility(MERCHANT_SALES);
  assert.equal(e.averageMonthly, 309017);
  assert.equal(e.limit, 150000);
  assert.equal(e.eligible, true);
  assert.equal(merchantEligibility({ ...MERCHANT_SALES, months: MERCHANT_SALES.months.slice(0, 3) }).limit, 0);
  const r = explainMerchantOffer(MERCHANT_OFFER, e);
  assert.equal(r.net, 97640);
  assert.equal(r.totalRepay, 106200);
  assert.ok(r.aprPct > 30 && r.aprPct < 40, `APR ${r.aprPct}`);
  assert.equal(r.withinLimit, true);
  assert.equal(r.fits, true);
});

// ── the figures fence ──────────────────────────────────────────
test('the fence rejects a translation that changes a figure', () => {
  const source = 'Add the ₹7,080 fee and the APR is 17.7%.';
  assert.equal(checkFigures(source, '₹7,080 கட்டணத்தைச் சேர்த்தால் APR 17.7%.').ok, true);
  const wrong = checkFigures(source, '₹7,080 கட்டணத்தைச் சேர்த்தால் APR 12.7%.');
  assert.equal(wrong.ok, false);
  assert.deepEqual(wrong.missing, ['17.7']);
  assert.deepEqual(wrong.added, ['12.7']);
  assert.equal(checkFigures(source, 'The fee is added.').ok, false);
  assert.equal(checkFigures('Pay 5% on 100', 'Pay 100% on 5').ok, false);
});

test('native digits count as the same figure', () => {
  assert.equal(checkFigures('EMI ₹9,603 at 14%', 'ईएमआई ₹९,६०३, १४% पर').ok, true);
});

test('a reply may not state a figure the engine did not compute', () => {
  assert.equal(assertGrounded('The APR is 17.7%', { aprPct: 17.7 }).ok, true);
  const bad = assertGrounded('The APR is 12.9%', { aprPct: 17.7 });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.invented, ['12.9']);
  assert.equal(assertGrounded('I heard ₹45,000', {}, 'my income is 45,000').ok, true);
  assert.equal(assertGrounded('two of 3 plans', {}).ok, true);
});

// ── reading the customer ───────────────────────────────────────
test('amounts and answers are read out of free speech, or not at all', () => {
  for (const [text, expected] of [['45,000', 45000], ['₹45000 a month', 45000], ['45k', 45000], ['2.5 lakh', 250000], ['forty five thousand', 45000], ['two lakh', 200000], ['one crore', 10000000], ['I earn about 45 thousand', 45000]]) {
    assert.equal(parseAmount(text), expected, text);
  }
  assert.equal(parseAmount('I am not sure'), null);
  assert.equal(parseDependants('my wife and two kids'), 3);
  assert.equal(parseDependants('no one'), 0);
  assert.equal(parseDependants('my parents'), 2);
  assert.equal(parseDependants('hmm'), null);
  assert.equal(parseYesNo('yes please'), true);
  assert.equal(parseYesNo('சரி'), true);
  assert.equal(parseYesNo('not now'), false);
  assert.equal(parseYesNo('maybe later'), null);
});

// ── consent ────────────────────────────────────────────────────
test('a fact shared for one purpose cannot be read for another', () => {
  const session = createSession({ id: 's', now: NOW });
  assert.equal(readFact(session, { agent: 'lending', field: 'income', purpose: 'loan_eligibility', now: NOW }).status, 'missing');
  recordFact(session, 'income', 45000, { now: NOW });
  assert.equal(readFact(session, { agent: 'lending', field: 'income', purpose: 'loan_eligibility', now: NOW }).status, 'no_consent');
  grantConsent(session, 'loan_eligibility', { now: NOW });
  assert.equal(readFact(session, { agent: 'lending', field: 'income', purpose: 'loan_eligibility', now: NOW }).value, 45000);
  assert.equal(readFact(session, { agent: 'insurance', field: 'income', purpose: 'insurance_needs', now: NOW }).status, 'no_consent');
  assert.equal(readFact(session, { agent: 'insurance', field: 'income', purpose: 'loan_eligibility', now: NOW }).status, 'denied');
  revokeConsent(session, 'loan_eligibility', { now: NOW });
  assert.equal(readFact(session, { agent: 'lending', field: 'income', purpose: 'loan_eligibility', now: NOW }).status, 'no_consent');
});

test('consent expires on its own', () => {
  const session = createSession({ id: 's', now: NOW });
  recordFact(session, 'income', 45000, { now: NOW });
  grantConsent(session, 'loan_eligibility', { now: NOW });
  const later = NOW + 31 * 86400000;
  assert.equal(readFact(session, { agent: 'lending', field: 'income', purpose: 'loan_eligibility', now: later }).status, 'no_consent');
});

// ── the passport chain ─────────────────────────────────────────
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const sign = (hash) => edSign(null, Buffer.from(hash), privateKey).toString('base64');
const verifySignature = (hash, signature) => Boolean(signature) && edVerify(null, Buffer.from(hash), publicKey, Buffer.from(signature, 'base64'));

async function sealedChain() {
  const chain = [];
  await sealPassport(chain, { id: 'JP-1', result: '17.7% APR' }, { sha256, sign });
  await sealPassport(chain, { id: 'JP-2', result: 'Life gap ₹71,00,000' }, { sha256, sign });
  await sealPassport(chain, { id: 'JP-3', result: 'Do not pay' }, { sha256, sign });
  return chain;
}

test('an untouched chain verifies, links and signs', async () => {
  const chain = await sealedChain();
  assert.equal(chain[0].previous, null);
  assert.equal(chain[1].previous, chain[0].hash);
  const result = await verifyChain(chain, { sha256, verifySignature });
  assert.equal(result.valid, true);
  assert.equal(result.checked, 3);
  assert.equal(result.head, chain[2].hash);
});

test('changing one field breaks verification at that receipt', async () => {
  const chain = await sealedChain();
  chain[1].result = 'Life gap ₹1';
  const result = await verifyChain(chain, { sha256, verifySignature });
  assert.equal(result.valid, false);
  assert.equal(result.brokenAt, 'JP-2');
  assert.equal(result.reason, 'hash');
});

test('removing or reordering a receipt breaks verification', async () => {
  const removed = await sealedChain();
  removed.splice(1, 1);
  assert.equal((await verifyChain(removed, { sha256, verifySignature })).valid, false);
  const swapped = await sealedChain();
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.equal((await verifyChain(swapped, { sha256, verifySignature })).valid, false);
});

test('rewriting the whole chain passes the hashes but fails the signature', async () => {
  const chain = await sealedChain();
  const forged = [];
  for (const { hash, signature, sequence, previous, ...body } of chain) {
    await sealPassport(forged, { ...body, result: 'Forged' }, { sha256, sign: () => 'not-a-real-signature' });
  }
  assert.equal((await verifyChain(forged, { sha256 })).valid, true, 'a bare hash chain cannot catch this');
  const signed = await verifyChain(forged, { sha256, verifySignature: (hash, signature) => { try { return verifySignature(hash, signature); } catch { return false; } } });
  assert.equal(signed.valid, false);
  assert.equal(signed.reason, 'signature');
});

// ── the allow-list ─────────────────────────────────────────────
test('the model can only call allow-listed tools with schema-checked arguments', () => {
  assert.equal(validateToolCall({ name: 'explain_loan_offer', arguments: { offer_id: 'KFS-v3-0412' } }).ok, true);
  assert.equal(validateToolCall({ name: 'transfer_money', arguments: {} }).ok, false);
  assert.equal(validateToolCall({ name: 'explain_loan_offer', arguments: { offer_id: 'made-up' } }).ok, false);
  assert.equal(validateToolCall({ name: 'explain_loan_offer', arguments: { offer_id: 'KFS-v3-0412', apr: 12 } }).ok, false);
  assert.equal(validateToolCall({ name: 'explain_loan_offer', arguments: {} }).ok, false);
  assert.equal(validateToolCall({ name: 'explain_loan_offer', arguments: 'x' }).ok, false);
});

test('no tool offered to a model takes a numeric argument', () => {
  for (const definition of toolsForModel()) {
    for (const [name, spec] of Object.entries(definition.function.parameters.properties || {})) {
      assert.notEqual(spec.type, 'number', `${definition.function.name}.${name}`);
      assert.notEqual(spec.type, 'integer', `${definition.function.name}.${name}`);
    }
  }
});

test('rules route each journey, and a scam is not mistaken for a loan question', () => {
  for (const [text, tool] of [
    ['What does this loan really cost?', 'explain_loan_offer'],
    ['Can I close the loan early without a penalty?', 'foreclosure_question'],
    ['How much insurance do I need?', 'protection_gap'],
    ['Explain the plans in simple words', 'explain_plans'],
    ['My claim was cut, why?', 'explain_claim_deductions'],
    ['How do I file a claim?', 'claim_checklist'],
    ['Draft the grievance', 'draft_grievance'],
    [SAMPLE_MESSAGES.loanScam, 'check_payment_request'],
    [SAMPLE_MESSAGES.collect, 'check_payment_request'],
    ['Is this message a scam?', 'check_payment_request'],
    ['I need money for stock for my shop', 'merchant_eligibility'],
    ['Talk to a person', 'handoff_to_human'],
    ['Withdraw my income consent', 'revoke_consent'],
    ['That is all, thank you', 'close_journey'],
    ['Should I prepay or invest ₹50,000?', 'prepay_vs_invest'],
    ['How long can I return a policy?', 'free_look_status'],
    ['Is there a penalty if the loan is repaid in advance?', 'foreclosure_question'],
    ['Will there be a fine if I close the loan early?', 'foreclosure_question'],
    ['Can I pay off the loan before time?', 'foreclosure_question'],
    ['What are the foreclosure charges?', 'foreclosure_question'],
    ['What is the actual cost of this loan?', 'explain_loan_offer'],
    ['Is this message true?', 'check_payment_request'],
    ['I bought the family floater', 'free_look_status'],
    ['Is my insurance sufficient?', 'protection_gap'],
    ['The insurance company has deducted money from my claim', 'explain_claim_deductions'],
  ]) {
    assert.equal(routeByRules(text)?.name ?? null, tool, text);
  }
  assert.equal(routeByRules('the weather today'), null);
});

// ── whole conversations ────────────────────────────────────────
test('the loan call: answer first, income asked once, then a sealed-ready receipt', async () => {
  const session = createSession({ id: 's', now: NOW });
  const first = await say(session, 'What does this loan really cost?');
  assert.equal(first.tool, 'explain_loan_offer');
  assert.ok(first.reply.includes('17.7%') && first.reply.includes('₹7,080'));
  assert.ok(first.reply.includes('monthly income'));
  assert.equal(first.card.data.fit, null);
  const second = await say(session, '45,000 a month');
  assert.equal(second.tool, 'explain_loan_offer');
  assert.ok(second.reply.includes('21%'));
  assert.equal(second.card.data.fit.band, 'fits');
  assert.equal(second.passport.consent[0].purpose, 'loan_eligibility');
  assert.equal(second.passport.result, '17.7% APR');
  assert.equal(session.pending, null);
  assert.ok(session.explained.some((line) => line.includes('17.7%')));
});

test('declining to share income still gets an answer and is not asked again', async () => {
  const session = createSession({ id: 's', now: NOW });
  await say(session, 'What does this loan really cost?');
  const second = await say(session, 'I would rather not say');
  assert.ok(second.reply.includes('17.7%'));
  assert.ok(!second.reply.includes('monthly income'));
  const third = await say(session, 'What does this loan really cost?');
  assert.ok(!third.reply.includes('monthly income'));
});

test('ask once: insurance reuses the income but needs its own yes', async () => {
  const session = createSession({ id: 's', now: NOW });
  await say(session, 'What does this loan really cost?');
  await say(session, '45,000');
  const ask = await say(session, 'How much insurance do I need?');
  assert.ok(ask.reply.includes('₹45,000'));
  assert.ok(ask.reply.includes('will not ask again'));
  assert.equal(ask.card.data.mode, 'consent');
  const next = await say(session, 'Yes, go ahead');
  assert.ok(next.reply.includes('depend'));
  await say(session, 'my wife and two kids');
  await say(session, '10 lakh');
  const done = await say(session, '3 lakh from my employer');
  assert.equal(done.tool, 'protection_gap');
  assert.ok(done.reply.includes('₹71,00,000'));
  assert.ok(done.reply.includes('₹12,00,000'));
  assert.equal(session.metrics.reused, 1, 'only income crossed agents, and it counts once');
  await say(session, 'How much insurance do I need?');
  assert.equal(session.metrics.reused, 1, 'reading it again is not another saved question');
});

test('after consent is withdrawn the lending agent cannot read the income', async () => {
  const session = createSession({ id: 's', now: NOW });
  await say(session, 'What does this loan really cost?');
  await say(session, '45,000');
  const withdrawn = await say(session, 'Withdraw my income consent');
  assert.equal(withdrawn.tool, 'revoke_consent');
  assert.equal(withdrawn.passport.result, 'Withdrawn');
  const again = await say(session, 'What does this loan really cost?');
  assert.equal(again.card.data.fit, null);
  assert.ok(again.reply.includes('May I use your monthly income'));
});

test('foreclosure: refuses to guess, offers a person, and the brief matches slide 7', async () => {
  const session = createSession({ id: 's', now: NOW });
  session.lang = 'ta';
  await say(session, 'What does this loan really cost?', { lang: 'ta' });
  await say(session, '45,000', { lang: 'ta' });
  const asked = await say(session, 'Can I close the loan early without a penalty?', { text: 'முன்கூட்டியே கடனை அடைத்தால் அபராதம் உண்டா?', textEn: 'Can I close the loan early without a penalty?', lang: 'ta' });
  assert.ok(asked.reply.includes('will not guess'));
  assert.equal(asked.handoff, undefined);
  const brief = (await say(session, 'Yes, ask an expert', { lang: 'ta' })).handoff;
  assert.ok(brief.id.startsWith('HB-26-1031-'));
  assert.equal(brief.customer, 'Ramesh K., prefers a phone call in Tamil');
  assert.equal(brief.asked.original, 'முன்கூட்டியே கடனை அடைத்தால் அபராதம் உண்டா?');
  assert.ok(brief.why.includes('not in the KFS'));
  assert.ok(brief.explained.some((line) => line.includes('17.7%')));
  assert.ok(brief.consent.startsWith('Income'));
  assert.equal(brief.next, 'Confirm foreclosure terms with the lender');
  assert.equal(session.stage, 'handover');
});

test('saying no to an offered expert sends nothing', async () => {
  const session = createSession({ id: 's', now: NOW });
  await say(session, 'Can I close the loan early without a penalty?');
  const declined = await say(session, 'No, not now');
  assert.ok(declined.reply.includes('Nothing has been sent'));
  assert.equal(session.handoffs.length, 0);
});

test('the claim call catches the wrong deduction and drafts, never sends', async () => {
  const session = createSession({ id: 's', now: NOW });
  const claim = await say(session, 'My claim was cut, why?');
  assert.ok(claim.reply.includes('₹14,250'));
  assert.equal(claim.card.data.flagged.length, 2);
  const draft = await say(session, 'Draft the grievance');
  assert.equal(draft.passport.action, 'Drafted, not sent');
  const brief = (await say(session, 'Yes, ask an expert')).handoff;
  assert.ok(brief.why.includes('₹14,250'));
});

test('a scam with pressure from a caller stops the payment and calls in a person', async () => {
  const session = createSession({ id: 's', now: NOW });
  const r = await say(session, 'Someone is on the phone telling me to share the OTP right now, I am scared');
  assert.equal(r.card.data.verdict, 'stop');
  assert.equal(r.handoff.reason, 'distress');
  assert.equal(session.metrics.riskyStopped, 1);
  assert.equal(r.passport.action, 'Checked, not paid');
});

test('the Soundbox merchant journey asks for sales consent, then explains', async () => {
  const session = createSession({ id: 's', customerId: 'lakshmi', channel: 'soundbox', now: NOW });
  const ask = await say(session, 'I need money for stock for my shop');
  assert.equal(ask.card.data.mode, 'consent');
  const yes = await say(session, 'Yes, go ahead');
  assert.equal(yes.tool, 'merchant_eligibility');
  assert.ok(yes.reply.includes('₹97,640'));
  const brief = await say(session, 'Yes, send it to the lender');
  assert.equal(brief.tool, 'send_lender_brief');
  assert.equal(brief.passport.action, 'Drafted, not sent');
});

test('with the model off, rules still answer and anything else gets a guided menu in Hindi too', async () => {
  const session = createSession({ id: 's', now: NOW });
  const known = await say(session, 'What does this loan really cost?');
  assert.ok(known.reply.includes('17.7%') && known.replyHi.includes('17.7%'));
  session.pending = null;
  const unknown = await say(session, 'the weather today');
  assert.equal(unknown.tool, 'clarify_request');
  assert.ok(unknown.replyHi.length > 0);
  assert.ok(unknown.chips.length > 0);
});

test('two unplaced turns hand over instead of looping', async () => {
  const session = createSession({ id: 's', now: NOW });
  await say(session, 'the weather today');
  const second = await say(session, 'what about the moon');
  assert.equal(second.tool, 'handoff_to_human');
  assert.equal(second.handoff.reason, 'not_sure');
});

test('a model that picks an unlisted tool cannot run it', async () => {
  const session = createSession({ id: 's', now: NOW });
  const r = await takeTurn(session, { text: 'is this deal any good', textEn: 'is this deal any good', lang: 'en' }, { now: NOW, modelRoute: async () => ({ name: 'transfer_money', arguments: { amount: 999 } }) });
  assert.equal(r.tool, 'clarify_request');
  assert.ok(r.trace.some((event) => event.kind === 'route' && event.ok === false));
});

test('the model places topics, a mention of a shop does not decide, and safety rules still come first', async () => {
  const modelRoute = async () => ({ name: 'protection_gap', arguments: {} });
  const shop = await takeTurn(createSession({ id: 's', now: NOW }), { text: 'I run a tea shop, which insurance is good for my family?', textEn: 'I run a tea shop, which insurance is good for my family?', lang: 'en' }, { now: NOW, modelRoute });
  assert.notEqual(shop.tool, 'merchant_eligibility');
  const called = { times: 0 };
  const urgent = await takeTurn(createSession({ id: 't', now: NOW }), { text: 'They are asking for my OTP', textEn: 'They are asking for my OTP', lang: 'en' }, { now: NOW, modelRoute: async () => { called.times += 1; return { name: 'protection_gap', arguments: {} }; } });
  assert.equal(urgent.tool, 'check_payment_request');
  assert.equal(called.times, 0);
  const tapped = await takeTurn(createSession({ id: 'u', now: NOW }), { text: 'What does this loan really cost?', textEn: 'What does this loan really cost?', lang: 'en', tapped: true }, { now: NOW, modelRoute: async () => { throw new Error('should not be called'); } });
  assert.equal(tapped.tool, 'explain_loan_offer');
  assert.ok(tapped.trace.every((event) => event.ok !== false));
});

test('a model that picks a listed tool runs it, and still supplies no figure', async () => {
  const session = createSession({ id: 's', now: NOW });
  const r = await takeTurn(session, { text: 'is this deal as cheap as it looks', textEn: 'is this deal as cheap as it looks', lang: 'en' }, { now: NOW, modelRoute: async () => ({ name: 'explain_loan_offer', arguments: { offer_id: 'KFS-v3-0412' } }) });
  assert.equal(r.tool, 'explain_loan_offer');
  assert.ok(r.reply.includes('17.7%'));
  assert.ok(r.trace.some((event) => event.model));
});

test('the file-a-claim journey is open and on time on the day of the finale', async () => {
  const session = createSession({ id: 's', now: NOW });
  const r = await say(session, 'How do I file a claim?');
  assert.equal(r.card.data.late, false);
  assert.equal(r.card.data.documentsBy, '2026-11-12');
  assert.ok(r.reply.includes('12 Nov 2026'));
  const updated = await say(session, 'I have the discharge summary and bills');
  assert.equal(updated.card.data.missing, 5);
});

test('every tool that states figures passes the grounding check on its own output', async () => {
  const session = createSession({ id: 's', now: NOW });
  for (const text of ['What does this loan really cost?', '45,000', 'Should I prepay or invest ₹50,000?', 'I will take this loan', 'I have signed the loan', 'How long is the cooling-off?', 'How long can I return a free-look policy?', 'Explain the plans in simple words', 'How do I file a claim?', 'I have the discharge summary and bills', 'My claim was cut, why?', 'Draft the grievance', 'No, not now', 'Is this message a scam?']) {
    const r = await say(session, text);
    assert.ok(!r.blocked, `${text} → ${r.trace?.find((event) => event.kind === 'grounding')?.detail}`);
  }
});

test('the handoff tool has no direct runner: only the orchestrator can build a brief', () => {
  assert.equal(TOOLS.handoff_to_human.run, null);
});

// ── found by the blind test on 30 Oct: each of these failed before ──
test('an empty "is this a scam?" asks for the message and never reassures', async () => {
  const session = createSession({ id: 's', now: NOW });
  const r = await say(session, 'Is this message a scam?');
  assert.ok(!/no red flags/i.test(r.reply));
  assert.ok(/read me/i.test(r.reply));
  assert.equal(r.passport, undefined);
  assert.equal(isOnlyAsking(SAMPLE_MESSAGES.genuine), false);
});

test('being asked for an OTP is a hard stop, however it is phrased', () => {
  for (const text of ['Someone says my KYC expires today and is asking for OTP. Should I give?', 'They want my OTP', 'He asked for the CVV', 'OTP should I give him']) {
    assert.equal(checkPaymentRequest(text).verdict, 'stop', text);
  }
});

test('a fraud victim is told 1930 first, and a person is called now, not at 4 PM', async () => {
  const session = createSession({ id: 's', now: NOW });
  const r = await say(session, 'I already paid 5000 to that man and my money is gone, what do I do?');
  assert.equal(r.tool, 'fraud_emergency');
  assert.ok(r.reply.startsWith('Call 1930'));
  assert.equal(r.handoff.callback, 'Call back now');
});

test('hardship reaches a person with care, and never a loan pitch', async () => {
  const session = createSession({ id: 's', now: NOW });
  const r = await say(session, 'I lost my job and I cannot pay my EMI next month, I am very worried');
  assert.equal(r.tool, 'handoff_to_human');
  assert.equal(r.handoff.reason, 'hardship');
  assert.ok(r.reply.startsWith('I am sorry'));
  assert.ok(!/17\.7/.test(r.reply));
});

test('the customer’s own loan numbers are used, never the sample offer', async () => {
  const session = createSession({ id: 's', now: NOW });
  const full = await say(session, 'What is the EMI on a 5 lakh loan at 12 percent for 3 years?');
  assert.ok(full.reply.includes('₹5,00,000') && full.reply.includes('₹16,607'));
  assert.ok(!full.reply.includes('₹1,92,920'));
  assert.equal(full.card.data.ownNumbers, true);
  const partial = await say(session, 'My friend told me to take a loan of 50 lakh');
  assert.ok(partial.reply.includes('the interest rate') && partial.reply.includes('how many months'));
  assert.ok(!partial.reply.includes('₹1,92,920'));
  assert.equal(partial.passport, undefined);
});

test('loan terms are read from speech, with fees kept apart', () => {
  assert.deepEqual(parseLoanTerms('3 lakh at 11.5% for 24 months with processing fee of 6,000'), { principal: 300000, ratePct: 11.5, months: 24, fee: 6000, mentioned: true });
  assert.deepEqual(parseLoanTerms('two years at 10 percent on 2 lakh'), { principal: 200000, ratePct: 10, months: 24, fee: null, mentioned: true }, 'a spoken tenure is read exactly, not guessed');
  assert.equal(parseLoanTerms('What does this loan really cost?').mentioned, false);
  assert.equal(parseLoanTerms('5 lakh for 3 years').ratePct, null);
});

test('a claim that does not match the one on record is not explained as if it did', async () => {
  const session = createSession({ id: 's', now: NOW });
  const r = await say(session, 'My claim of 80,000 was cut, why?');
  assert.ok(r.reply.includes('does not match'));
  assert.ok((await say(session, 'Yes')).handoff);
  const rejected = await say(createSession({ id: 't', now: NOW }), 'My claim was rejected completely');
  assert.equal(rejected.handoff.reason, 'dispute');
});

test('"say that again" repeats, and "I did not understand" says it more simply', async () => {
  const session = createSession({ id: 's', now: NOW });
  const none = await say(session, 'Can you say that again?');
  assert.ok(none.reply.includes('not explained anything'));
  const first = await say(session, 'What does this loan really cost?');
  session.pending = null;
  const again = await say(session, 'Can you repeat that?');
  assert.equal(again.tool, 'repeat_last');
  assert.equal(again.reply, first.reply);
  assert.equal(again.passport, undefined);
  session.pending = null;
  const simple = await say(session, 'I did not understand');
  assert.equal(simple.tool, 'say_simpler');
  assert.ok(simple.reply.includes('₹37,552'), simple.reply);
  assert.ok(simple.reply.length < first.reply.length / 2);
});

test('financial words get a plain answer', async () => {
  const session = createSession({ id: 's', now: NOW });
  const r = await say(session, 'What is APR?');
  assert.equal(r.tool, 'explain_term');
  assert.ok(/real yearly cost/.test(r.reply));
  assert.equal((await say(session, 'What does cooling-off mean?')).card.data.body.includes('Cooling-off'), true);
});

test('an implausible answer is checked, not computed', async () => {
  const session = createSession({ id: 's', now: NOW });
  await say(session, 'What does this loan really cost?');
  const r = await say(session, '45');
  assert.ok(r.reply.includes('₹45,000'));
  assert.equal(session.facts.income, undefined);
  const fixed = await say(session, '45,000');
  assert.ok(fixed.reply.includes('21%'));
});

test('going ahead with a loan moves the journey on with a pre-filled application', async () => {
  const session = createSession({ id: 's', now: NOW });
  await say(session, 'What does this loan really cost?');
  await say(session, '45,000');
  const r = await say(session, 'I will take this loan');
  assert.equal(r.card.type, 'application');
  assert.equal(r.card.data.filled.length, 5);
  assert.deepEqual(r.card.data.left, ['PAN', 'Bank account']);
  assert.equal(r.passport.action, 'Recorded, not executed');
});

test('cancelling a just-signed loan answers the question and starts the clock', async () => {
  const session = createSession({ id: 's', now: NOW });
  const r = await say(session, 'I just signed the loan, can I cancel it?');
  assert.equal(r.tool, 'cooling_off_status');
  assert.ok(r.reply.startsWith('Yes'));
  assert.equal(session.decisions.loanSignedOn, TODAY);
});

test('broad rules only run when no model can be asked', async () => {
  assert.equal(routeByRules('tell me about this loan'), null);
  assert.equal(routeBroad('tell me about this loan').name, 'explain_loan_offer');
  const session = createSession({ id: 's', now: NOW });
  const down = await say(session, 'tell me about this loan');
  assert.equal(down.tool, 'explain_loan_offer');
  const session2 = createSession({ id: 't', now: NOW });
  const broken = await takeTurn(session2, { text: 'tell me about this loan', textEn: 'tell me about this loan', lang: 'en' }, { now: NOW, modelRoute: async () => { throw new Error('down'); } });
  assert.equal(broken.tool, 'explain_loan_offer');
});

test('spoken replies are short enough for a phone call', async () => {
  const session = createSession({ id: 's', now: NOW });
  for (const text of ['What does this loan really cost?', '45,000', 'Can I close the loan early without a penalty?', 'No, not now', 'How much insurance do I need?', 'Yes', 'two kids and my wife', '10 lakh', '3 lakh', 'Explain the plans in simple words', 'I bought the family floater', 'How do I file a claim?', 'My claim was cut, why?', 'Draft the grievance', 'No, not now', SAMPLE_MESSAGES.loanScam]) {
    const r = await say(session, text);
    const words = r.reply.split(/\s+/).length;
    assert.ok(words <= 56, `${r.tool} is ${words} words: ${r.reply}`);
    if (r.simple) assert.equal(assertGrounded(r.simple, r.computed, text).ok, true, r.simple);
  }
});

test('scams found by the blind test are stopped, and unprompted contact is never cleared', () => {
  for (const text of [
    'Somebody call me said my loan approved but first pay 5000 rupees fee. Is this true or fake?',
    'I received a call saying my loan was approved and I need to pay the first installment. Is it true?',
    'A man was on the phone, saying he won a prize, asking for an account number. What should I do?',
    'A message has arrived that the KYC deadline is expiring, click on the link. Believe me?',
    'Someone is asking for bank details after winning a prize. Is it true?',
  ]) assert.equal(checkPaymentRequest(text).verdict, 'stop', text);
  assert.equal(checkPaymentRequest('I got a call about a very good offer, is it okay?').verdict, 'caution');
  assert.equal(checkPaymentRequest(SAMPLE_MESSAGES.genuine).verdict, 'clear');
});

test('a model can raise a scam alarm, and can never lower one', async () => {
  const quiet = 'A stranger says I got an award and must deposit the tax first';
  assert.equal(checkPaymentRequest(quiet).verdict, 'caution');
  assert.equal(checkPaymentRequest(quiet, { modelRisk: 'likely_scam' }).verdict, 'stop');
  assert.equal(checkPaymentRequest(SAMPLE_MESSAGES.loanScam, { modelRisk: 'looks_normal' }).verdict, 'stop');
  assert.equal(checkPaymentRequest(quiet, { modelRisk: 'looks_normal' }).verdict, 'caution');
  const session = createSession({ id: 's', now: NOW });
  const modelRoute = async () => ({ name: 'check_payment_request', arguments: {} });
  const r = await takeTurn(session, { text: quiet, textEn: quiet, lang: 'en' }, { now: NOW, modelRoute, riskCheck: async () => 'likely_scam' });
  assert.equal(r.tool, 'check_payment_request');
  assert.equal(r.card.data.verdict, 'stop');
  const down = await takeTurn(createSession({ id: 't', now: NOW }), { text: quiet, textEn: quiet, lang: 'en' }, { now: NOW, modelRoute, riskCheck: async () => { throw new Error('down'); } });
  assert.equal(down.card.data.verdict, 'caution');
  assert.ok(down.trace.some((event) => event.label.includes('unavailable')));
});

// ── spoken figures ──────────────────────────────────────────────
import { checkSpoken, speakable } from '../src/journeys/voiceFence.js';
import { numberWordsToDigits } from '../src/journeys/money.js';

test('spoken numbers become digits, the way Saaras hears them', () => {
  assert.equal(numberWordsToDigits('one lakh ninety-two thousand nine hundred and twenty rupees'), '192920 rupees');
  assert.equal(numberWordsToDigits('seventeen point seven percent.'), '17.7 percent.');
  assert.equal(numberWordsToDigits('five lakh three years'), '500000 3 years');
  assert.equal(numberWordsToDigits('nine thousand six hundred three rupees'), '9603 rupees');
  assert.equal(numberWordsToDigits('a loan of 2 lakh'), 'a loan of 200000');
  assert.equal(numberWordsToDigits('no number here'), 'no number here');
});

test('a loan described in spoken words is read like one typed in digits', () => {
  assert.deepEqual(
    parseLoanTerms('I need a loan of five lakh rupees, with an interest rate of fourteen percent, for three years.'),
    { principal: 500000, ratePct: 14, months: 36, fee: null, mentioned: true },
  );
  const hinglish = parseLoanTerms('I need a loan of five lakhs. The EMI is eleven thousand two hundred. What is the APR?');
  assert.equal(hinglish.principal, 500000, 'a stated EMI is not the amount borrowed');
  assert.equal(parseLoanTerms('EMI is 11,200 on my five lakh loan').principal, 500000);
});

test('APR is never written next to a figure in a way Bulbul reads as a date', () => {
  assert.equal(speakable('ફી સાથે, APR 17.7% છે.'), 'ફી સાથે, A P R 17.7% છે.');
  assert.equal(speakable('April is a month'), 'April is a month');
});

test('the voice check fails on the real bug it was built for', () => {
  const said = '₹7,080 की fee के साथ, APR 17.7% है।';
  assert.equal(checkSpoken(said, 'With a fee of seven thousand eighty rupees, April 17th is 7 percent.').ok, false);
  assert.equal(checkSpoken(said, 'With a fee of seven thousand eighty rupees, A P R is seventeen point seven percent.').ok, true);
});

test('the voice check catches a rupee amount heard wrongly', () => {
  const out = checkSpoken('Your EMI is ₹11,240.', 'Your EMI is eleven thousand eight hundred and forty rupees.');
  assert.equal(out.ok, false);
  assert.deepEqual(out.missing, ['11240']);
});

test('Kannada figures are spelled out for the voice, and nothing else changes', async () => {
  const { spellIndian } = await import('../src/journeys/voiceFence.js');
  assert.equal(spellIndian(192920), 'one lakh ninety two thousand nine hundred twenty');
  assert.equal(spellIndian('93,750'), 'ninety three thousand seven hundred fifty');
  assert.equal(spellIndian(590), 'five hundred ninety');
  assert.equal(spellIndian('17.7'), 'seventeen point seven');
  assert.equal(spellIndian(7100000), 'seventy one lakh');
  assert.equal(spellIndian(0), 'zero');
  assert.equal(speakable('ದಿನಕ್ಕೆ ₹590, APR 17.7%', 'kn'), 'ದಿನಕ್ಕೆ five hundred ninety rupees, A P R seventeen point seven%');
  assert.equal(speakable('₹590', 'hi'), '₹590');
  // Whatever the voice is given, what it says still has to be heard as the original.
  assert.equal(checkSpoken('₹93,750', spellIndian('93,750')).ok, true);
});

test('a customer without a shop is not asked about a Soundbox', async () => {
  const session = createSession({ id: 's-noshop', customerId: 'ramesh', now: NOW });
  const r = await say(session, 'I need working capital for my small business');
  assert.match(r.reply, /no(ne)? .*account|there is none/i);
  assert.equal(session.pending, null);
  const shop = createSession({ id: 's-shop', customerId: 'lakshmi', now: NOW });
  const asked = await say(shop, 'I need working capital for my small business');
  assert.match(asked.reply, /Soundbox sales summary/);
});
