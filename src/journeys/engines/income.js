// Income engine: what a gig worker or shopkeeper really earns, from the bank
// statements, receipts and tax returns they confirmed. Deterministic: the same
// rows give the same rupees. A model read the paper; it does not count here.
//
// Lenders lend against a weak month, not a good one, so the income MITRA counts
// is the lower of the median month and the average of the weakest months.
import { PACKS, packStamp } from '../policyPacks.js';
import { aprPct, emiFor, principalFor } from './lending.js';
import { inr, pct } from '../money.js';

const anyOf = (words) => new RegExp(`\\b(${words.join('|')})\\b`, 'i');
const ruleSet = (groups) => Object.entries(groups).map(([id, words]) => [id, anyOf(words)]);

export const STREAM_LABELS = Object.freeze({
  platform: 'Platform payouts', upi: 'UPI payments received', cash: 'Cash deposits', salary: 'Salary', other: 'Other credits', excluded: 'Not income',
});
const EXCLUDED_WHY = [
  [/self transfer|own account/i, 'Your own money, moved between accounts'],
  [/refund|reversal|reversed|cashback/i, 'A refund is money coming back, not earned'],
  [/loan disburs/i, 'A loan is borrowed, not earned'],
  [/int\.? cr|interest/i, 'Bank interest, too small to lend against'],
];

export function classifyCredit(description, pack = PACKS.income) {
  const text = String(description || '');
  for (const [id, re] of ruleSet(pack.credits)) if (re.test(text)) return id;
  return 'other';
}

