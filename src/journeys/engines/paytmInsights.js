// Business insights from a merchant's own Paytm data: orders, refunds, settlements and
// payment links, as Paytm's MCP server returns them. Paytm does not publish its
// response schemas, so each field is looked up under the names its APIs use, and the
// profile says which ones it found. Same records, same rupees, same suggestions.
//
// Every rupee here is whole and every percentage has one decimal, the way the replies
// say them, so the figures fence can match a spoken figure to a computed one.
import { explainMerchantOffer, merchantEligibility } from './merchant.js';
import { PACKS } from '../policyPacks.js';
import { inr, pct } from '../money.js';

export const INSIGHTS_PACK = Object.freeze({
  id: 'mitra-paytm-insights-2026',
  label: 'Business insights from Paytm data, 2026',
  asOf: '2026-10-31',
  // MITRA's own thresholds, labelled on screen. None of them is a lender's rule.
  assumptions: Object.freeze({
    lowSuccessPct: 90, highRefundPct: 3, unevenCvPct: 25, momentumPct: 5, concentratedTopTenPct: 40,
    peakShareMinPct: 30, feeShareNotePct: 1.5, fewRepeatPct: 20, fewRepeatMinCustomers: 30,
    sizeBands: Object.freeze([[50000, 'Micro business'], [500000, 'Small business'], [5000000, 'Medium business'], [Infinity, 'Large business']]),
  }),
  sources: Object.freeze(['MITRA defaults, for explanation only']),
});

const IST_MS = 19_800_000;
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── reading Paytm's records ─────────────────────────────────────
export const ALIASES = Object.freeze({
  orderId: ['orderId', 'order_id', 'merchantOrderId', 'mercOrderId'],
  txnId: ['txnId', 'txn_id', 'transactionId', 'bankTxnId'],
  amount: ['txnAmount', 'amount', 'orderAmount', 'payAmount', 'totalAmount', 'txn_amount'],
  date: ['txnDate', 'txnTimestamp', 'orderCreatedTime', 'orderCompletedTime', 'createdTime', 'createdDate', 'createdAt', 'transactionDate', 'orderDate', 'date'],
  status: ['status', 'txnStatus', 'orderStatus', 'orderSearchStatus', 'resultStatus'],
  mode: ['paymentMode', 'payMode', 'payMethod', 'paymentMethod', 'paymentType'],
  customer: ['custId', 'customerId', 'customer_id', 'payerVpa', 'vpa', 'customerMobile', 'maskedCustomerMobile', 'mobileNo', 'email'],
  refundId: ['refundId', 'refId', 'refund_id'],
  refundAmount: ['refundAmount', 'refAmount', 'refund_amount', 'amount', 'txnAmount'],
  refundDate: ['refundDate', 'refundTime', 'acceptRefundTimestamp', 'txnTimestamp', 'createdDate', 'date'],
  settledAmount: ['settledAmount', 'settlementAmount', 'payoutAmount', 'netAmount', 'netSettlementAmount', 'payableAmount', 'settleAmount'],
  grossAmount: ['grossAmount', 'txnAmount', 'transactionAmount', 'totalAmount', 'amount'],
  commission: ['commission', 'commissionAmount', 'mdr', 'mdrAmount', 'pgCommission', 'charges', 'fee', 'fees'],
  gst: ['gst', 'gstAmount', 'serviceTax', 'tax', 'igst'],
  settledDate: ['settledDate', 'settlementDate', 'payoutDate', 'settledOn', 'utrDate', 'creditDate'],
  linkId: ['linkId', 'link_id', 'id'],
  linkAmount: ['amount', 'linkAmount', 'txnAmount'],
  linkStatus: ['linkStatus', 'status', 'isActive'],
  linkCreated: ['createdDate', 'createdAt', 'linkCreatedDate', 'createdOn'],
  linkPaid: ['paidCount', 'successfulTxnCount', 'txnCount', 'paymentCount'],
});

