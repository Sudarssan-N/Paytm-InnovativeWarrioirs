import test from 'node:test';
import assert from 'node:assert/strict';
import { BOUNCE_CHARGE, buildLevel, collect, createRun, gatesLeft, gradeQuiz, lessonLine, levelFromCard, levelIds, payGate, prepay, quizFor, remaining, spawnPlan, summary } from '../src/journeys/game/loanGame.js';
import { explainLoanOffer, prepayVsInvest } from '../src/journeys/engines/lending.js';
import { LOAN_OFFERS } from '../src/journeys/sampleData.js';
import { checkFigures, figuresIn } from '../src/journeys/money.js';
import { gradeCard, gradeDeck, SCAM_DECK } from '../src/journeys/game/scamDeck.js';

const OFFER = LOAN_OFFERS['KFS-v3-0412'];
const drive = (run) => { let guard = 0; while (!run.finished && guard++ < 500) payGate(run); return run; };

test('a clean run pays exactly what the engine says the loan costs', () => {
  const engine = explainLoanOffer(OFFER);
  const run = drive(createRun(buildLevel('personal')));
  const end = summary(run);
  assert.equal(end.paid, engine.totalRepay);
  assert.equal(end.received, engine.net);
  assert.equal(end.aprPct, engine.aprPct);
  assert.equal(end.periodsTaken, OFFER.months);
  assert.equal(end.interestPaid, engine.totalRepay - engine.principal);
  assert.equal(run.balance, 0);
});

for (const id of levelIds()) {
  test(`level ${id}: every payment splits into interest and loan, and the road ends`, () => {
    const level = buildLevel(id);
    const run = createRun(level);
    run.wallet = 1e9;
    let guard = 0;
    while (!run.finished && guard++ < 500) {
      const gate = payGate(run);
      assert.equal(gate.bounced, false);
      assert.ok(Math.abs(gate.due - gate.interest - gate.principal) < 1e-6);
      assert.ok(gate.interest >= -1e-6, 'interest is never negative');
    }
    assert.equal(run.finished, true);
    assert.ok(Math.abs(run.paid - level.totalRepay) <= level.stride * 2, `${run.paid} against ${level.totalRepay}`);
  });
}

test('early payments carry more interest than late ones, which is the point of the game', () => {
  const run = drive(createRun(buildLevel('personal')));
  assert.ok(run.firstGate.interest > 10 * run.lastGate.interest);
  const home = createRun(buildLevel('home'));
  home.wallet = 1e9;
  const first = payGate(home);
  assert.ok(first.interestShare > 0.6, 'on a 20-year loan, most of the first year is interest');
});

test('paying extra matches the prepayment engine on the same loan', () => {
  const level = buildLevel('personal');
  const run = createRun(level);
  run.wallet = 50000;
  const out = prepay(run, 50000);
  const engine = prepayVsInvest(OFFER, { extra: 50000 });
  assert.equal(Math.round(out.interestSaved), engine.interestSaved);
  assert.equal(out.periodsSaved, engine.monthsSaved);
});

test('paying extra needs the money, and shortens the road', () => {
  const run = createRun(buildLevel('personal'));
  assert.equal(prepay(run, 1e7).paid, false);
  const before = gatesLeft(run);
  run.wallet = 40000;
  assert.ok(prepay(run, 40000).gatesLeft < before);
});

test('a bounced payment adds a charge and interest and lowers credit health', () => {
  const run = createRun(buildLevel('personal'));
  run.wallet = -100000;
  const balance = run.balance;
  const credit = run.credit;
  const out = payGate(run);
  assert.equal(out.bounced, true);
  assert.equal(run.charges, BOUNCE_CHARGE);
  assert.ok(run.balance > balance);
  assert.ok(run.credit < credit);
  assert.ok(gatesLeft(run) >= 24, 'the road does not get shorter');
});

test('health cover pays one hospital bill, and a repair is never covered', () => {
  const run = createRun(buildLevel('personal'));
  run.wallet = 100000;
  assert.equal(collect(run, { kind: 'shield' }).bought, true);
  const wallet = run.wallet;
  assert.equal(collect(run, { kind: 'bill', medical: true, amount: 18000 }).covered, true);
  assert.equal(run.wallet, wallet);
  assert.equal(collect(run, { kind: 'bill', medical: true, amount: 18000 }).covered, false);
  assert.equal(run.wallet, wallet - 18000);
  run.shield = true;
  assert.equal(collect(run, { kind: 'bill', medical: false, amount: 6000 }).covered, false);
});

