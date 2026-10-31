// Merchant engine: working capital eligibility from a consented sales summary,
// and the real cost of a daily-repayment loan.
import { PACKS, packStamp } from '../policyPacks.js';
import { aprPct } from './lending.js';
import { inr } from '../money.js';

export function merchantEligibility(sales) {
  const pack = PACKS.merchant;
  const { minActiveMonths, maxOfAverageMonthlySales } = pack.assumptions;
  const values = sales.months.map((month) => month.sales);
  const average = Math.round(values.reduce((total, value) => total + value, 0) / values.length);
  const lowest = Math.min(...values);
  const eligible = values.length >= minActiveMonths;
  const limit = eligible ? Math.floor((average * maxOfAverageMonthlySales) / 10000) * 10000 : 0;
  return {
    merchant: sales.name, source: sales.source, months: sales.months, monthCount: values.length,
    averageMonthly: average, averageDaily: Math.round(average / 30), lowestMonth: lowest,
    eligible, limit,
    formula: `Limit = ${maxOfAverageMonthlySales * 100}% of average monthly sales ${average}, rounded down to ₹10,000`,
    assumption: 'The sales share and minimum months are MITRA defaults. The partner lender makes the decision.',
    pack: packStamp(pack),
  };
}

export function explainMerchantOffer(offer, eligibility) {
  const pack = PACKS.merchant;
  const fee = Math.round((offer.principal * offer.processingFeePct) / 100);
  const gst = Math.round((fee * offer.gstOnFeePct) / 100);
  const net = offer.principal - fee - gst;
  const totalRepay = offer.dailyRepayment * offer.days;
  const apr = Number(aprPct(net, offer.dailyRepayment, offer.days, 365).toFixed(1));
  const shareOfDailySales = Number(((offer.dailyRepayment / eligibility.averageDaily) * 100).toFixed(1));
  const { maxDailyRepaymentOfDailySalesPct: maxShare } = pack.assumptions;
  return {
    offerId: offer.id, product: offer.product, principal: offer.principal, days: offer.days,
    dailyRepayment: offer.dailyRepayment, fee, gst, net, totalRepay, totalCost: totalRepay - net,
    aprPct: apr, shareOfDailySales, fits: shareOfDailySales <= maxShare, withinLimit: offer.principal <= eligibility.limit,
    coolingOffDays: offer.coolingOffDays, averageDaily: eligibility.averageDaily,
    formula: `APR = 365 × daily IRR(+${net}, ${offer.days} × −${offer.dailyRepayment})`,
    evidence: [
      { field: 'Key Fact Statement', value: `${offer.version} from the lender`, source: offer.id, asOf: offer.issuedOn },
      { field: 'Charges', value: `fee ${inr(fee)} + GST ${inr(gst)}`, source: offer.id, asOf: offer.issuedOn },
      { field: 'Sales summary', value: `${eligibility.monthCount} months, average ${inr(eligibility.averageMonthly)}`, source: eligibility.source, asOf: offer.issuedOn },
    ],
    pack: packStamp(PACKS.lending),
  };
}
