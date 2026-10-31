// Synthetic income papers for the Loan Clarity demo: a delivery rider and a kirana
// shop. Nothing here is a real person, bank, platform or return. The sample files in
// public/samples are printed from these rows by scripts/make-income-samples.mjs, so
// the tests and the files the demo uploads say the same thing.

const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const day = (month, d) => `${month}-${String(d).padStart(2, '0')}`;

function withBalance(rows, opening) {
  let balance = opening;
  return rows.sort((a, b) => a.date.localeCompare(b.date) || (b.credit || 0) - (a.credit || 0)).map((row) => {
    balance += (row.credit || 0) - (row.debit || 0);
    return { date: row.date, description: row.description, credit: row.credit || 0, debit: row.debit || 0, balance };
  });
}

// ── Ramesh K., food delivery and bike taxi, Chennai ─────────────
const RIDER_WEEKLY = [
  [9850, 10420, 9310, 10980], [8120, 7640, 9050, 8410], [7480, 8020, 7210, 8870, 6950],
  [10210, 9880, 11040, 10650], [10840, 11260, 10390, 11720], [11480, 12050, 10930, 11640],
];
const RIDER_TAXI = [4200, 3100, 3900, 5200, 5600, 6100];
const RIDER_CASH = [2500, 0, 3000, 2000, 2500, 3000];
const RIDER_FUEL = [[940, 1120, 860], [780, 910, 1040], [990, 870, 1150], [1080, 960, 1210], [1130, 1020, 990], [1190, 1240, 1060]];

function riderRows() {
  const rows = [];
  MONTHS.forEach((month, m) => {
    RIDER_WEEKLY[m].forEach((amount, w) => rows.push({ date: day(month, [4, 11, 18, 25, 30][w]), description: `NEFT CR ZIPEATS PARTNER PAYOUTS WK${19 + m * 4 + w}`, credit: amount }));
    rows.push({ date: day(month, 27), description: 'IMPS CR QUICKRIDE DRIVER EARNINGS', credit: RIDER_TAXI[m] });
    if (RIDER_CASH[m]) rows.push({ date: day(month, 15), description: 'CASH DEPOSIT CDM ANNA NAGAR', credit: RIDER_CASH[m] });
    rows.push({ date: day(month, 3), description: 'UPI DR RENT TO S MURUGAN', debit: 6000 });
    rows.push({ date: day(month, 5), description: 'ACH DR TWO WHEELER LOAN EMI SAMPLE AUTO FIN', debit: 3200 });
    RIDER_FUEL[m].forEach((amount, f) => rows.push({ date: day(month, [8, 17, 26][f]), description: 'UPI DR SAMPLE FUELS', debit: amount }));
    rows.push({ date: day(month, 20), description: 'UPI DR MOBILE RECHARGE', debit: 299 });
    rows.push({ date: day(month, 22), description: 'UPI DR GROCERIES K MART', debit: 4200 + m * 150 });
  });
  rows.push({ date: '2026-06-21', description: 'IMPS CR SELF TRANSFER RAMESH K SAVINGS', credit: 15000 });
  rows.push({ date: '2026-08-09', description: 'UPI CR REFUND ZIPEATS ORDER CANCEL', credit: 450 });
  return withBalance(rows, 8640);
}

// ── Lakshmi Stores, kirana, Madurai ─────────────────────────────
// UPI matches the Soundbox summary the merchant journey already uses.
const KIRANA_UPI = [285400, 302150, 276900, 318600, 341250, 329800];
const KIRANA_CASH = [60000, 58000, 54000, 62000, 66000, 74000];
const UPI_SPLIT = [0.24, 0.26, 0.23];
const SUPPLY_SPLIT = [0.45, 0.35];
const round100 = (value) => Math.round(value / 100) * 100;

function kiranaRows() {
  const rows = [];
  MONTHS.forEach((month, m) => {
    const weekly = UPI_SPLIT.map((share) => round100(KIRANA_UPI[m] * share));
    weekly.push(KIRANA_UPI[m] - weekly.reduce((a, b) => a + b, 0));
    weekly.forEach((amount, w) => rows.push({ date: day(month, [7, 14, 21, 28][w]), description: 'UPI SETTLEMENT SOUNDBOX LAKSHMI STORES', credit: amount }));
    [8, 15, 22, 29].forEach((d) => rows.push({ date: day(month, d), description: 'CASH DEPOSIT BRANCH MADURAI EAST', credit: KIRANA_CASH[m] / 4 }));
    const supplies = round100((KIRANA_UPI[m] + KIRANA_CASH[m]) * 0.79);
    const parts = SUPPLY_SPLIT.map((share) => round100(supplies * share));
    parts.push(supplies - parts[0] - parts[1]);
    rows.push({ date: day(month, 10), description: 'NEFT DR SRI MURUGAN WHOLESALE TRADERS', debit: parts[0] });
    rows.push({ date: day(month, 20), description: 'RTGS DR MADURAI DISTRIBUTORS', debit: parts[1] });
    rows.push({ date: day(month, 25), description: 'UPI DR ARUN AGENCIES STOCK', debit: parts[2] });
    rows.push({ date: day(month, 2), description: 'UPI DR SHOP RENT TO K RAJAN', debit: 15000 });
    rows.push({ date: day(month, 12), description: 'UPI DR TNEB ELECTRICITY', debit: 2600 + m * 120 });
  });
  return withBalance(rows, 42300);
}

export const INCOME_SAMPLES = Object.freeze({
  rider: Object.freeze({
    id: 'rider', holder: 'Ramesh K.', work: 'Food delivery and bike taxi, Chennai',
    statement: Object.freeze({
      file: 'sample-rider-statement.pdf', bank: 'Sample Co-operative Bank', account: 'XXXXXX4821', from: '2026-05-01', to: '2026-10-31', opening: 8640,
      rows: Object.freeze(riderRows()),
    }),
    receipts: Object.freeze([
      Object.freeze({ file: 'sample-rider-receipt-payout.png', app: 'Sample UPI', payer: 'ZIPEATS PARTNER PAYOUTS', payee: 'Ramesh K.', amount: 11640, date: '2026-10-25', reference: '629841173320' }),
      Object.freeze({ file: 'sample-rider-receipt-kumar.png', app: 'Sample UPI', payer: 'S KUMAR', payee: 'Ramesh K. (XXXXXX9902, another bank)', amount: 1500, date: '2026-10-30', reference: '630115529047' }),
    ]),
    tax: Object.freeze({ file: 'sample-rider-itr.pdf', form: 'ITR-4 (Sugam)', kind: 'income', assessmentYear: '2026-27', financialYear: '2025-26', grossIncome: 468000, label: 'income tax return' }),
  }),
  kirana: Object.freeze({
    id: 'kirana', holder: 'Lakshmi Stores', work: 'Kirana shop, Madurai',
    statement: Object.freeze({
      file: 'sample-kirana-statement.pdf', bank: 'Sample Co-operative Bank', account: 'XXXXXX7310', from: '2026-05-01', to: '2026-10-31', opening: 42300,
      rows: Object.freeze(kiranaRows()),
    }),
    receipts: Object.freeze([]),
    tax: Object.freeze({ file: 'sample-kirana-gst.pdf', form: 'GSTR-4 annual return', kind: 'turnover', financialYear: '2025-26', turnover: 2880000, label: 'GST return' }),
  }),
});
