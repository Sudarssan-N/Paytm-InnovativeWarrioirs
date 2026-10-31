// Karz Yatra: a loan you can drive. The rules of the game are the rules of the loan,
// and every rupee comes from the same engines as the call, so the game can't teach a
// number MITRA would not say. No DOM here: this runs under node:test and on the server,
// which grades the understanding check itself.
import { explainLoanOffer, periodicIrr } from '../engines/lending.js';
import { explainMerchantOffer, merchantEligibility } from '../engines/merchant.js';
import { LOAN_OFFERS, MERCHANT_OFFER, MERCHANT_SALES } from '../sampleData.js';
import { inr, pct } from '../money.js';

// ₹500 + 18% GST. An example: the customer's own KFS states the real charge.
export const BOUNCE_CHARGE = 590;
const START_CREDIT = 750;

const fromOffer = (offer, setup) => {
  const r = explainLoanOffer(offer);
  return {
    principal: r.principal, ratePct: r.ratePct, fees: r.fees, net: r.net, payment: r.emi, periods: r.months,
    periodRate: r.ratePct / 1200, aprPct: r.aprPct, totalRepay: r.totalRepay, totalCost: r.totalCost,
    coolingOffDays: r.coolingOffDays ?? null, stride: 1, unit: 'month', ...setup,
  };
};

const fromMerchant = (setup) => {
  const r = explainMerchantOffer(MERCHANT_OFFER, merchantEligibility(MERCHANT_SALES));
  return {
    principal: r.principal, ratePct: null, fees: r.fee + r.gst, net: r.net, payment: r.dailyRepayment, periods: r.days,
    periodRate: periodicIrr(r.principal, r.dailyRepayment, r.days), aprPct: r.aprPct, totalRepay: r.totalRepay, totalCost: r.totalCost,
    coolingOffDays: r.coolingOffDays, stride: 7, unit: 'day', ...setup,
  };
};

const APP_LOAN = { id: 'EXAMPLE-APP', principal: 10000, ratePct: 36, months: 3, processingFee: 1500, gstOnFee: 270, otherCharges: 0, coolingOffDays: 3, version: 'example', issuedOn: '2026-10-28' };
const HOME_LOAN = { id: 'EXAMPLE-HOME', principal: 2500000, ratePct: 8.5, months: 240, processingFee: 10000, gstOnFee: 1800, otherCharges: 0, coolingOffDays: 3, version: 'example', issuedOn: '2026-10-28' };

export const LEVELS = Object.freeze({
  personal: () => fromOffer(LOAN_OFFERS['KFS-v3-0412'], {
    id: 'personal', title: 'Your loan offer', blurb: 'The personal loan on this call', real: true,
    surplusPerPeriod: 10500, startWallet: 8000, medical: 18000, repair: 6000, premium: 1500, extra: 10000, scam: 2999,
  }),
  app: () => fromOffer(APP_LOAN, {
    id: 'app', title: 'Instant app loan', blurb: 'Short, small and very expensive',
    surplusPerPeriod: 5000, startWallet: 1000, medical: 4000, repair: 1500, premium: 300, extra: 1500, scam: 999,
  }),
  home: () => fromOffer(HOME_LOAN, {
    id: 'home', title: 'Home loan, 20 years', blurb: 'One toll gate is a whole year', stride: 12,
    surplusPerPeriod: 28000, startWallet: 100000, medical: 120000, repair: 60000, premium: 18000, extra: 100000, scam: 25000,
  }),
  shop: () => fromMerchant({
    id: 'shop', title: 'Soundbox shop loan', blurb: 'Repaid every day, from your sales', real: true,
    surplusPerPeriod: 700, startWallet: 3000, medical: 9000, repair: 3500, premium: 800, extra: 8000, scam: 2999,
  }),
});

export const levelIds = () => Object.keys(LEVELS);
export const buildLevel = (id) => (LEVELS[id] || LEVELS.personal)();

// The customer's own loan, from a document they uploaded or the numbers they said.
export function levelFromCard(card) {
  if (!card?.principal || !card?.emi || !card?.months) return buildLevel('personal');
  return {
    ...buildLevel('personal'), id: 'personal', title: card.product ? `Your ${String(card.product).toLowerCase()}` : 'Your loan',
    principal: card.principal, ratePct: card.ratePct, fees: card.fees ?? 0, net: card.net ?? card.principal, payment: card.emi, periods: card.months,
    periodRate: card.ratePct / 1200, aprPct: card.aprPct, totalRepay: card.totalRepay, totalCost: card.totalCost, coolingOffDays: card.coolingOffDays ?? null,
    surplusPerPeriod: Math.round(card.emi * 1.25), startWallet: Math.round(card.emi * 0.85), medical: Math.round(card.emi * 1.9), repair: Math.round(card.emi * 0.65),
    premium: Math.round(card.emi * 0.16), extra: Math.round(card.emi), scam: 2999,
  };
}

