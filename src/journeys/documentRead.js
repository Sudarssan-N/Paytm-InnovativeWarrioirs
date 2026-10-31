// What Sarvam Vision read from a customer's own loan paper. The figures are checked
// against each other before the engine uses them, and read back to the customer.
// A model reads the page, but it still can't invent a rupee: the customer confirms
// every figure, and the engine recomputes what the lender states.
import { aprPct, emiFor } from './engines/lending.js';
import { addDays, inr, isoDate, pct } from './money.js';

export const LOAN_DOCUMENT_SCHEMA = {
  type: 'object',
  properties: {
    doc_kind: { type: 'string', enum: ['loan_kfs', 'insurance_policy', 'claim_settlement', 'other'], description: 'What kind of document this is' },
    lender: { type: 'string', description: 'Name of the lender or issuer' },
    product: { type: 'string', description: 'Name of the loan product' },
    principal: { type: 'number', description: 'Sanctioned loan amount in rupees' },
    rate_pct: { type: 'number', description: 'Yearly interest rate as a percent' },
    rate_type: { type: 'string', description: 'fixed or floating' },
    months: { type: 'integer', description: 'Loan term in months' },
    emi: { type: 'number', description: 'Monthly instalment in rupees' },
    processing_fee: { type: 'number', description: 'Processing fee in rupees, without GST' },
    gst_on_fee: { type: 'number', description: 'GST on the processing fee in rupees' },
    other_charges: { type: 'number', description: 'Any other charge deducted from the loan, such as bundled insurance, in rupees' },
    net_disbursed: { type: 'number', description: 'Net amount paid to the borrower in rupees' },
    apr_pct: { type: 'number', description: 'Annual Percentage Rate stated by the lender' },
    cooling_off_days: { type: 'integer', description: 'Cooling-off period in days' },
    foreclosure: { type: 'string', description: 'Foreclosure or prepayment charge, as written' },
  },
};

const LABEL = {
  principal: 'Loan amount', rate_pct: 'Interest rate', months: 'Term', emi: 'Monthly EMI', processing_fee: 'Processing fee', gst_on_fee: 'GST on the fee',
  other_charges: 'Other charges', net_disbursed: 'Reaches you', apr_pct: 'APR stated', cooling_off_days: 'Cooling-off', foreclosure: 'Foreclosure charge',
};
const show = (field, value) => {
  if (value == null || value === '') return null;
  if (['rate_pct', 'apr_pct'].includes(field)) return pct(value, 2);
  if (field === 'months') return `${value} months`;
  if (field === 'cooling_off_days') return `${value} days`;
  if (field === 'foreclosure') return String(value);
  return inr(value);
};

const number = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : null);
const TRUST_BELOW = 0.8;
const APR_TOLERANCE = 0.25;
const EMI_TOLERANCE = 5;

// `read` is Sarvam's { result, annotations }. Returns what can be used, and what can't.
export function interpretLoanDocument(read, { hash = 'unknown', today = isoDate(Date.now()) } = {}) {
  const fields = read?.result || {};
  const notes = read?.annotations || {};
  const kind = fields.doc_kind || 'other';
  const rows = Object.keys(LABEL).filter((field) => show(field, fields[field]) != null).map((field) => ({
    field, label: LABEL[field], value: show(field, fields[field]),
    confidence: notes[field]?.confidence ?? null, page: notes[field]?.sources?.[0]?.page_num ?? null,
  }));
  const principal = number(fields.principal), ratePct = number(fields.rate_pct), months = number(fields.months);
  const missing = [];
  if (!(principal > 0)) missing.push('Loan amount');
  if (!(ratePct >= 0 && ratePct <= 100)) missing.push('Interest rate');
  if (!(months >= 1 && months <= 600)) missing.push('Term');
  const unsure = rows.filter((row) => row.confidence != null && row.confidence < TRUST_BELOW).map((row) => row.label);
  const base = { kind, rows, missing, unsure, lender: fields.lender || 'the lender', product: fields.product || 'Loan' };
  if (kind !== 'loan_kfs' || missing.length) return { ...base, usable: false };

  const processingFee = number(fields.processing_fee) ?? 0, gstOnFee = number(fields.gst_on_fee) ?? 0, otherCharges = number(fields.other_charges) ?? 0;
  const fees = processingFee + gstOnFee + otherCharges;
  const offer = {
    id: `DOC-${String(hash).slice(0, 8)}`, version: 'uploaded by the customer', lender: base.lender, product: base.product,
    principal, ratePct, rateType: /float/i.test(fields.rate_type || '') ? 'floating' : 'fixed', months, processingFee, gstOnFee, otherCharges,
    coolingOffDays: number(fields.cooling_off_days), foreclosure: fields.foreclosure || null, issuedOn: today, statedApr: number(fields.apr_pct), fromDocument: true,
  };
  const emi = emiFor(principal, ratePct, months);
  const net = principal - fees;
  const computedApr = Number(aprPct(net, emi, months, 12).toFixed(1));
  const checks = [];
  const statedEmi = number(fields.emi), statedNet = number(fields.net_disbursed);
  if (statedEmi != null && Math.abs(statedEmi - emi) > EMI_TOLERANCE) checks.push({ field: 'emi', stated: inr(statedEmi), computed: inr(emi), text: `The EMI on the page is ${inr(statedEmi)}, but these terms give ${inr(emi)}.` });
  if (statedNet != null && statedNet !== net) checks.push({ field: 'net', stated: inr(statedNet), computed: inr(net), text: `The page says ${inr(statedNet)} reaches you, but the charges on it leave ${inr(net)}.` });
  if (offer.statedApr != null && Math.abs(offer.statedApr - computedApr) > APR_TOLERANCE) checks.push({ field: 'apr', stated: pct(offer.statedApr), computed: pct(computedApr), text: `The page states an APR of ${pct(offer.statedApr)}. Counting every charge on it, I get ${pct(computedApr)}.` });
  return { ...base, usable: true, offer, fees, net, emi, computedApr, checks, endsCoolingOff: offer.coolingOffDays ? addDays(today, offer.coolingOffDays) : null };
}

export function readBackLine(doc) {
  if (doc.kind !== 'loan_kfs') return 'I can read loan documents so far, and this looks like something else. A person can help you with it.';
  if (!doc.usable) return `I could not read ${doc.missing.join(', ')} clearly on this page, and I will not guess. Please send a clearer copy, or tell me the numbers.`;
  const charges = doc.fees ? `, with ${inr(doc.fees)} taken out in charges` : '';
  return `I read your document. It says ${inr(doc.offer.principal)} at ${pct(doc.offer.ratePct, 2)} for ${doc.offer.months} months${charges}. Is that right?`;
}