export function classifyDebit(description, pack = PACKS.income) {
  const text = String(description || '');
  for (const [id, re] of ruleSet(pack.debits)) if (re.test(text)) return id;
  return 'spend';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (key) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

const sum = (values) => values.reduce((total, value) => total + value, 0);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const floorTo = (value, step) => Math.max(Math.floor(value / step) * step, 0);

// A receipt that is also on the statement is the same money, counted once.
// The statement's own period wins over its first and last rows.
export function mergeReceipts(transactions, receipts, period = {}) {
  const dates = transactions.map((row) => row.date).sort();
  const from = period.from || dates[0], to = period.to || dates.at(-1);
  const added = [], duplicates = [], outside = [];
  for (const receipt of receipts) {
    const twin = transactions.find((row) => row.credit === receipt.credit && row.date === receipt.date);
    if (twin) duplicates.push({ ...receipt, twin: twin.description });
    // A receipt after the statement ends would make a month of one payment.
    else if (from && (receipt.date < from || receipt.date > to)) outside.push(receipt);
    else added.push(receipt);
  }
  return { transactions: [...transactions, ...added], added, duplicates, outside };
}

// `transactions`: [{ date: 'YYYY-MM-DD', description, credit, debit, source }], only the
// rows the customer kept. `declared`: [{ kind: 'income' | 'turnover', annual, label, source }].
export function incomeProfile({ transactions = [], declared = [] } = {}, pack = PACKS.income) {
  const { minMonths, weakMonths, roundTo, emiComfortablePct, emiStretchPct, declaredGapPct, steadyBelowPct, unevenBelowPct } = pack.assumptions;
  const byMonth = new Map();
  const streams = new Map();
  const excluded = [];
  for (const row of transactions) {
    const key = String(row.date).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    if (!byMonth.has(key)) byMonth.set(key, { key, label: monthLabel(key), income: 0, gross: 0, business: 0, emi: 0, rent: 0, byStream: {} });
    const month = byMonth.get(key);
    if (row.credit > 0) {
      const stream = row.stream || classifyCredit(row.description, pack);
      if (stream === 'excluded') {
        excluded.push({ date: row.date, description: row.description, amount: row.credit, why: EXCLUDED_WHY.find(([re]) => re.test(row.description))?.[1] || 'Not income' });
        continue;
      }
      month.income += row.credit;
      month.gross += row.credit;
      month.byStream[stream] = (month.byStream[stream] || 0) + row.credit;
      const item = streams.get(stream) || { id: stream, label: STREAM_LABELS[stream], total: 0, count: 0 };
      item.total += row.credit;
      item.count += 1;
      streams.set(stream, item);
    }
    if (row.debit > 0) {
      const kind = classifyDebit(row.description, pack);
      if (kind === 'business') month.business += row.debit;
      if (kind === 'emi') month.emi += row.debit;
      if (kind === 'rent') month.rent += row.debit;
    }
  }

  const months = [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key))
    .map((month) => ({ ...month, net: Math.round(month.income - month.business) }));
  const nets = months.map((month) => month.net);
  const count = months.length;
  const statement = count > 0;

  // No statement: the tax return is all there is, and it is labelled that way.
  const declaredRows = declared.filter((item) => item.annual > 0).map((item) => ({ ...item, monthly: Math.round(item.annual / 12) }));
  const fromReturn = declaredRows.find((item) => item.kind === 'income');
  const basis = statement ? 'statements' : fromReturn ? 'declared' : 'none';

  const average = statement ? Math.round(sum(nets) / count) : fromReturn?.monthly ?? 0;
  const middle = statement ? Math.round(median(nets)) : average;
  const weakest = statement ? [...nets].sort((a, b) => a - b).slice(0, Math.min(weakMonths, count)) : [average];
  const weakAverage = Math.round(sum(weakest) / weakest.length);
  const counted = floorTo(Math.min(middle, weakAverage), roundTo);
  const spread = statement && average > 0 ? Math.sqrt(sum(nets.map((value) => (value - average) ** 2)) / count) / average * 100 : 0;
  const volatilityPct = Number(spread.toFixed(1));
  const steadiness = volatilityPct < steadyBelowPct ? 'steady' : volatilityPct < unevenBelowPct ? 'uneven' : 'very uneven';
  const trendPct = count >= 4 ? (() => {
    const half = Math.min(3, Math.floor(count / 2));
    const first = sum(nets.slice(0, half)) / half, last = sum(nets.slice(-half)) / half;
    return first > 0 ? Number((((last - first) / first) * 100).toFixed(1)) : null;
  })() : null;
  const existingEmi = statement ? Math.round(sum(months.map((month) => month.emi)) / count) : 0;
  const rent = statement ? Math.round(sum(months.map((month) => month.rent)) / count) : 0;
  const business = statement ? Math.round(sum(months.map((month) => month.business)) / count) : 0;
  const grossAverage = statement ? Math.round(sum(months.map((month) => month.gross)) / count) : 0;

  const comfortableEmi = floorTo((counted * emiComfortablePct) / 100 - existingEmi, roundTo);
  const stretchEmi = floorTo((counted * emiStretchPct) / 100 - existingEmi, roundTo);

  // What the customer told the tax department, beside what the bank shows.
  const checks = statement ? declaredRows.map((item) => {
    const observed = item.kind === 'turnover' ? grossAverage : average;
    const gapPct = Number((((observed - item.monthly) / item.monthly) * 100).toFixed(1));
    return { ...item, observed, gapPct, flagged: Math.abs(gapPct) > declaredGapPct };
  }) : declaredRows.map((item) => ({ ...item, observed: null, gapPct: null, flagged: false }));

  const streamList = [...streams.values()].sort((a, b) => b.total - a.total)
    .map((item) => ({ ...item, monthly: Math.round(item.total / Math.max(count, 1)), sharePct: Number(((item.total / Math.max(sum(months.map((month) => month.income)), 1)) * 100).toFixed(1)) }));

  return {
    basis, monthCount: count, enoughHistory: basis === 'statements' && count >= minMonths, minMonths,
    from: months[0]?.label ?? null, to: months.at(-1)?.label ?? null,
    months: months.map(({ key, label, income, business: spent, emi, net }) => ({ key, label, income, business: spent, emi, net })),
    streams: streamList, excluded,
    average, median: middle, lowest: statement ? Math.min(...nets) : average, highest: statement ? Math.max(...nets) : average,
    weakAverage, weakMonths: weakest.length, counted, volatilityPct, steadiness, trendPct,
    existingEmi, rent, business, grossAverage,
    comfortableEmi, stretchEmi, comfortablePct: emiComfortablePct, stretchPct: emiStretchPct,
    declared: checks,
    formula: `Counted income = lower of the median month ${middle} and the average of the ${weakest.length} weakest months ${weakAverage}, rounded down to ₹${roundTo}. Safe EMI = ${emiComfortablePct}% of it − existing EMIs ${existingEmi}`,
    assumption: `MITRA defaults: income is counted from weak months; up to ${emiComfortablePct}% of it on all EMIs is comfortable, and ${emiStretchPct}% is the most it calls safe. The lender decides.`,
    pack: packStamp(pack),
  };
}