test('the road is the same for the same seed, with every lesson on it', () => {
  for (const id of levelIds()) {
    const plan = spawnPlan(buildLevel(id));
    assert.deepEqual(plan, spawnPlan(buildLevel(id)));
    const kinds = new Set(plan.flat().map((item) => item.kind));
    for (const kind of ['coin', 'bill', 'scam', 'shield', 'prepay']) assert.ok(kinds.has(kind), `${id} has ${kind}`);
    for (const item of plan.flat()) assert.ok(item.lane >= 0 && item.lane <= 2);
  }
});

test('every lesson states only figures the run computed', () => {
  const level = buildLevel('personal');
  const run = createRun(level);
  const gate = payGate(run);
  const line = lessonLine('first_emi', level, gate);
  const allowed = new Set([Math.round(gate.due), Math.round(gate.interest), Math.round(gate.principal)].map(String));
  for (const figure of figuresIn(line)) assert.ok(allowed.has(figure), figure);
  assert.match(lessonLine('apr', level), /17\.7%/);
  assert.match(lessonLine('fee', level), /7,080/);
});

test('a customer’s own loan becomes a level', () => {
  const engine = explainLoanOffer(OFFER);
  const level = levelFromCard({ ...engine, product: 'Personal loan' });
  assert.equal(level.payment, engine.emi);
  assert.equal(level.title, 'Your personal loan');
  assert.equal(levelFromCard(null).id, 'personal');
});

test('the understanding check is graded, not assumed', () => {
  const level = buildLevel('personal');
  const questions = quizFor(level);
  assert.ok(questions.length >= 4);
  assert.equal(gradeQuiz(level, questions.map((q) => q.answer)).correct, questions.length);
  const none = gradeQuiz(level, []);
  assert.equal(none.correct, 0);
  assert.equal(none.missed.length, questions.length);
  assert.ok(questions[0].options.includes('₹1,92,920'));
  assert.ok(questions[1].options.includes('17.7%'));
});

test('Scam Shield agrees with the Offer X-Ray engine on every card', () => {
  for (const card of SCAM_DECK) {
    const graded = gradeCard(card, card.scam);
    assert.equal(graded.correct, true);
    if (card.scam) assert.notEqual(graded.verdict, 'clear', `${card.id} must not be called clear`);
    else assert.notEqual(graded.verdict, 'stop', `${card.id} must not be stopped`);
  }
  assert.equal(gradeDeck(SCAM_DECK.map((card) => card.scam)).correct, SCAM_DECK.length);
  assert.equal(gradeDeck([]).correct, 0);
});

test('the translation fence still protects game lessons', () => {
  const line = lessonLine('fee', buildLevel('personal'));
  assert.equal(checkFigures(line, line).ok, true);
  assert.equal(checkFigures(line, line.replace('7,080', '7,800')).ok, false);
});

test('asking for a game opens one, and the tool states no figure', async () => {
  const { routeByRules } = await import('../src/journeys/router.js');
  const { TOOLS } = await import('../src/journeys/tools.js');
  assert.equal(routeByRules('Show me this loan as a game').name, 'learn_by_playing');
  const out = TOOLS.learn_by_playing.run({ turn: { textEn: 'can I play a game about scams' } });
  assert.equal(out.card.data.game, 'scam');
  assert.deepEqual(figuresIn(out.reply), []);
});

