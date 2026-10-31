// Synthetic Paytm records for Lakshmi Stores, shaped the way Paytm's MCP tools answer:
// string amounts, India-time dates, TXN_SUCCESS and payment mode codes. Nothing here
// is a real shop or payer. Each month's successful orders add up to the same figure
// as MERCHANT_SALES, so every screen and call agrees on Lakshmi's sales.
import { MERCHANT_SALES } from './sampleData.js';

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
// A morning rush for milk and bread, an evening one after work.
const HOUR_WEIGHTS = [0, 0, 0, 0, 0, 0, 1, 4, 7, 6, 4, 3, 3, 3, 2, 2, 3, 5, 8, 9, 7, 4, 1, 0];
const MODES = [['UPI', 82], ['DC', 7], ['PPI', 6], ['CC', 5]];
const pad = (n) => String(n).padStart(2, '0');

// Seeded, so the sample is the same on every machine and every run.
function random(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const weighted = (rand, pairs) => { let r = rand() * pairs.reduce((total, [, w]) => total + w, 0); for (const [value, w] of pairs) { r -= w; if (r < 0) return value; } return pairs.at(-1)[0]; };

// The first moment after the last sample month, so every month counts as complete.
export const SAMPLE_PAYTM_NOW = Date.UTC(2026, 10, 1) - 19_800_000;

export function samplePaytmRecords() {
  const rand = random(2207);
  const hours = HOUR_WEIGHTS.map((w, h) => [h, w]);
  // A few regulars buy most days; most payers come once or twice.
  const payers = Array.from({ length: 2500 }, (_, i) => [`CUST${String(i + 1).padStart(4, '0')}`, i < 40 ? 30 : i < 200 ? 4 : 1]);
  const orders = [], settlements = [];
  let seq = 0;
  for (const { month, sales } of MERCHANT_SALES.months) {
    const [name, year] = month.split(' ');
    const m = MONTHS[name], y = Number(year), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const target = sales;
    const made = [];
    let total = 0;
    while (total < target - 600) {
      const amount = Math.min(Math.round(40 + rand() * rand() * 900), target - total);
      const day = 1 + Math.floor(rand() * days), hour = weighted(rand, hours);
      made.push({ amount, day, hour, minute: Math.floor(rand() * 60) });
      total += amount;
    }
    // The last order closes the month to the rupee.
    if (target > total) made.push({ amount: target - total, day: days, hour: 19, minute: 41 });
    const daily = new Map();
    for (const o of made) {
      const mode = weighted(rand, MODES);
      const id = `LKS${y}${pad(m)}${String(++seq).padStart(6, '0')}`;
      const txnDate = `${y}-${pad(m)}-${pad(o.day)} ${pad(o.hour)}:${pad(o.minute)}:${pad(Math.floor(rand() * 60))}.0`;
      orders.push({ orderId: id, txnId: `2026${String(seq).padStart(12, '0')}`, txnAmount: o.amount.toFixed(2), txnDate, status: 'TXN_SUCCESS', paymentMode: mode, custId: weighted(rand, payers), merchantName: MERCHANT_SALES.name });
      // About one try in sixteen fails first, more often on cards, and the payer retries.
      if (rand() < (mode === 'UPI' ? 0.05 : 0.12)) orders.push({ orderId: `${id}F`, txnAmount: o.amount.toFixed(2), txnDate, status: 'TXN_FAILURE', paymentMode: mode, custId: null });
      const fee = mode === 'CC' ? o.amount * 0.018 : mode === 'DC' ? o.amount * 0.004 : 0;
      const entry = daily.get(o.day) || { gross: 0, commission: 0 };
      entry.gross += o.amount; entry.commission += fee;
      daily.set(o.day, entry);
    }
    for (const [day, entry] of daily) {
      const commission = Math.round(entry.commission * 100) / 100, gst = Math.round(commission * 18) / 100;
      const settled = new Date(Date.UTC(y, m - 1, day + 1));
      settlements.push({ settledDate: settled.toISOString().slice(0, 10), txnDate: `${y}-${pad(m)}-${pad(day)}`, grossAmount: entry.gross.toFixed(2), commission: commission.toFixed(2), gst: gst.toFixed(2), settledAmount: (entry.gross - commission - gst).toFixed(2) });
    }
  }
  const success = orders.filter((o) => o.status === 'TXN_SUCCESS');
  const refunds = Array.from({ length: 14 }, (_, i) => {
    const o = success[Math.floor(rand() * success.length)];
    return { refundId: `RF${String(i + 1).padStart(5, '0')}`, orderId: o.orderId, refundAmount: o.txnAmount, refundDate: o.txnDate, status: 'TXN_SUCCESS' };
  });
  const links = [
    { linkId: 'LNK1001', linkName: 'Hotel Annapoorna, weekly milk', amount: 4200, status: 'ACTIVE', createdDate: '2026-10-21' },
    { linkId: 'LNK1002', linkName: 'Temple festival order', amount: 6800, status: 'ACTIVE', createdDate: '2026-10-25' },
    { linkId: 'LNK0998', linkName: 'Hotel Annapoorna, weekly milk', amount: 4200, status: 'PAID', createdDate: '2026-10-14' },
    { linkId: 'LNK0991', linkName: 'School canteen', amount: 2650, status: 'EXPIRED', createdDate: '2026-09-02' },
  ];
  return { orders, refunds, settlements, links, merchantName: MERCHANT_SALES.name };
}