// A customer who only says a number. It is their word, not a document, and labelled so.
export function statedProfile(income, pack = PACKS.income) {
  const { emiComfortablePct, emiStretchPct, roundTo } = pack.assumptions;
  return {
    basis: 'stated', monthCount: 0, enoughHistory: false, minMonths: pack.assumptions.minMonths, months: [], streams: [], excluded: [], declared: [],
    average: income, median: income, lowest: income, highest: income, weakAverage: income, weakMonths: 0, counted: income,
    volatilityPct: 0, steadiness: 'not known', trendPct: null, existingEmi: 0, rent: 0, business: 0, grossAverage: 0,
    comfortableEmi: floorTo((income * emiComfortablePct) / 100, roundTo), stretchEmi: floorTo((income * emiStretchPct) / 100, roundTo),
    comfortablePct: emiComfortablePct, stretchPct: emiStretchPct,
    formula: `Safe EMI = ${emiComfortablePct}% of the income you told me, ${income}`,
    assumption: 'From the income you told me, not from documents.',
    pack: packStamp(pack),
  };
}

const bandFor = (sharePct, profile) => (sharePct <= profile.comfortablePct ? 'fits' : sharePct <= profile.stretchPct ? 'tight' : 'stretch');

// One set of loan terms against the customer's months. Pure, so the on-screen
// sliders run the same function as the agent, with no network in between.
export function cashFlowWithLoan(profile, { principal, ratePct, months, feePct = 0 }) {
  const emi = emiFor(principal, ratePct, months);
  const fees = Math.round((principal * feePct) / 100);
  const net = principal - fees;
  const totalRepay = emi * months;
  const apr = fees > 0 ? Number(aprPct(net, emi, months, 12).toFixed(1)) : ratePct;
  const base = {
    principal, months, ratePct, feePct, emi, fees, net, totalRepay, totalCost: totalRepay - net, aprPct: apr,
    formula: `EMI = ${principal} × r × (1+r)^${months} ÷ ((1+r)^${months} − 1), r = ${ratePct}% ÷ 12`,
  };
  if (!profile?.counted) return { ...base, sharePct: null, band: null, leftOver: null, monthly: [], tightMonths: 0 };
  const allEmis = emi + profile.existingEmi;
  const sharePct = Number(((allEmis / profile.counted) * 100).toFixed(1));
  const monthly = profile.months.map((month) => {
    const share = month.net > 0 ? ((emi + month.emi) / month.net) * 100 : Infinity;
    return { label: month.label, income: month.net, existing: month.emi, emi, left: month.net - month.emi - emi, tight: share > profile.stretchPct };
  });
  return {
    ...base, sharePct, band: bandFor(sharePct, profile), leftOver: profile.counted - allEmis,
    counted: profile.counted, existingEmi: profile.existingEmi, monthly, tightMonths: monthly.filter((month) => month.tight).length,
  };
}

// The largest loan, at these terms, whose EMI stays comfortable.
export const comfortableLoan = (profile, { ratePct, months }) => floorTo(principalFor(profile.comfortableEmi, ratePct, months), 1000);

export function feePctOf(offer) {
  const fees = offer.processingFee + offer.gstOnFee + (offer.otherCharges || 0);
  return Number(((fees / offer.principal) * 100).toFixed(2));
}

// Plain words for the customer, built only from figures computed above.
export function incomeLine(profile) {
  if (profile.basis === 'stated') return `On the ${inr(profile.counted)} income you told me, an EMI up to ${inr(profile.comfortableEmi)} is comfortable.`;
  if (profile.basis === 'declared') return `I only have your tax return, which shows ${inr(profile.average)} a month. Bank statements would show what really comes in.`;
  const range = profile.lowest !== profile.highest ? `, but it moved between ${inr(profile.lowest)} and ${inr(profile.highest)}` : '';
  return `From ${profile.monthCount} months of your papers, you earned ${inr(profile.average)} a month on average${range}. To be safe, I count ${inr(profile.counted)}, from your weaker months.`;
}

export function declaredLine(profile) {
  const flagged = profile.declared.find((item) => item.flagged);
  if (!flagged) return '';
  const direction = flagged.gapPct > 0 ? 'more' : 'less';
  return ` Your bank shows ${pct(Math.abs(flagged.gapPct))} ${direction} than the ${inr(flagged.monthly)} a month on your ${flagged.label}. A lender will ask about that, so keep both ready.`;
}