test('a loan document is checked against itself before it is used', async () => {
  const { interpretLoanDocument, readBackLine } = await import('../src/journeys/documentRead.js');
  const read = { result: { doc_kind: 'loan_kfs', lender: 'Sample Finance', product: 'Personal loan', principal: 350000, rate_pct: 15.5, rate_type: 'fixed', months: 36, emi: 12219, processing_fee: 7000, gst_on_fee: 1260, other_charges: 4500, net_disbursed: 337240, apr_pct: 17.2, cooling_off_days: 3, foreclosure: '4% of principal outstanding' }, annotations: { principal: { confidence: 1, sources: [{ page_num: 1 }] }, rate_pct: { confidence: 0.5, sources: [{ page_num: 1 }] } } };
  const doc = interpretLoanDocument(read, { hash: 'abcdef123456', today: '2026-10-31' });
  assert.equal(doc.usable, true);
  assert.equal(doc.net, 337240);
  assert.equal(doc.offer.id, 'DOC-abcdef12');
  assert.deepEqual(doc.unsure, ['Interest rate']);
  assert.ok(doc.computedApr > 17.2 + 0.25, 'the fee and the bundled insurance push the real cost above what the page states');
  assert.ok(doc.checks.some((check) => check.field === 'apr'));
  assert.match(readBackLine(doc), /₹3,50,000 at 15\.5% for 36 months/);
  const blank = interpretLoanDocument({ result: { doc_kind: 'loan_kfs', rate_pct: 12 } });
  assert.equal(blank.usable, false);
  assert.deepEqual(blank.missing, ['Loan amount', 'Term']);
  assert.match(readBackLine(blank), /will not guess/);
  assert.equal(interpretLoanDocument({ result: { doc_kind: 'claim_settlement', principal: 1, rate_pct: 1, months: 1 } }).usable, false);
});

test('Promise Check only accepts what the agent really said', async () => {
  const { agentSpeaker, checkPromises, findPromisesByRules, promiseLine, quoteIsReal } = await import('../src/journeys/engines/promises.js');
  const { INSURANCE_PLANS, LOAN_OFFERS } = await import('../src/journeys/sampleData.js');
  const turns = [
    { index: 0, speaker: '0', text: 'यह प्लान एफडी जैसा है, आपको हर साल 12% पक्का रिटर्न मिलेगा।', english: 'This plan is like an FD, you will get a sure 12% return every year.' },
    { index: 1, speaker: '1', text: 'अच्छा, क्या कोई फीस है?', english: 'Okay, is there any fee?' },
    { index: 2, speaker: '0', text: 'नहीं सर, कोई प्रोसेसिंग फीस नहीं है, ब्याज सिर्फ़ 14% है।', english: 'No sir, there is no processing fee, the interest is only 14%.' },
  ];
  const facts = { offer: LOAN_OFFERS['KFS-v3-0412'], plan: INSURANCE_PLANS[1], policyFreeLook: { daysLeft: 11, endsLabel: '11 Nov 2026' } };
  assert.equal(agentSpeaker(turns), '0');
  assert.ok(quoteIsReal('कोई प्रोसेसिंग फीस नहीं है', turns, '0'));
  assert.equal(quoteIsReal('कोई प्रोसेसिंग फीस नहीं है', turns, '1'), null, 'the customer’s words are not the agent’s promise');
  const invented = checkPromises([{ kind: 'guaranteed_return', quote: 'I promise you 40% every month' }], turns, '0', facts);
  assert.equal(invented.total, 0, 'a quote a model made up is dropped');
  const out = checkPromises([
    { kind: 'guaranteed_return', quote: 'हर साल 12% पक्का रिटर्न मिलेगा' }, { kind: 'no_fee', quote: 'कोई प्रोसेसिंग फीस नहीं है' }, { kind: 'interest_rate', quote: 'ब्याज सिर्फ़ 14% है' }, { kind: 'made_up', quote: 'ब्याज सिर्फ़ 14% है' },
  ], turns, '0', facts);
  assert.deepEqual(out.rows.map((row) => row.verdict), ['contradicted', 'contradicted', 'half_truth']);
  assert.match(out.rows[1].paper, /₹6,000/);
  assert.match(out.rows[2].paper, /17\.7%/);
  assert.equal(out.broken, 3);
  assert.match(promiseLine(out), /3 promises, and 3 do not match/);
  assert.match(promiseLine(out), /11 days/);
  assert.match(promiseLine({ total: 0, rows: [] }), /did not find/);
  const rules = findPromisesByRules(turns.filter((turn) => turn.speaker === '0').map((turn) => ({ ...turn })));
  assert.ok(rules.some((item) => item.kind === 'no_fee'));
  assert.ok(rules.some((item) => item.kind === 'interest_rate'));
});

