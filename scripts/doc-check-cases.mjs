// The document check's evaluation set. Every case starts from a real sample paper in
// public/samples, as Sarvam would read it, then either leaves it alone (it must come
// out clean) or changes it the way a forger, a stale upload or a mix-up would.
// Used by test/doc-check.test.js and scripts/eval-doc-check.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileForensics } from '../server/documentForensics.mjs';
import { checkIncomeDocuments, checkLoanDocument } from '../src/journeys/engines/docCheck.js';
import { interpretIncomeDocument } from '../src/journeys/incomeRead.js';
import { INCOME_SAMPLES } from '../src/journeys/sampleIncome.js';

export const TODAY = '2026-10-31';
const SAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples');
const file = (name) => readFileSync(path.join(SAMPLES, name));
const ddmmyyyy = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const shiftDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// ── files, changed the way an editor changes them ───────────────
// An incremental save: a new Info dictionary and a second end marker, as any PDF
// editor writes when it saves over a file.
const resaved = (buffer, producer, modDate = "D:20261031120000+05'30'") => Buffer.concat([buffer, Buffer.from(`\n99 0 obj\n<< /Producer (${producer}) /ModDate (${modDate}) >>\nendobj\nstartxref\n0\n%%EOF\n`, 'latin1')]);
const madeWith = (buffer, producer) => Buffer.from(buffer.toString('latin1').replace(/\/Producer \([^)]*\)/, `/Producer (${producer})`), 'latin1');
// A signature whose byte range covers the whole file, as a bank's signing server writes.
function signed(buffer) {
  const sig = Buffer.from('\n1 0 obj << /Type /Sig /ByteRange [0 0000000000 0000000000 0000000000] /Contents <00> >> endobj\n', 'latin1');
  const body = Buffer.concat([buffer, sig]);
  const hole = body.indexOf('<00>', buffer.length);
  const range = `[0 ${String(hole).padStart(10, '0')} ${String(hole + 4).padStart(10, '0')} ${String(body.length - hole - 4).padStart(10, '0')}]`;
  return Buffer.from(body.toString('latin1').replace(/\[0 0000000000 0000000000 0000000000\]/, range), 'latin1');
}
// A PNG text chunk naming the program that saved it, as Photoshop and others write.
function pngWithSoftware(buffer, software) {
  const data = Buffer.from(`Software\0${software}`, 'latin1');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write('tEXt', 4, 'latin1');
  data.copy(chunk, 8);
  return Buffer.concat([buffer.subarray(0, 33), chunk, buffer.subarray(33)]);
}

// ── what Sarvam reads, then changed ─────────────────────────────
function statementRead(sample, change = (rows) => rows, { shift = 0, holder } = {}) {
  const s = sample.statement;
  const rows = change(s.rows.map((row) => ({ ...row })));
  const closing = s.rows.at(-1).balance;
  return { result: {
    doc_kind: 'bank_statement', holder: holder ?? sample.holder, issuer: s.bank, period_from: ddmmyyyy(shiftDays(s.from, shift)), period_to: ddmmyyyy(shiftDays(s.to, shift)),
    opening_balance: s.opening, closing_balance: closing,
    transactions: rows.map((row) => ({ date: ddmmyyyy(row.date), description: row.description, debit: row.debit, credit: row.credit, balance: row.balance })),
  } };
}
const receiptRead = (receipt, patch = {}) => ({ result: { doc_kind: 'payment_receipt', holder: receipt.payee, issuer: receipt.app, receipt_amount: receipt.amount, receipt_date: ddmmyyyy(receipt.date), receipt_from: receipt.payer, receipt_reference: receipt.reference, ...patch } });
const returnRead = (sample, patch = {}) => ({ result: { doc_kind: 'income_tax_return', holder: sample.holder, issuer: sample.tax.form, assessment_year: sample.tax.assessmentYear, financial_year: sample.tax.financialYear, gross_total_income: sample.tax.grossIncome, ...patch } });

const rider = INCOME_SAMPLES.rider, kirana = INCOME_SAMPLES.kirana;