export function createRun(level) {
  return {
    level, wallet: level.startWallet, balance: level.principal, period: 0, gate: 0, finished: false, plain: true,
    paid: 0, interestPaid: 0, principalPaid: 0, charges: 0, extraPaid: 0, bounces: 0, credit: START_CREDIT,
    shield: false, shieldUsed: 0, premiumsPaid: 0, billsPaid: 0, billsCovered: 0, scamLost: 0, scamsAvoided: 0, coinsEarned: 0,
    firstGate: null, lastGate: null,
  };
}

// How the rest of the loan runs if every payment is made on time.
export function remaining(balance, level) {
  let left = balance, interest = 0, periods = 0;
  while (left > 0.5 && periods < 2000) {
    const due = left * level.periodRate;
    interest += due;
    left = left + due - level.payment;
    periods += 1;
  }
  return { interest, periods };
}

export const gatesLeft = (run) => Math.ceil(remaining(run.balance, run.level).periods / run.level.stride);

// One toll gate: the surplus arrives, then the EMI is taken. A wallet that can't cover
// it bounces: the interest still adds to the loan, a charge lands, credit health drops.
export function payGate(run) {
  const { level } = run;
  const stride = Math.min(level.stride, Math.max(remaining(run.balance, level).periods, 1));
  run.wallet += level.surplusPerPeriod * stride;
  let due = 0;
  let future = run.balance;
  for (let i = 0; i < stride; i++) {
    const interest = future * level.periodRate;
    const pay = Math.min(level.payment, future + interest);
    due += pay;
    future = future + interest - pay;
  }
  // A clean run pays exactly what the KFS says: the last EMI absorbs the rupee rounding.
  if (run.plain && run.period + stride >= level.periods) {
    due = level.payment * stride;
    future = 0;
  }
  run.gate += 1;

  if (run.wallet < due) {
    const interest = Array.from({ length: stride }).reduce((sum) => sum + (run.balance + sum) * level.periodRate, 0);
    run.balance += interest;
    run.wallet -= BOUNCE_CHARGE;
    run.charges += BOUNCE_CHARGE;
    run.bounces += 1;
    run.plain = false;
    run.credit = Math.max(300, run.credit - 45);
    run.period += stride;
    return { bounced: true, due, interestAdded: interest, charge: BOUNCE_CHARGE, gatesLeft: gatesLeft(run), finished: false };
  }

  const principal = run.balance - future;
  const interest = due - principal;
  run.wallet -= due;
  run.paid += due;
  run.interestPaid += interest;
  run.principalPaid += principal;
  run.balance = future <= 0.5 ? 0 : future;
  run.period += stride;
  run.credit = Math.min(850, run.credit + 3);
  const out = { bounced: false, due, interest, principal, interestShare: due ? interest / due : 0, gatesLeft: gatesLeft(run), finished: run.balance === 0 };
  if (!run.firstGate) run.firstGate = { due, interest, principal };
  run.lastGate = { due, interest, principal };
  run.finished = out.finished;
  return out;
}

export function prepay(run, amount = run.level.extra) {
  if (run.wallet < amount || run.balance <= 0) return { paid: false, need: amount };
  const before = remaining(run.balance, run.level);
  const pay = Math.min(amount, run.balance);
  run.wallet -= pay;
  run.balance -= pay;
  run.paid += pay;
  run.principalPaid += pay;
  run.extraPaid += pay;
  run.plain = false;
  const after = remaining(run.balance, run.level);
  run.finished = run.balance <= 0.5;
  return { paid: true, amount: pay, periodsSaved: before.periods - after.periods, interestSaved: Math.max(0, before.interest - after.interest), gatesLeft: gatesLeft(run), finished: run.finished };
}

export function collect(run, pickup) {
  const { level } = run;
  switch (pickup.kind) {
    case 'coin':
      run.wallet += pickup.amount;
      run.coinsEarned += pickup.amount;
      return { amount: pickup.amount };
    case 'bill': {
      if (pickup.medical && run.shield) {
        run.shield = false;
        run.shieldUsed += 1;
        run.billsCovered += pickup.amount;
        return { covered: true, amount: pickup.amount };
      }
      run.wallet -= pickup.amount;
      run.billsPaid += pickup.amount;
      return { covered: false, amount: pickup.amount };
    }
    case 'shield':
      if (run.shield) return { bought: false };
      run.wallet -= level.premium;
      run.premiumsPaid += level.premium;
      run.shield = true;
      return { bought: true, amount: level.premium };
    case 'scam':
      run.wallet -= pickup.amount;
      run.scamLost += pickup.amount;
      return { amount: pickup.amount };
    case 'prepay':
      return prepay(run, pickup.amount);
    default:
      return {};
  }
}

