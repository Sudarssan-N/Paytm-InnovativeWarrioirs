// Lending engine: what a loan really costs, whether the EMI fits, and how long
// the customer can still walk away. Deterministic: same KFS in, same rupees out.
import { PACKS, packStamp } from '../policyPacks.js';
import { addDays, daysBetween, fmtDate, inr, pct } from '../money.js';

export function emiFor(principal, annualPct, months) {
  const r = annualPct / 1200;
  if (r === 0) return Math.round(principal / months);
  const growth = (1 + r) ** months;
  return Math.round((principal * r * growth) / (growth - 1));
}

// The periodic rate at which `payment × periods` is worth exactly `net` today.
// Bisection, because it cannot diverge on a stage.
export function periodicIrr(net, payment, periods) {
  if (!(net > 0) || !(payment > 0) || !(periods > 0)) throw new RangeError('net, payment and periods must be positive');
  const worth = (rate) => (rate === 0 ? payment * periods : (payment * (1 - (1 + rate) ** -periods)) / rate);
  let low = 0, high = 1;
  if (worth(0) < net) throw new RangeError('payments never repay the amount received');
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    if (worth(mid) > net) low = mid; else high = mid;
  }
  return (low + high) / 2;
}

export const aprPct = (net, payment, periods, periodsPerYear) => periodicIrr(net, payment, periods) * periodsPerYear * 100;

export function emiFit(emi, income, pack = PACKS.lending) {
  const share = (emi / income) * 100;
  const { emiFitComfortablePct: comfortable, emiFitStretchPct: stretch } = pack.assumptions;
  const band = share <= comfortable ? 'fits' : share <= stretch ? 'tight' : 'stretch';
  return { sharePct: Number(share.toFixed(1)), band, income };
}

export function explainLoanOffer(offer, { income = null } = {}) {
  const pack = PACKS.lending;
  const emi = emiFor(offer.principal, offer.ratePct, offer.months);
  const fees = offer.processingFee + offer.gstOnFee + offer.otherCharges;
  const net = offer.principal - fees;
  const apr = aprPct(net, emi, offer.months, 12);
  const totalRepay = emi * offer.months;
  const fit = income ? emiFit(emi, income, pack) : null;
  const aprRounded = Number(apr.toFixed(1));
  return {
    offerId: offer.id,
    principal: offer.principal, months: offer.months, ratePct: offer.ratePct, rateType: offer.rateType,
    processingFee: offer.processingFee, gstOnFee: offer.gstOnFee, fees, net, emi, totalRepay,
    totalCost: totalRepay - net,
    aprPct: aprRounded, aprGapPct: Number((aprRounded - offer.ratePct).toFixed(1)),
    fit, coolingOffDays: offer.coolingOffDays,
    formula: `APR = 12 × monthly IRR(+${net}, ${offer.months} × −${emi})`,
    evidence: [
      { field: 'Key Fact Statement', value: `${offer.version} from the lender`, source: offer.id, asOf: offer.issuedOn },
      { field: 'Charges', value: `fee ${inr(offer.processingFee)} + GST ${inr(offer.gstOnFee)}`, source: offer.id, asOf: offer.issuedOn },
      { field: 'Repayment', value: `${offer.months} EMIs of ${inr(emi)}`, source: 'Computed from the KFS', asOf: offer.issuedOn },
    ],
    pack: packStamp(pack),
    assumption: `EMI bands are MITRA defaults: up to ${pack.assumptions.emiFitComfortablePct}% of income fits, above ${pack.assumptions.emiFitStretchPct}% is a stretch.`,
  };
}

// Cooling-off runs from the day the customer signs. Exit cost is the principal
// plus the APR for the days actually held, which is what the rule describes.
export function coolingOffStatus(offer, { signedOn = null, today } = {}) {
  const pack = PACKS.lending;
  const days = offer.coolingOffDays;
  if (!signedOn) return { signed: false, days, pack: packStamp(pack), minimumDays: pack.rules.coolingOffMinDays };
  const endsOn = addDays(signedOn, days);
  const remindOn = addDays(endsOn, -1);
  const daysLeft = Math.max(daysBetween(today, endsOn), 0);
  const explained = explainLoanOffer(offer);
  const interestForWindow = Math.round((offer.principal * (explained.aprPct / 100) * days) / 365);
  return {
    signed: true, days, signedOn, endsOn, remindOn, daysLeft, open: daysLeft > 0,
    exitCost: offer.principal + interestForWindow, interestForWindow,
    endsLabel: fmtDate(endsOn), remindLabel: fmtDate(remindOn),
    formula: `Exit cost = ${offer.principal} + ${offer.principal} × ${explained.aprPct}% × ${days} ÷ 365`,
    pack: packStamp(pack),
  };
}

// MITRA will not guess a charge the KFS does not state. Only the one case the
// RBI rule settles outright (floating rate, individual, non-business, sanctioned
// from 2026) is answered without a person.
export function foreclosureTerms(offer) {
  const pack = PACKS.prepayment;
  if (offer.foreclosure) return { known: true, source: 'kfs', terms: offer.foreclosure, pack: packStamp(pack) };
  if (offer.rateType === 'floating' && offer.purpose !== 'business' && offer.issuedOn >= pack.asOf) {
    return { known: true, source: 'rule', terms: 'no pre-payment charge', pack: packStamp(pack) };
  }
  return { known: false, reason: 'Foreclosure charges are not in the KFS the lender shared.', ruleNote: pack.rules.otherwise, pack: packStamp(pack) };
}

// Prepaying saves the loan's own rate for certain. Investing might beat it, or
// might not. Interest saved is computed by re-running the amortisation.
export function prepayVsInvest(offer, { extra, investReturnPct = 10 }) {
  const pack = PACKS.lending;
  const emi = emiFor(offer.principal, offer.ratePct, offer.months);
  const r = offer.ratePct / 1200;
  const interestLeft = (balance) => {
    let paid = 0, months = 0;
    while (balance > 0.5 && months < 600) {
      const interest = balance * r;
      paid += interest;
      balance = balance + interest - emi;
      months++;
    }
    return { paid, months };
  };
  const base = interestLeft(offer.principal);
  const after = interestLeft(offer.principal - extra);
  const interestSaved = Math.round(base.paid - after.paid);
  const monthsSaved = base.months - after.months;
  const invested = Math.round(extra * (1 + investReturnPct / 1200) ** offer.months);
  const investGain = invested - extra;
  return {
    extra, interestSaved, monthsSaved, investReturnPct, invested, investGain,
    better: interestSaved >= investGain ? 'prepay' : 'invest',
    formula: `Interest saved = amortisation of ${offer.principal} − amortisation of ${offer.principal - extra}, at ${pct(offer.ratePct)} over the same EMI`,
    assumption: `Investing at ${pct(investReturnPct)} a year is an assumption, not a promise. The prepayment saving is certain only if the lender charges nothing for it.`,
    pack: packStamp(pack),
  };
}