// One income upload: files and what was read from each. Returns each paper's check.
function income(papers, { holderName = rider.holder } = {}) {
  const forensics = {};
  const docs = papers.map(({ buffer, mime = 'application/pdf', read, name }, index) => {
    const hash = `case-${index}-${buffer.length}`;
    forensics[hash] = fileForensics(buffer, { mime });
    return interpretIncomeDocument(read, { hash, name });
  });
  return checkIncomeDocuments(docs, { forensics, today: TODAY, holderName });
}
const statementPdf = file('sample-rider-statement.pdf');
const one = (paper, options) => income([paper], options)[0];

const kfsFields = { doc_kind: 'loan_kfs', lender: 'Sample Lender', principal: 200000, rate_pct: 14, months: 24, issue_date: '28-10-2026', valid_until: '25-11-2026', borrower: 'Ramesh K.' };
const kfs = (buffer, patch = {}) => checkLoanDocument({ ...kfsFields, ...patch }, { forensics: fileForensics(buffer, { mime: 'application/pdf' }), today: TODAY, holderName: 'Ramesh K.' });

// expected: the verdict, and for anything but clean, a flag id that must be among the reasons.
export const CASES = [
  // Genuine papers must pass. A false alarm costs the customer as much as a miss.
  { id: 'genuine-rider-statement', group: 'genuine', expect: 'clean', run: () => one({ buffer: statementPdf, read: statementRead(rider), name: 'statement.pdf' }) },
  { id: 'genuine-kirana-statement', group: 'genuine', expect: 'clean', run: () => one({ buffer: file('sample-kirana-statement.pdf'), read: statementRead(kirana), name: 'statement.pdf' }, { holderName: kirana.holder }) },
  { id: 'genuine-rider-itr', group: 'genuine', expect: 'clean', run: () => one({ buffer: file('sample-rider-itr.pdf'), read: returnRead(rider), name: 'itr.pdf' }) },
  { id: 'genuine-receipt', group: 'genuine', expect: 'clean', run: () => one({ buffer: file('sample-rider-receipt-payout.png'), mime: 'image/png', read: receiptRead(rider.receipts[0]), name: 'receipt.png' }) },
  { id: 'genuine-all-rider-papers', group: 'genuine', expect: 'clean', run: () => {
    const checks = income([
      { buffer: statementPdf, read: statementRead(rider), name: 'statement.pdf' },
      { buffer: file('sample-rider-receipt-payout.png'), mime: 'image/png', read: receiptRead(rider.receipts[0]), name: 'r1.png' },
      { buffer: file('sample-rider-receipt-kumar.png'), mime: 'image/png', read: receiptRead(rider.receipts[1]), name: 'r2.png' },
      { buffer: file('sample-rider-itr.pdf'), read: returnRead(rider), name: 'itr.pdf' },
    ]);
    return checks.find((check) => check.verdict !== 'clean') || checks[0];
  } },
  { id: 'genuine-signed-statement', group: 'genuine', expect: 'clean', run: () => one({ buffer: signed(statementPdf), read: statementRead(rider), name: 'statement.pdf' }) },
  { id: 'genuine-kfs', group: 'genuine', expect: 'clean', run: () => kfs(file('sample-kfs.pdf')) },

  // Edited files.
  { id: 'statement-resaved-in-photoshop', group: 'edited', expect: 'suspect', flag: 'editor', run: () => one({ buffer: resaved(statementPdf, 'Adobe Photoshop 25.0'), read: statementRead(rider), name: 'statement.pdf' }) },
  { id: 'statement-resaved-in-ilovepdf', group: 'edited', expect: 'suspect', flag: 'editor', run: () => one({ buffer: resaved(statementPdf, 'iLovePDF'), read: statementRead(rider), name: 'statement.pdf' }) },
  { id: 'statement-made-in-word', group: 'edited', expect: 'caution', flag: 'office', run: () => one({ buffer: madeWith(statementPdf, 'Microsoft® Word for Microsoft 365'), read: statementRead(rider), name: 'statement.pdf' }) },
  { id: 'statement-saved-again', group: 'edited', expect: 'caution', flag: 'saved_again', run: () => one({ buffer: resaved(statementPdf, 'Skia/PDF m156'), read: statementRead(rider), name: 'statement.pdf' }) },
  { id: 'statement-changed-after-signing', group: 'edited', expect: 'suspect', flag: 'changed_after_signing', run: () => one({ buffer: Buffer.concat([signed(statementPdf), Buffer.from('\n%%EOF\n')]), read: statementRead(rider), name: 'statement.pdf' }) },
  { id: 'receipt-saved-in-photoshop', group: 'edited', expect: 'suspect', flag: 'editor', run: () => one({ buffer: pngWithSoftware(file('sample-rider-receipt-payout.png'), 'Adobe Photoshop 25.0 (Macintosh)'), mime: 'image/png', read: receiptRead(rider.receipts[0]), name: 'receipt.png' }) },

  // Figures that do not add up.
  { id: 'statement-one-amount-raised', group: 'inconsistent', expect: 'caution', flag: 'balance', run: () => one({ buffer: statementPdf, read: statementRead(rider, (rows) => { const row = rows.find((item) => item.credit > 5000); row.credit += 20000; return rows; }), name: 'statement.pdf' }) },
  { id: 'statement-three-amounts-raised', group: 'inconsistent', expect: 'suspect', flag: 'balance', run: () => one({ buffer: statementPdf, read: statementRead(rider, (rows) => { rows.filter((item) => item.credit > 5000).slice(0, 3).forEach((row) => { row.credit *= 2; }); return rows; }), name: 'statement.pdf' }) },
  { id: 'statement-dated-after-today', group: 'inconsistent', expect: 'suspect', flag: 'future', run: () => one({ buffer: statementPdf, read: statementRead(rider, (rows) => rows.map((row) => ({ ...row, date: shiftDays(row.date, 40) })), { shift: 40 }), name: 'statement.pdf' }) },
  { id: 'receipt-reference-reused', group: 'inconsistent', expect: 'suspect', flag: 'reused_reference', run: () => income([
    { buffer: file('sample-rider-receipt-payout.png'), mime: 'image/png', read: receiptRead(rider.receipts[0]), name: 'r1.png' },
    { buffer: file('sample-rider-receipt-kumar.png'), mime: 'image/png', read: receiptRead(rider.receipts[1], { receipt_reference: rider.receipts[0].reference }), name: 'r2.png' },
  ])[1] },
  { id: 'itr-far-above-bank-income', group: 'inconsistent', expect: 'caution', flag: 'return_vs_bank', run: () => income([
    { buffer: statementPdf, read: statementRead(rider), name: 'statement.pdf' },
    { buffer: file('sample-rider-itr.pdf'), read: returnRead(rider, { gross_total_income: 4_800_000 }), name: 'itr.pdf' },
  ])[1] },

  // Out of date.
  { id: 'statement-ends-four-months-ago', group: 'expired', expect: 'expired', flag: 'stale', run: () => one({ buffer: statementPdf, read: statementRead(rider, (rows) => rows.map((row) => ({ ...row, date: shiftDays(row.date, -120) })), { shift: -120 }), name: 'statement.pdf' }) },
  { id: 'itr-three-years-old', group: 'expired', expect: 'expired', flag: 'old_year', run: () => one({ buffer: file('sample-rider-itr.pdf'), read: returnRead(rider, { assessment_year: '2023-24', financial_year: '2022-23' }), name: 'itr.pdf' }) },
  { id: 'kfs-lapsed', group: 'expired', expect: 'expired', flag: 'lapsed', run: () => kfs(file('sample-kfs.pdf'), { valid_until: '15-10-2026' }) },

  // Someone else's paper.
  { id: 'statement-in-another-name', group: 'identity', expect: 'caution', flag: 'name', run: () => one({ buffer: statementPdf, read: statementRead(rider, undefined, { holder: 'SURESH BABU' }), name: 'statement.pdf' }) },
  { id: 'kfs-for-another-borrower', group: 'identity', expect: 'caution', flag: 'name', run: () => kfs(file('sample-kfs.pdf'), { borrower: 'Priya Natarajan' }) },
  // Not a false alarm: an initial for a surname is the same person.
  { id: 'statement-name-with-full-surname', group: 'genuine', expect: 'clean', run: () => one({ buffer: statementPdf, read: statementRead(rider, undefined, { holder: 'RAMESH KUMAR' }), name: 'statement.pdf' }) },
];

export function runCases() {
  return CASES.map((item) => {
    const check = item.run();
    const flagged = check.flags.map((flagItem) => flagItem.id);
    const pass = check.verdict === item.expect && (!item.flag || flagged.includes(item.flag));
    return { id: item.id, group: item.group, expect: item.expect, got: check.verdict, flags: flagged, pass, headline: check.headline };
  });
}
