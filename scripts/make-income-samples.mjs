// Prints the synthetic income papers in src/journeys/sampleIncome.js as the PDFs and
// screenshots the demo uploads: bank statements, UPI receipts and tax return summaries.
// Uses headless Chrome. Run: node scripts/make-income-samples.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { INCOME_SAMPLES } from '../src/journeys/sampleIncome.js';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve('public/samples');
const work = mkdtempSync(path.join(tmpdir(), 'mitra-samples-'));

const money = (n) => (n ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const ddmmyyyy = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const longDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; color: #1b2433; margin: 0; }
  .sample { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 90px; font-weight: 700; color: rgba(200, 30, 30, 0.07); transform: rotate(-25deg); }
  .note { font-size: 10px; color: #8a93a3; margin-top: 18px; }
`;

function statementHtml(sample) {
  const s = sample.statement;
  const rows = s.rows.map((row) => `<tr><td>${ddmmyyyy(row.date)}</td><td>${row.description}</td><td class="n">${money(row.debit)}</td><td class="n">${money(row.credit)}</td><td class="n">${money(row.balance)}</td></tr>`).join('');
  const credits = s.rows.reduce((total, row) => total + row.credit, 0);
  const debits = s.rows.reduce((total, row) => total + row.debit, 0);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    @page { size: A4; margin: 16mm 14mm; }
    header { display: flex; justify-content: space-between; border-bottom: 2px solid #0b3d6e; padding-bottom: 8px; }
    h1 { font-size: 18px; margin: 0; color: #0b3d6e; } h2 { font-size: 13px; margin: 14px 0 6px; }
    .meta { font-size: 11px; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th { background: #e8eef6; text-align: left; padding: 5px; border-bottom: 1px solid #b8c4d6; }
    td { padding: 4px 5px; border-bottom: 1px solid #edf0f4; } .n { text-align: right; white-space: nowrap; }
    .totals td { font-weight: 700; border-top: 1px solid #1b2433; border-bottom: 0; padding-top: 8px; }
  </style></head><body><div class="sample">SAMPLE</div>
  <header><div><h1>${s.bank}</h1><div class="meta">Statement of account</div></div>
  <div class="meta">Account holder: <b>${sample.holder}</b><br>Account number: ${s.account}<br>Period: ${ddmmyyyy(s.from)} to ${ddmmyyyy(s.to)}<br>Opening balance: ${money(s.opening)}</div></header>
  <h2>Transactions</h2>
  <table><thead><tr><th>Date</th><th>Narration</th><th class="n">Withdrawal (Dr)</th><th class="n">Deposit (Cr)</th><th class="n">Balance</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <table class="totals"><tr><td>Totals for the period</td><td class="n">Withdrawals ${money(debits)}</td><td class="n">Deposits ${money(credits)}</td><td class="n">Closing balance ${money(s.rows.at(-1).balance)}</td></tr></table>
  <p class="note">Synthetic sample made for a hackathon demo. Not a real bank, account or person.</p></body></html>`;
}

function taxHtml(sample) {
  const t = sample.tax;
  const isGst = t.kind === 'turnover';
  const rows = isGst
    ? [['Form', t.form], ['GSTIN', '33ABCDE1234F1Z5'], ['Legal name', sample.holder], ['Financial year', t.financialYear], ['Aggregate turnover', rupees(t.turnover)], ['Composition tax paid', rupees(Math.round(t.turnover * 0.01))], ['Status', 'Filed']]
    : [['Form', t.form], ['PAN', 'ABCPK1234X'], ['Name', sample.holder], ['Assessment year', t.assessmentYear], ['Financial year', t.financialYear], ['Nature of business', 'Delivery and transport services (presumptive, section 44AD)'], ['Gross total income', rupees(t.grossIncome)], ['Deductions under Chapter VI-A', rupees(0)], ['Total income', rupees(t.grossIncome)], ['Tax payable', rupees(0)], ['Status', 'Filed and verified']];
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    @page { size: A4; margin: 22mm 20mm; }
    h1 { font-size: 17px; margin: 0 0 4px; } p.sub { font-size: 11px; color: #5a6475; margin: 0 0 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    td { padding: 8px 10px; border: 1px solid #c9d1dd; } td:first-child { width: 42%; background: #f3f6fa; font-weight: 600; }
  </style></head><body><div class="sample">SAMPLE</div>
  <h1>${isGst ? 'GST annual return summary' : 'Income tax return summary'}</h1>
  <p class="sub">${t.form}. Summary of the return as filed.</p>
  <table>${rows.map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`).join('')}</table>
  <p class="note">Synthetic sample made for a hackathon demo. Not a real return, PAN, GSTIN or person.</p></body></html>`;
}

function receiptHtml(receipt) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    body { background: #f2f5fa; padding: 24px 22px; }
    .card { background: #fff; border-radius: 18px; padding: 26px 22px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,.06); }
    .tick { width: 54px; height: 54px; border-radius: 50%; background: #0a8a5c; color: #fff; font-size: 30px; line-height: 54px; margin: 0 auto 12px; }
    .label { color: #5a6475; font-size: 14px; } .amount { font-size: 38px; font-weight: 800; margin: 6px 0 18px; }
    dl { text-align: left; font-size: 13.5px; margin: 0; } dt { color: #7a8494; margin-top: 12px; } dd { margin: 2px 0 0; font-weight: 600; }
    .app { margin-top: 18px; font-size: 12px; color: #7a8494; }
  </style></head><body><div class="card"><div class="tick">✓</div>
  <div class="label">Payment received</div><div class="amount">${rupees(receipt.amount)}</div>
  <dl><dt>From</dt><dd>${receipt.payer}</dd><dt>To</dt><dd>${receipt.payee}</dd><dt>Date</dt><dd>${longDate(receipt.date)}</dd><dt>UPI reference number</dt><dd>${receipt.reference}</dd></dl>
  <div class="app">${receipt.app} · synthetic sample for a demo</div></div></body></html>`;
}

function print(html, name, { screenshot = false } = {}) {
  const source = path.join(work, `${name}.html`);
  writeFileSync(source, html);
  const target = path.join(OUT, name);
  const args = screenshot
    ? ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=440,500', `--screenshot=${target}`, `file://${source}`]
    : ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${target}`, `file://${source}`];
  execFileSync(CHROME, args, { stdio: 'ignore' });
  console.log(`wrote public/samples/${name}`);
}

for (const sample of Object.values(INCOME_SAMPLES)) {
  print(statementHtml(sample), sample.statement.file);
  print(taxHtml(sample), sample.tax.file);
  for (const receipt of sample.receipts) print(receiptHtml(receipt), receipt.file, { screenshot: true });
}
