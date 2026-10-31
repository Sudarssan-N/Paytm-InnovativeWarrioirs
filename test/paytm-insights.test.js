// The insights engine: Paytm's records in whatever shape they come, read into one
// profile, and suggestions that state only what the records show.
import test from 'node:test';
import assert from 'node:assert/strict';
import { merchantInsights, merchantProfile, normaliseLinks, normaliseOrders, normaliseRefunds, normaliseSettlements, suggestions, toTime } from '../src/journeys/engines/paytmInsights.js';
import { merchantEligibility } from '../src/journeys/engines/merchant.js';
import { MERCHANT_OFFER, MERCHANT_SALES } from '../src/journeys/sampleData.js';
import { samplePaytmRecords, SAMPLE_PAYTM_NOW } from '../src/journeys/samplePaytm.js';
import { assertGrounded } from '../src/journeys/money.js';
import { routeByRules } from '../src/journeys/router.js';
import { createSession, takeTurn } from '../src/journeys/orchestrator.js';

const NOW = Date.parse('2026-10-31T10:00:00Z');
const at = (iso) => Date.parse(`${iso}+05:30`);
const order = (date, amount, extra = {}) => ({ orderId: `O${date}${amount}${Math.random()}`, txnAmount: String(amount), txnDate: date, status: 'TXN_SUCCESS', paymentMode: 'UPI', ...extra });
const say = (session, text) => takeTurn(session, { text, textEn: text, lang: 'en' }, { now: NOW, modelOff: true });

function sampleData() {
  const raw = samplePaytmRecords();
  return {
    orders: normaliseOrders(raw.orders, { hashId: (id) => `h${id.length}${id.slice(-3)}` }).records,
    refunds: normaliseRefunds(raw.refunds).records, settlements: normaliseSettlements(raw.settlements).records, links: normaliseLinks(raw.links).records,
  };
}

test('Paytm records are read under every name and shape its APIs use', () => {
  const { records, recognised, skipped } = normaliseOrders([
    { ORDERID: 'A', TXNAMOUNT: '1,250.50', TXNDATE: '2026-10-02 19:30:00.0', STATUS: 'TXN_SUCCESS', PAYMENTMODE: 'DC' },
    { orderId: 'B', txnAmount: { value: '99.00', currency: 'INR' }, orderCreatedTime: '02-10-2026 08:15:00', resultInfo: { resultStatus: 'TXN_FAILURE' }, payMode: 'UPI' },
    { mercOrderId: 'C', amount: 300, createdTime: 1791000000000, orderStatus: 'PENDING', paymentMethod: 'PPI' },
    { orderId: 'D', txnAmount: 'not a number', txnDate: '2026-10-02' },
  ]);
  const byId = Object.fromEntries(records.map((r) => [r.id, [r.amount, r.status, r.mode]]));
  assert.deepEqual(byId, { A: [1250.5, 'success', 'Debit card'], B: [99, 'failed', 'UPI'], C: [300, 'pending', 'Paytm wallet'] });
  assert.equal(skipped, 1, 'an amount that is not a number is skipped, not guessed');
  assert.equal(recognised.amount, 'txnAmount');
  assert.equal(toTime('2026-10-02 19:30:00.0'), at('2026-10-02T19:30:00'), 'a time without a zone is India time');
  assert.equal(toTime('02-10-2026'), at('2026-10-02T00:00:00'));
  assert.equal(toTime(1791000000), 1791000000000, 'seconds become milliseconds');
});

test('a payer id is never kept as it came', () => {
  const plain = normaliseOrders([order('2026-10-01 10:00:00', 100, { custId: '9876543210' })]).records[0];
  assert.equal(plain.customer, null);
  const hashed = normaliseOrders([order('2026-10-01 10:00:00', 100, { custId: '9876543210' })], { hashId: () => 'pseudonym' }).records[0];
  assert.equal(hashed.customer, 'pseudonym');
});

test('the sample adds up to Lakshmi’s sales summary, so the call and the screen agree', () => {
  const { profile } = merchantInsights(sampleData(), { now: SAMPLE_PAYTM_NOW, name: 'Lakshmi Stores', offer: MERCHANT_OFFER });
  assert.deepEqual(profile.months.map(({ month, sales }) => ({ month, sales })), MERCHANT_SALES.months);
  assert.equal(profile.averageMonthly, merchantEligibility(MERCHANT_SALES).averageMonthly);
  assert.equal(profile.basis, 'orders');
  assert.ok(profile.successRatePct > 90 && profile.successRatePct < 100);
  assert.equal(profile.links.active, 2);
  assert.equal(profile.links.activeValue, 11000);
  assert.equal(profile.settlements.averageLagDays, 1);
});