const mulberry = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// What lies on the road before each toll gate. Same seed, same road.
export function spawnPlan(level, seed = 7) {
  const rand = mulberry(seed);
  const gates = Math.ceil(level.periods / level.stride);
  const at = (share) => Math.min(gates - 1, Math.floor(gates * share));
  const plan = Array.from({ length: gates }, () => []);
  const coinValue = () => Math.round((level.surplusPerPeriod * level.stride * (0.02 + rand() * 0.03)) / 50) * 50 || 50;
  plan.forEach((items) => {
    const count = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < count; i++) items.push({ kind: 'coin', lane: Math.floor(rand() * 3), offset: 0.25 + rand() * 0.5, amount: coinValue() });
  });
  const place = (share, item) => {
    const items = plan[at(share)];
    const taken = items.map((other) => other.lane);
    const lane = [0, 1, 2].find((candidate) => !taken.includes(candidate)) ?? 1;
    items.push({ lane, offset: 0.5, ...item });
  };
  place(0.06, { kind: 'shield', amount: level.premium });
  place(0.2, { kind: 'scam', amount: level.scam });
  place(0.28, { kind: 'bill', medical: true, amount: level.medical, label: 'Hospital bill' });
  place(0.36, { kind: 'prepay', amount: level.extra });
  place(0.5, { kind: 'bill', medical: false, amount: level.repair, label: 'Repair' });
  place(0.58, { kind: 'prepay', amount: level.extra });
  place(0.68, { kind: 'scam', amount: level.scam });
  place(0.8, { kind: 'bill', medical: true, amount: level.medical, label: 'Hospital bill' });
  plan.forEach((items) => items.sort((a, b) => a.offset - b.offset));
  return plan;
}

// The same loan as a plain table, for anyone who can't or won't play.
export function scheduleRows(level) {
  const run = createRun(level);
  run.wallet = Number.MAX_SAFE_INTEGER / 4;
  const rows = [];
  while (!run.finished && rows.length < 400) {
    const gate = payGate(run);
    rows.push({ at: run.period, paid: Math.round(gate.due), interest: Math.round(gate.interest), loan: Math.round(gate.principal), left: Math.round(run.balance) });
  }
  return rows;
}

export function summary(run) {
  const { level } = run;
  const plainTotal = level.totalRepay;
  const fullPlainInterest = plainTotal - level.principal;
  const stars = run.bounces === 0 && run.scamLost === 0 ? (run.extraPaid > 0 ? 3 : 2) : run.bounces <= 1 ? 1 : 0;
  return {
    borrowed: level.principal, received: level.net, fees: level.fees, paid: Math.round(run.paid), interestPaid: Math.round(run.interestPaid),
    charges: run.charges, extraPaid: run.extraPaid, bounces: run.bounces, credit: run.credit, billsPaid: run.billsPaid, billsCovered: run.billsCovered,
    premiums: run.premiumsPaid, scamLost: run.scamLost, periodsTaken: run.period, periodsPlanned: level.periods, unit: level.unit,
    plainTotal, interestSaved: Math.max(0, Math.round(fullPlainInterest - run.interestPaid)), stars, finished: run.finished,
    mistakesCost: Math.round(run.charges + run.scamLost + Math.max(0, run.interestPaid - fullPlainInterest)),
    ratePct: level.ratePct, aprPct: level.aprPct, wallet: Math.round(run.wallet),
    firstInterestShare: run.firstGate ? Math.round((run.firstGate.interest / run.firstGate.due) * 100) : null,
    lastInterestShare: run.lastGate ? Math.round((run.lastGate.interest / run.lastGate.due) * 100) : null,
  };
}