// Case-insensitive, and one level down: Paytm nests `resultInfo.resultStatus` and
// `txnAmount.value`.
function findKey(record, name, depth = 0) {
  if (!record || typeof record !== 'object') return undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(record)) if (key.toLowerCase() === lower && value != null && value !== '') return value;
  if (depth >= 1) return undefined;
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const hit = findKey(value, name, depth + 1);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

function pick(record, field, seen) {
  for (const name of ALIASES[field]) {
    const value = findKey(record, name);
    if (value !== undefined) { seen[field] ||= name; return value; }
  }
  return undefined;
}

export function toAmount(value) {
  if (value && typeof value === 'object') return toAmount(value.value ?? value.amount);
  if (value == null || typeof value === 'boolean') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/INR|Rs\.?|₹|,|\s/gi, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

// A time without a zone is India time, which is what Paytm's dashboards show.
const fromIst = (y, mo, d, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) - IST_MS;
export function toTime(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  const text = String(value).trim();
  if (/^\d{10,13}$/.test(text)) return toTime(Number(text));
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/);
  if (m) return fromIst(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = text.match(/^(\d{2})[-/](\d{2})[-/](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return fromIst(+m[3], +m[2], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toStatus(value) {
  if (value === true) return 'success';
  if (value === false) return 'failed';
  const s = String(value ?? '').toUpperCase();
  if (!s) return 'unknown';
  if (/FAIL|REJECT|CANCEL|DECLIN|ABORT|UNSUCCESS/.test(s)) return 'failed';
  if (/SUCCESS|PAID|SETTLED|COMPLETE|CAPTURED|^S$/.test(s)) return 'success';
  if (/PENDING|PROCESS|INITIAT|OPEN/.test(s)) return 'pending';
  return 'unknown';
}

const MODES = [
  [/UPI/, 'UPI'], [/^CC$|CREDIT/, 'Credit card'], [/^DC$|DEBIT/, 'Debit card'], [/^NB$|NET.?BANK/, 'Net banking'],
  [/POSTPAID|PAY.?LATER/, 'Postpaid'], [/EMI/, 'EMI'], [/PPI|WALLET|BALANCE|PAYTM/, 'Paytm wallet'], [/CARD/, 'Card'],
];
export const toMode = (value) => {
  const s = String(value ?? '').toUpperCase();
  return s ? MODES.find(([re]) => re.test(s))?.[1] || 'Other' : 'Not stated';
};

const noHash = () => null;

// `hashId` turns a payer's id into a pseudonym. Without one, no payer id is kept.
export function normaliseOrders(raw = [], { hashId = noHash } = {}) {
  const seen = {}, byId = new Map();
  let skipped = 0;
  for (const record of raw) {
    const amount = toAmount(pick(record, 'amount', seen));
    const at = toTime(pick(record, 'date', seen));
    if (amount == null || at == null) { skipped += 1; continue; }
    const id = String(pick(record, 'orderId', seen) ?? pick(record, 'txnId', seen) ?? `${at}:${amount}:${byId.size}`);
    const customer = pick(record, 'customer', seen);
    byId.set(id, { id, at, amount, status: toStatus(pick(record, 'status', seen)), mode: toMode(pick(record, 'mode', seen)), customer: customer == null ? null : hashId(String(customer)) });
  }
  return { records: [...byId.values()].sort((a, b) => a.at - b.at), recognised: seen, skipped };
}

export function normaliseRefunds(raw = []) {
  const seen = {}, byId = new Map();
  let skipped = 0;
  for (const record of raw) {
    const amount = toAmount(pick(record, 'refundAmount', seen));
    const at = toTime(pick(record, 'refundDate', seen));
    if (amount == null || at == null) { skipped += 1; continue; }
    const id = String(pick(record, 'refundId', seen) ?? `${at}:${amount}:${byId.size}`);
    byId.set(id, { id, at, amount, status: toStatus(pick(record, 'status', seen)), orderId: pick(record, 'orderId', seen) ?? null });
  }
  return { records: [...byId.values()].sort((a, b) => a.at - b.at), recognised: seen, skipped };
}

export function normaliseSettlements(raw = []) {
  const seen = {}, out = [];
  let skipped = 0;
  for (const record of raw) {
    const net = toAmount(pick(record, 'settledAmount', seen));
    const gross = toAmount(pick(record, 'grossAmount', seen));
    const at = toTime(pick(record, 'settledDate', seen));
    if ((net == null && gross == null) || at == null) { skipped += 1; continue; }
    out.push({ at, net, gross, commission: toAmount(pick(record, 'commission', seen)) || 0, gst: toAmount(pick(record, 'gst', seen)) || 0, orderAt: toTime(pick(record, 'date', seen)) });
  }
  return { records: out.sort((a, b) => a.at - b.at), recognised: seen, skipped };
}

export function normaliseLinks(raw = []) {
  const seen = {}, out = [];
  for (const record of raw) {
    const status = pick(record, 'linkStatus', seen);
    const paid = Number(pick(record, 'linkPaid', seen)) || 0;
    const word = String(status ?? '').toUpperCase();
    const state = paid > 0 || /PAID|SUCCESS/.test(word) ? 'paid' : status === true || /ACTIVE|OPEN|CREATED/.test(word) && !/INACTIVE/.test(word) ? 'active' : status === false || /EXPIRE|INACTIVE|CLOSED|CANCEL/.test(word) ? 'expired' : 'other';
    out.push({ id: String(pick(record, 'linkId', seen) ?? out.length), amount: toAmount(pick(record, 'linkAmount', seen)), state, createdAt: toTime(pick(record, 'linkCreated', seen)) });
  }
  return { records: out, recognised: seen, skipped: 0 };
}

// ── the profile ─────────────────────────────────────────────────
const ist = (ms) => new Date(ms + IST_MS);
const monthKey = (ms) => { const d = ist(ms); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const monthLabel = (key) => `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`;
const nextKey = (key) => { const [y, m] = key.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const hourLabel = (h) => `${h % 12 || 12} ${h < 12 || h === 24 ? 'am' : 'pm'}`;
const round1 = (n) => Math.round(n * 10) / 10;
const share = (part, whole) => (whole ? round1((part / whole) * 100) : 0);
const sum = (list, fn = (x) => x) => list.reduce((total, item) => total + fn(item), 0);
const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
};
const isoDay = (ms) => ist(ms).toISOString().slice(0, 10);

// Sales come from successful orders. Without an order list, from what was settled.
function salesRecords(orders, settlements) {
  if (orders.length) return { basis: 'orders', list: orders.filter((o) => o.status === 'success' || o.status === 'unknown').map((o) => ({ at: o.at, amount: o.amount, mode: o.mode, customer: o.customer })) };
  if (settlements.length) return { basis: 'settlements', list: settlements.map((s) => ({ at: s.orderAt ?? s.at, amount: s.gross ?? s.net, mode: 'Not stated', customer: null })) };
  return { basis: 'none', list: [] };
}

function monthSeries(list, now) {
  const current = monthKey(now);
  const totals = new Map();
  for (const item of list) {
    const key = monthKey(item.at);
    const entry = totals.get(key) || { sales: 0, count: 0 };
    entry.sales += item.amount; entry.count += 1;
    totals.set(key, entry);
  }
  const keys = [...totals.keys()].filter((key) => key < current).sort();
  const months = [];
  // A month with no sales inside the active range is a real zero, not a gap.
  for (let key = keys[0]; key && key < current; key = nextKey(key)) {
    const entry = totals.get(key) || { sales: 0, count: 0 };
    months.push({ key, month: monthLabel(key), sales: Math.round(entry.sales), count: entry.count });
  }
  const now_ = totals.get(current) || { sales: 0, count: 0 };
  return { months, thisMonth: { key: current, month: monthLabel(current), sales: Math.round(now_.sales), count: now_.count, daysSoFar: ist(now).getUTCDate() } };
}

function momentum(months) {
  const values = months.map((m) => m.sales);
  const last = values.at(-1), before = values.at(-2);
  const lastVsPrevPct = values.length >= 2 && before ? round1(((last - before) / before) * 100) : null;
  let decliningStreak = 0;
  for (let i = values.length - 1; i > 0 && values[i] < values[i - 1]; i -= 1) decliningStreak += 1;
  const recent = values.slice(-3), prior = values.slice(-6, -3);
  const threeMonthPct = recent.length === 3 && prior.length === 3 && sum(prior) ? round1(((sum(recent) - sum(prior)) / sum(prior)) * 100) : null;
  const mean = values.length ? sum(values) / values.length : 0;
  const cvPct = values.length >= 3 && mean ? round1((Math.sqrt(sum(values, (v) => (v - mean) ** 2) / values.length) / mean) * 100) : null;
  return { lastVsPrevPct, decliningStreak, threeMonthPct, cvPct };
}

function rhythm(list) {
  const hours = Array(24).fill(0), days = Array(7).fill(0);
  for (const item of list) { const d = ist(item.at); hours[d.getUTCHours()] += item.amount; days[d.getUTCDay()] += item.amount; }
  const total = sum(hours);
  let best = 0;
  for (let h = 1; h < 22; h += 1) if (hours[h] + hours[h + 1] + hours[h + 2] > hours[best] + hours[best + 1] + hours[best + 2]) best = h;
  const order = days.map((value, day) => ({ day: WEEKDAYS[day], sharePct: share(value, total) })).sort((a, b) => b.sharePct - a.sharePct);
  return {
    peak: total ? { from: best, to: best + 3, label: `${hourLabel(best)} to ${hourLabel(best + 3)}`, sharePct: share(hours[best] + hours[best + 1] + hours[best + 2], total) } : null,
    byHour: hours.map((value, hour) => ({ hour, sharePct: share(value, total) })),
    bestDay: order[0] || null, quietestDay: order.at(-1) || null,
  };
}

function customerMix(list) {
  const byCustomer = new Map();
  for (const item of list) {
    if (!item.customer) continue;
    const c = byCustomer.get(item.customer) || { sales: 0, count: 0 };
    c.sales += item.amount; c.count += 1;
    byCustomer.set(item.customer, c);
  }
  if (!byCustomer.size) return null;
  const known = sum([...byCustomer.values()], (c) => c.sales);
  const sorted = [...byCustomer.values()].sort((a, b) => b.sales - a.sales);
  const repeat = sorted.filter((c) => c.count >= 2);
  return { payers: byCustomer.size, repeatPayers: repeat.length, repeatSharePct: share(sum(repeat, (c) => c.sales), known), topTenSharePct: share(sum(sorted.slice(0, 10), (c) => c.sales), known) };
}

export function merchantProfile({ orders = [], refunds = [], settlements = [], links = [] } = {}, { now = Date.now(), name = 'Your business', source = 'Paytm', pulledAt = null } = {}) {
  const sales = salesRecords(orders, settlements);
  const { months, thisMonth } = monthSeries(sales.list, now);
  const amounts = sales.list.map((item) => item.amount);
  const salesTotal = Math.round(sum(amounts));
  const decided = orders.filter((o) => o.status === 'success' || o.status === 'failed');
  const failed = decided.filter((o) => o.status === 'failed');

  const modeTotals = new Map();
  for (const o of orders) {
    const m = modeTotals.get(o.mode) || { mode: o.mode, sales: 0, count: 0, ok: 0, decided: 0 };
    if (o.status === 'success' || o.status === 'unknown') { m.sales += o.amount; m.count += 1; }
    if (o.status === 'success') m.ok += 1;
    if (o.status === 'success' || o.status === 'failed') m.decided += 1;
    modeTotals.set(o.mode, m);
  }
  const counted = sales.list.length;
  const modes = [...modeTotals.values()].filter((m) => m.count || m.decided)
    .map((m) => ({ mode: m.mode, sales: Math.round(m.sales), count: m.count, sharePct: share(m.count, counted), successRatePct: m.decided ? share(m.ok, m.decided) : null, attempts: m.decided }))
    .sort((a, b) => b.sales - a.sales);

  const refunded = refunds.filter((r) => r.status !== 'failed');
  const refundTotal = Math.round(sum(refunded, (r) => r.amount));
  const gross = Math.round(sum(settlements, (s) => s.gross ?? s.net ?? 0));
  const fees = Math.round(sum(settlements, (s) => s.commission + s.gst));
  const lags = settlements.filter((s) => s.orderAt && s.at >= s.orderAt).map((s) => (s.at - s.orderAt) / DAY_MS);
  const activeLinks = links.filter((l) => l.state === 'active');
  const first = sales.list[0]?.at ?? null, last = sales.list.at(-1)?.at ?? null;
  const average = months.length ? Math.round(sum(months, (m) => m.sales) / months.length) : 0;
  const lowest = months.length ? months.reduce((low, m) => (m.sales < low.sales ? m : low)) : null;
  const best = months.length ? months.reduce((top, m) => (m.sales > top.sales ? m : top)) : null;

  return {
    name, source, pulledAt, basis: sales.basis,
    coverage: { from: first ? isoDay(first) : null, to: last ? isoDay(last) : null, monthCount: months.length, orders: orders.length, refunds: refunds.length, settlements: settlements.length, links: links.length },
    months, thisMonth, averageMonthly: average, lowestMonth: lowest, bestMonth: best,
    salesTotal, payments: counted, averageTicket: counted ? Math.round(salesTotal / counted) : 0, medianTicket: median(amounts),
    successRatePct: decided.length ? share(decided.length - failed.length, decided.length) : null, attempts: decided.length, failedAttempts: failed.length, failedValue: Math.round(sum(failed, (o) => o.amount)),
    modes, ...momentum(months), rhythm: rhythm(sales.list), customers: customerMix(sales.list),
    refunds: { count: refunded.length, total: refundTotal, ratePct: salesTotal ? share(refundTotal, salesTotal) : null },
    settlements: settlements.length ? { count: settlements.length, gross, net: Math.round(sum(settlements, (s) => s.net ?? 0)), fees, feeSharePct: gross ? round1((fees / gross) * 100) : null, averageLagDays: lags.length ? round1(sum(lags) / lags.length) : null } : null,
    links: links.length ? { total: links.length, paid: links.filter((l) => l.state === 'paid').length, active: activeLinks.length, expired: links.filter((l) => l.state === 'expired').length, activeValue: Math.round(sum(activeLinks, (l) => l.amount || 0)) } : null,
  };
}

// ── who this merchant is, in a few words ────────────────────────
export function profileSegments(profile) {
  const a = INSIGHTS_PACK.assumptions;
  const out = [];
  if (profile.months.length) out.push({ id: 'size', label: a.sizeBands.find(([limit]) => profile.averageMonthly < limit)[1], why: `${inr(profile.averageMonthly)} average monthly sales` });
  const trend = profile.threeMonthPct ?? profile.lastVsPrevPct;
  if (trend != null) out.push({ id: 'momentum', label: trend >= a.momentumPct ? 'Growing' : trend <= -a.momentumPct ? 'Slowing' : 'Steady', why: `${trend >= 0 ? 'up' : 'down'} ${pct(Math.abs(trend))} ${profile.threeMonthPct != null ? 'over the last three months' : 'on the month before'}` });
  if (profile.cvPct != null) out.push({ id: 'rhythm', label: profile.cvPct >= a.unevenCvPct ? 'Uneven months' : 'Even months', why: `monthly sales vary by ${pct(profile.cvPct)}` });
  const top = profile.modes[0];
  if (top && top.mode !== 'Not stated' && top.sharePct >= 60) out.push({ id: 'payments', label: `${top.mode}-first`, why: `${pct(top.sharePct)} of payments by ${top.mode}` });
  if (profile.customers) out.push({ id: 'customers', label: profile.customers.repeatSharePct >= 50 ? 'Loyal regulars' : 'Mostly one-time payers', why: `${pct(profile.customers.repeatSharePct)} of sales from repeat payers` });
  if (profile.rhythm.peak) out.push({ id: 'peak', label: `Busiest ${profile.rhythm.peak.label}`, why: `${pct(profile.rhythm.peak.sharePct)} of sales` });
  return out;
}

// ── what is worth doing next ────────────────────────────────────
// Each suggestion states the figures it rests on and, where MITRA can help, the words
// that start that journey. Nothing here says "borrow" or "don't": it says what is so.
export function suggestions(profile, { offer = null } = {}) {
  const a = INSIGHTS_PACK.assumptions;
  const minMonths = PACKS.merchant.assumptions.minActiveMonths;
  const out = [];
  const add = (item) => out.push(item);

  if (profile.successRatePct != null && profile.successRatePct < a.lowSuccessPct) {
    const worst = profile.modes.filter((m) => m.attempts >= 10 && m.successRatePct != null).sort((x, y) => x.successRatePct - y.successRatePct)[0];
    add({ id: 'failed_payments', priority: 1, tone: 'warn', title: 'Payments are failing at the counter',
      body: `${profile.failedAttempts} of ${profile.attempts} payment attempts failed, worth ${inr(profile.failedValue)}. ${worst ? `${worst.mode} did worst: ${pct(worst.successRatePct)} went through. ` : ''}A customer whose payment fails often walks away. Check the QR, the network at the counter, and which payment options are switched on.`,
      paytm: 'fetch_payment_options' });
  }
  if (profile.refunds.ratePct != null && profile.refunds.ratePct >= a.highRefundPct) {
    add({ id: 'refunds', priority: 1, tone: 'warn', title: 'Refunds are high',
      body: `You refunded ${inr(profile.refunds.total)}, ${pct(profile.refunds.ratePct)} of sales, over ${profile.refunds.count} refunds. Look for one product, one staff member or one payer behind most of them.` });
  }
  if (profile.decliningStreak >= 2) {
    add({ id: 'declining', priority: 1, tone: 'warn', title: `Sales fell ${profile.decliningStreak} months in a row`,
      body: `From ${profile.months.at(-1 - profile.decliningStreak).month} to ${profile.months.at(-1).month}, sales went from ${inr(profile.months.at(-1 - profile.decliningStreak).sales)} to ${inr(profile.months.at(-1).sales)}. Any repayment taken on now would come out of the slower months.` });
  }

  if (profile.months.length >= minMonths) {
    const eligibility = merchantEligibility({ name: profile.name, source: profile.source, months: profile.months.slice(-minMonths).map(({ month, sales }) => ({ month, sales })) });
    const fit = offer ? explainMerchantOffer(offer, eligibility) : null;
    add({ id: 'working_capital', priority: 2, tone: 'info', title: 'Your sales can back a working capital check',
      body: `${minMonths} months of sales average ${inr(eligibility.averageMonthly)}, so a lender may look at up to ${inr(eligibility.limit)}. Your weakest of those months was ${inr(eligibility.lowestMonth)}.${fit ? ` The sample offer asks ${inr(fit.dailyRepayment)} a day, ${pct(fit.shareOfDailySales)} of your usual day${fit.fits ? '' : ', which is more than MITRA’s comfortable share'}.` : ''} MITRA explains the offer; the lender decides.`,
      ask: 'I need money for stock for my shop', eligibility, fit: fit ? { dailyRepayment: fit.dailyRepayment, shareOfDailySales: fit.shareOfDailySales, fits: fit.fits } : null });
  } else if (profile.months.length) {
    add({ id: 'working_capital_wait', priority: 3, tone: 'info', title: 'Not enough months for a working capital check yet',
      body: `Paytm shows ${profile.months.length} full months of sales. A check needs ${minMonths}, so ${minMonths - profile.months.length} more.` });
  }

  if (profile.links?.active && profile.links.activeValue > 0) {
    add({ id: 'unpaid_links', priority: 2, tone: 'info', title: 'Payment links still waiting',
      body: `${profile.links.active} payment links worth ${inr(profile.links.activeValue)} are open and unpaid. A short reminder to each payer often closes them.`, paytm: 'fetch_payment_links' });
  }
  if (profile.cvPct != null && profile.cvPct >= a.unevenCvPct && profile.lowestMonth && profile.bestMonth) {
    add({ id: 'uneven', priority: 2, tone: 'info', title: 'Keep a buffer for slow months',
      body: `Your best month, ${profile.bestMonth.month}, brought ${inr(profile.bestMonth.sales)}. Your slowest, ${profile.lowestMonth.month}, brought ${inr(profile.lowestMonth.sales)}. Any fixed payment you take on should fit the slow month, not the average.` });
  }
  if (profile.customers && profile.customers.topTenSharePct >= a.concentratedTopTenPct && profile.customers.payers > 10) {
    add({ id: 'concentration', priority: 2, tone: 'info', title: 'A few payers carry the shop',
      body: `Your top 10 payers brought ${pct(profile.customers.topTenSharePct)} of sales. Losing one of them would show. Credit to any of them is worth tracking.` });
  }
  if (profile.customers && profile.customers.repeatSharePct < a.fewRepeatPct && profile.customers.payers >= a.fewRepeatMinCustomers) {
    add({ id: 'repeat', priority: 3, tone: 'info', title: 'Most payers come once',
      body: `Only ${pct(profile.customers.repeatSharePct)} of sales came from payers who came back. A reason to return, like a loyalty stamp or a small discount on the next visit, may help.` });
  }
  if (profile.rhythm.peak && profile.rhythm.peak.sharePct >= a.peakShareMinPct) {
    add({ id: 'peak', priority: 3, tone: 'ok', title: `Your rush is ${profile.rhythm.peak.label}`,
      body: `${pct(profile.rhythm.peak.sharePct)} of sales come then.${profile.rhythm.quietestDay ? ` ${profile.rhythm.quietestDay.day} is your quietest day, at ${pct(profile.rhythm.quietestDay.sharePct)} of sales.` : ''} Keep the Soundbox charged and stock full before the rush.` });
  }
  if (profile.settlements?.feeSharePct != null && profile.settlements.feeSharePct >= a.feeShareNotePct) {
    add({ id: 'fees', priority: 3, tone: 'info', title: 'What payments cost you',
      body: `Charges came to ${inr(profile.settlements.fees)}, ${pct(profile.settlements.feeSharePct)} of what was settled. Worth checking your pricing plan with Paytm.` });
  }
  const trend = profile.threeMonthPct ?? profile.lastVsPrevPct;
  if (trend != null && trend >= a.momentumPct && profile.decliningStreak < 2) {
    add({ id: 'growing', priority: 3, tone: 'ok', title: 'Sales are growing',
      body: `Up ${pct(trend)} ${profile.threeMonthPct != null ? 'over the last three months, against the three before' : 'on the month before'}.` });
  }
  return out.sort((x, y) => x.priority - y.priority);
}

// Everything a call or a screen needs, in one place.
export function merchantInsights(data, options = {}) {
  const profile = merchantProfile(data, options);
  return { profile, segments: profileSegments(profile), suggestions: suggestions(profile, options), pack: { id: INSIGHTS_PACK.id, label: INSIGHTS_PACK.label, asOf: INSIGHTS_PACK.asOf } };
}

// The sales summary the merchant agent reads, in the shape of MERCHANT_SALES.
export const salesSummaryFrom = (profile) => (profile.months.length ? {
  merchantId: 'paytm', name: profile.name, source: `${profile.source}${profile.pulledAt ? `, pulled ${String(profile.pulledAt).slice(0, 10)}` : ''}`,
  months: profile.months.map(({ month, sales }) => ({ month, sales })), live: true,
} : null);