test('the month in progress is shown but never counted, and a quiet month is a real zero', () => {
  const orders = normaliseOrders([order('2026-07-10 10:00:00', 5000), order('2026-09-10 10:00:00', 7000), order('2026-10-05 10:00:00', 999)]).records;
  const p = merchantProfile({ orders }, { now: NOW });
  assert.deepEqual(p.months.map((m) => [m.month, m.sales]), [['Jul 2026', 5000], ['Aug 2026', 0], ['Sep 2026', 7000]]);
  assert.equal(p.thisMonth.sales, 999);
});

test('failing payments, high refunds and a falling streak each raise a warning', () => {
  const raw = [];
  [['2026-06', 90000], ['2026-07', 80000], ['2026-08', 70000], ['2026-09', 60000]].forEach(([month, sales]) => {
    for (let i = 0; i < 20; i += 1) raw.push(order(`${month}-${String(i + 1).padStart(2, '0')} 11:00:00`, sales / 20));
    for (let i = 0; i < 4; i += 1) raw.push(order(`${month}-0${i + 1} 12:00:00`, 500, { status: 'TXN_FAILURE', paymentMode: 'CC' }));
  });
  const orders = normaliseOrders(raw).records;
  const refunds = normaliseRefunds([{ refundId: 'R1', refundAmount: '15000', refundDate: '2026-09-20', status: 'SUCCESS' }]).records;
  const list = suggestions(merchantProfile({ orders, refunds }, { now: NOW }));
  const ids = list.map((s) => s.id);
  assert.ok(ids.includes('failed_payments') && ids.includes('refunds') && ids.includes('declining'), ids.join());
  assert.ok(list.filter((s) => s.priority === 1).every((s) => s.tone === 'warn'));
  assert.ok(ids.includes('working_capital_wait'), 'four months is not enough for a working capital check');
  assert.ok(!ids.includes('working_capital'));
});

test('every suggestion states only figures the profile computed', () => {
  const insights = merchantInsights(sampleData(), { now: SAMPLE_PAYTM_NOW, name: 'Lakshmi Stores', offer: MERCHANT_OFFER });
  for (const s of insights.suggestions) assert.ok(assertGrounded(s.body, insights).ok, `${s.id}: ${assertGrounded(s.body, insights).invented}`);
  const capital = insights.suggestions.find((s) => s.id === 'working_capital');
  assert.equal(capital.eligibility.limit, merchantEligibility(MERCHANT_SALES).limit);
});

test('advice about the shop routes to insights; money for the shop stays a loan question', () => {
  assert.equal(routeByRules('How is my business doing?').name, 'merchant_insights');
  assert.equal(routeByRules('Any tips to improve my shop?').name, 'merchant_insights');
  assert.equal(routeByRules('I need money for stock for my shop').name, 'merchant_eligibility');
  assert.equal(routeByRules('I need a loan to improve my shop').name, 'merchant_eligibility');
  assert.equal(routeByRules('How much did I sell this month?').name, 'merchant_sales_summary');
});

test('on a call, insights ask for their own consent and every spoken figure is grounded', async () => {
  const session = createSession({ id: 'jrn-insights', customerId: 'lakshmi', now: NOW });
  const insights = merchantInsights(sampleData(), { now: SAMPLE_PAYTM_NOW, name: 'Lakshmi Stores', offer: MERCHANT_OFFER });
  session.paytm = { live: false, source: insights.profile.source, pulledAt: null, sales: null, insights: { ...insights, sample: true } };
  const asked = await say(session, 'How is my business doing?');
  assert.equal(asked.card.type, 'ask');
  assert.equal(asked.card.data.purpose, 'business_insights');
  const r = await say(session, 'Yes, go ahead');
  assert.equal(r.tool, 'merchant_insights');
  assert.equal(r.card.type, 'insights');
  assert.ok(!r.blocked, r.reply);
  assert.match(r.reply, /₹3,09,017/);
  assert.equal(r.passport.consent[0].purpose, 'business_insights');
  // Working capital is a different purpose, so it asks again rather than reusing this yes.
  const loan = await say(session, 'I need money for stock for my shop');
  assert.equal(loan.card.data.purpose, 'merchant_credit');
});

test('live sales replace the sample, and a shop short of six months is told so', async () => {
  const session = createSession({ id: 'jrn-live', customerId: 'lakshmi', now: NOW });
  session.paytm = { live: true, source: 'Paytm', sales: { name: 'Lakshmi Stores', source: 'Paytm, pulled 2026-10-31', live: true, months: [{ month: 'Aug 2026', sales: 120000 }, { month: 'Sep 2026', sales: 150000 }] }, insights: null };
  const sold = await say(session, 'How much did I sell this month?');
  assert.match(sold.reply, /₹1,50,000/);
  await say(session, 'I need money for stock for my shop');
  const r = await say(session, 'Yes, go ahead');
  assert.equal(r.tool, 'merchant_eligibility');
  assert.match(r.reply, /2 months/);
  assert.ok(!r.card || r.card.type !== 'merchant', 'no offer is shown without enough months');
});