// The lessons, in English. The server translates them behind the figures fence.
export function lessonLine(id, level, data = {}) {
  const per = level.unit === 'day' ? 'day' : 'month';
  switch (id) {
    case 'fee': return `You asked for ${inr(level.principal)}. ${inr(level.fees)} went in fees before you started, so ${inr(level.net)} reached you.`;
    case 'first_emi': return `Your first payment was ${inr(data.due)}. ${inr(data.interest)} of it went to interest, and only ${inr(data.principal)} cut your loan.`;
    case 'last_emi': return `Near the end, only ${inr(data.interest)} of ${inr(data.due)} is interest. Early payments carry the most interest.`;
    case 'bounce': return `Your wallet could not cover ${inr(data.due)}. A ${inr(data.charge)} charge landed, the interest still grew, and your credit health fell.`;
    case 'prepay': return `You paid ${inr(data.amount)} extra. That saves about ${inr(data.interestSaved)} in interest and ${data.periodsSaved} ${per}${data.periodsSaved === 1 ? '' : 's'}.`;
    case 'prepay_short': return `You need ${inr(data.need)} in your wallet to pay extra. Keep a little aside every ${per}.`;
    case 'scam': return `That was a trap, and you lost ${inr(data.amount)}. A real lender never asks you to pay a fee to release a loan.`;
    case 'bill': return `A ${inr(data.amount)} hospital bill came out of your own wallet, with no cover.`;
    case 'repair': return `A ${inr(data.amount)} repair came out of your wallet. Savings are what stop a bill from becoming a missed payment.`;
    case 'shield_buy': return `You bought health cover for ${inr(data.amount)}. It is a small cost, for a big bill that may come.`;
    case 'shield_used': return `Your cover paid the ${inr(data.amount)} hospital bill. Your loan payments stayed safe.`;
    case 'apr': return level.ratePct != null
      ? `The rate shown was ${pct(level.ratePct)}. With the fee counted, the real yearly cost is ${pct(level.aprPct)}.`
      : `This loan shows no yearly rate at all. With the fee counted, its real yearly cost is ${pct(level.aprPct)}.`;
    default: return '';
  }
}

export const LABELS = Object.freeze({
  wallet: 'Wallet', nextDue: 'Next payment', loanLeft: 'Loan left', credit: 'Credit health', interest: 'Interest paid', tap: 'Tap to continue', up: 'Up', down: 'Down',
  title: 'Karz Yatra', tag: 'Drive your loan to the finish line', start: 'Start driving', choose: 'Choose a loan', quit: 'Leave the game', again: 'Play again', another: 'Try another loan',
  howGold: 'Coins add to your wallet', howGate: 'Every toll gate takes your payment', howTrap: 'Pink prizes are traps', howBill: 'Red signs are bills', howShield: 'A blue shield is health cover', howExtra: 'A gold arch pays extra',
  reached: 'Reached you', interestAll: 'Interest you paid', charges: 'Charges', totalPaid: 'Total you paid', finishedIn: 'Finished in', quizTitle: 'Did it make sense?', quizLead: 'Three quick questions. They go on your receipt, and nothing is blocked if you get one wrong.',
  sealed: 'Sealed on your Journey Passport', check: 'Check my answers', ask: 'Ask MITRA about this', saved: 'Interest you saved', mistakes: 'What mistakes cost you', yourRun: 'Your run', month: 'months', day: 'days',
});

// The understanding check. Built from the same level on both sides, and graded on the
// server, so the result on the receipt is what the customer really answered.
export function quizFor(level) {
  const questions = [
    { id: 'net', q: `You borrow ${inr(level.principal)}. How much actually reaches you?`, options: [inr(level.totalRepay), inr(level.net), inr(level.principal)], answer: 1 },
    { id: 'apr', q: 'Once the fee is counted, what is the real yearly cost?', options: level.ratePct != null ? [pct(level.aprPct), pct(level.ratePct), pct(level.ratePct / 2)] : [pct(level.aprPct), pct(level.aprPct / 2), pct(level.aprPct / 4)], answer: 0 },
    { id: 'early', q: 'When does paying extra save you the most interest?', options: ['Near the end of the loan', 'It makes no difference', 'Early in the loan'], answer: 2 },
  ];
  if (level.coolingOffDays) questions.push({ id: 'exit', q: 'After signing, how long can you walk away without a penalty?', options: [`${level.coolingOffDays} days`, 'You cannot', '30 days'], answer: 0 });
  questions.push({ id: 'scam', q: 'A stranger says your loan is approved, and asks for a fee to release it. What do you do?', options: ['Pay, it is small', 'Do not pay', 'Pay half'], answer: 1 });
  return questions;
}

export function gradeQuiz(level, answers) {
  const questions = quizFor(level);
  const rows = questions.map((question, index) => ({ id: question.id, question: question.q, chosen: question.options[answers?.[index]] ?? null, right: question.options[question.answer], correct: answers?.[index] === question.answer }));
  return { rows, correct: rows.filter((row) => row.correct).length, total: rows.length, missed: rows.filter((row) => !row.correct).map((row) => row.id) };
}