test('a UPI link or QR says who really gets the money', async () => {
  const { checkPaymentRequest, readUpiLink } = await import('../src/journeys/engines/payments.js');
  const trap = 'upi://pay?pa=refund.help@ybl&pn=Paytm%20Refund%20Team&am=4500&tn=Enter%20PIN%20to%20receive%20refund';
  const read = readUpiLink(trap);
  assert.equal(read.payee, 'refund.help@ybl');
  assert.equal(read.amount, 4500);
  assert.equal(read.merchant, false);
  const out = checkPaymentRequest(trap);
  assert.equal(out.verdict, 'stop');
  assert.ok(out.flags.some((flag) => flag.id === 'no_merchant'));
  const shop = checkPaymentRequest('upi://pay?pa=sharmakirana.q123@paytm&pn=Sharma%20Kirana&mc=5411&am=320');
  assert.notEqual(shop.verdict, 'stop');
  assert.equal(readUpiLink('no link here'), null);
  const { routeByRules } = await import('../src/journeys/router.js');
  assert.equal(routeByRules(trap).name, 'check_payment_request');
});

test('a shopkeeper can ask about their sales, and only computed figures are said', async () => {
  const { TOOLS } = await import('../src/journeys/tools.js');
  const { assertGrounded } = await import('../src/journeys/money.js');
  const shop = { session: { customer: { kind: 'merchant' } } };
  const person = { session: { customer: { kind: 'individual' } } };
  assert.doesNotMatch(TOOLS.merchant_sales_summary.run(person).reply, /₹/, 'one customer’s sales are never read to another');
  const out = TOOLS.merchant_sales_summary.run(shop);
  assert.match(out.reply, /₹3,29,800/);
  assert.match(out.reply, /down 3\.4%/);
  assert.equal(assertGrounded(out.reply, out.computed).ok, true);
});

test('a model’s doubt about a reminder in the customer’s own app is a caution, not a stop', async () => {
  const { checkPaymentRequest } = await import('../src/journeys/engines/payments.js');
  const reminder = 'Your EMI of ₹9,603 is due on the 5th. Pay it from the loan section of your own app.';
  assert.notEqual(checkPaymentRequest(reminder, { modelRisk: 'likely_scam' }).verdict, 'stop');
  assert.equal(checkPaymentRequest('Send ₹500 to this new number, my friend asked', { modelRisk: 'likely_scam' }).verdict, 'stop');
});

test('the table view adds up to the same loan as the game', async () => {
  const { scheduleRows } = await import('../src/journeys/game/loanGame.js');
  const rows = scheduleRows(buildLevel('personal'));
  assert.equal(rows.length, 24);
  assert.equal(rows.reduce((sum, row) => sum + row.paid, 0), 230472);
  assert.equal(rows.at(-1).left, 0);
  assert.ok(rows[0].interest > rows.at(-1).interest);
});

test('the result names what mistakes cost, in charges, traps and extra interest', () => {
  const run = createRun(buildLevel('personal'));
  run.wallet = -100000;
  payGate(run);
  run.wallet = 1e9;
  collect(run, { kind: 'scam', amount: 2999 });
  while (!run.finished) payGate(run);
  const end = summary(run);
  assert.ok(end.mistakesCost >= BOUNCE_CHARGE + 2999);
  assert.ok(end.mistakesCost > BOUNCE_CHARGE + 2999, 'the missed month also adds interest');
  const clean = createRun(buildLevel('personal'));
  clean.wallet = 1e9;
  while (!clean.finished) payGate(clean);
  assert.equal(summary(clean).mistakesCost, 0);
});

test('a scam that mentions a game goes to the scam check, not to a game', async () => {
  const { routeByRules } = await import('../src/journeys/router.js');
  assert.notEqual(routeByRules('Someone asked me to pay ₹500 for an online game to win money')?.name, 'learn_by_playing');
  assert.notEqual(routeByRules('Is this game real, they want my OTP to give the prize')?.name, 'learn_by_playing');
  assert.equal(routeByRules('Can I play a game about loans')?.name, 'learn_by_playing');
  assert.equal(routeByRules('Show me this loan as a game')?.name, 'learn_by_playing');
});
