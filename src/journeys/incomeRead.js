// What Sarvam Vision read from a customer's income papers: a bank statement, a UPI
// receipt or a tax return. Every row is normalised and shown back to the customer,
// who can untick or correct it. Only what they confirm reaches the income engine.
import { classifyCredit, incomeProfile, mergeReceipts, STREAM_LABELS } from './engines/income.js';
import { inr } from './money.js';

export const INCOME_DOCUMENT_SCHEMA = {
  type: 'object',
  properties: {
    doc_kind: { type: 'string', enum: ['bank_statement', 'payment_receipt', 'income_tax_return', 'gst_return', 'other'], description: 'What kind of document this is' },
    holder: { type: 'string', description: 'Name of the account holder, payee or taxpayer' },
    issuer: { type: 'string', description: 'Bank, payment app or tax form name' },
    period_from: { type: 'string', description: 'First date the statement covers, as written' },
    period_to: { type: 'string', description: 'Last date the statement covers, as written' },
    opening_balance: { type: 'number', description: 'Opening balance of the statement in rupees, negative if overdrawn' },
    closing_balance: { type: 'number', description: 'Closing balance of the statement in rupees, negative if overdrawn' },
    transactions: {
      type: 'array',
      description: 'Every transaction line on a bank statement, in order. Leave empty for other documents',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Transaction date, as written' },
          description: { type: 'string', description: 'Narration or particulars, as written' },
          debit: { type: 'number', description: 'Withdrawal amount in rupees, or 0' },
          credit: { type: 'number', description: 'Deposit amount in rupees, or 0' },
          balance: { type: 'number', description: 'Running balance after this line in rupees, negative if overdrawn' },
        },
      },
    },
    receipt_amount: { type: 'number', description: 'For a payment receipt: the amount received in rupees' },
    receipt_date: { type: 'string', description: 'For a payment receipt: the date of payment, as written' },
    receipt_from: { type: 'string', description: 'For a payment receipt: who paid' },
    receipt_reference: { type: 'string', description: 'For a payment receipt: the UPI reference or transaction id' },
    assessment_year: { type: 'string', description: 'For an income tax return: the assessment year' },
    financial_year: { type: 'string', description: 'For a tax or GST return: the financial year' },
    gross_total_income: { type: 'number', description: 'For an income tax return: gross total income in rupees' },
    aggregate_turnover: { type: 'number', description: 'For a GST return: aggregate turnover for the year in rupees' },
  },
};

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const fullYear = (y) => (String(y).length === 2 ? 2000 + Number(y) : Number(y));

// Indian statements write day first: 04-05-2026, 04/05/26, 4 May 2026, 2026-05-04.
export function parseStatementDate(text) {
  const value = String(text || '').trim().toLowerCase();
  let m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = value.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})\b/);
  if (m) return valid(fullYear(m[3]), Number(m[2]), Number(m[1]));
  const month = (word) => MON[word.slice(0, 4)] ?? MON[word.slice(0, 3)];
  m = value.match(/^(\d{1,2})[-/ ]?([a-z]{3,9})[-/ ,]*(\d{2,4})\b/);
  if (m && month(m[2])) return valid(fullYear(m[3]), month(m[2]), Number(m[1]));
  m = value.match(/^([a-z]{3,9})[ -](\d{1,2}),?[ -](\d{2,4})\b/);
  if (m && month(m[1])) return valid(fullYear(m[3]), month(m[1]), Number(m[2]));
  return null;
}
function valid(year, month, day) {
  if (!(year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

// A running balance can be overdrawn: "1,200.00 Dr" or -1200 is minus 1,200. Unreadable is null.
export function parseBalance(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  const text = String(value ?? '').trim();
  if (!text) return null;
  const n = Number(text.replace(/[₹,\s]|rs\.?|inr|cr|dr/gi, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round((/dr\b/i.test(text) ? -Math.abs(n) : n) * 100) / 100;
}

// "₹1,02,443.00", "1,02,443.00 Cr", "-" → a number of rupees, or 0.
export function parseRupees(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
  const cleaned = String(value ?? '').replace(/[₹,\s]|rs\.?|inr|cr|dr/gi, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

const KIND_LABEL = { bank_statement: 'Bank statement', payment_receipt: 'Payment receipt', income_tax_return: 'Income tax return', gst_return: 'GST return', other: 'Not an income document' };
const MAX_AMOUNT = 100_000_000;

// `read` is Sarvam's { result, annotations }. One document in, one normalised document out.
export function interpretIncomeDocument(read, { hash = 'unknown', name = 'document' } = {}) {
  const fields = read?.result || {};
  const kind = KIND_LABEL[fields.doc_kind] ? fields.doc_kind : 'other';
  const base = { kind, kindLabel: KIND_LABEL[kind], hash, name: String(name).slice(0, 80), holder: fields.holder || null, issuer: fields.issuer || null, transactions: [], receipts: [], declared: [], problems: [] };

  if (kind === 'bank_statement') {
    const rows = Array.isArray(fields.transactions) ? fields.transactions : [];
    let unreadable = 0;
    const transactions = [];
    // `line` is the row's place on the page, so a check never compares two rows that had an unread one between them.
    rows.forEach((row, line) => {
      const date = parseStatementDate(row?.date);
      const credit = parseRupees(row?.credit), debit = parseRupees(row?.debit);
      if (!date || (!credit && !debit) || credit > MAX_AMOUNT || debit > MAX_AMOUNT) { unreadable += 1; return; }
      const description = String(row.description || '').slice(0, 120);
      transactions.push({ date, description, credit, debit, balance: parseBalance(row?.balance), line, stream: credit ? classifyCredit(description) : null, include: true });
    });
    if (unreadable) base.problems.push(`${unreadable} lines could not be read and are left out.`);
    if (!transactions.length) base.problems.push('No transactions could be read on this statement.');
    const period = { from: parseStatementDate(fields.period_from), to: parseStatementDate(fields.period_to) };
    const balances = { opening: parseBalance(fields.opening_balance), closing: parseBalance(fields.closing_balance) };
    return { ...base, transactions, period, balances, unreadable, usable: transactions.length > 0 };
  }
  if (kind === 'payment_receipt') {
    const amount = parseRupees(fields.receipt_amount), date = parseStatementDate(fields.receipt_date);
    if (!amount || !date || amount > MAX_AMOUNT) return { ...base, problems: ['The amount or date on this receipt could not be read.'], usable: false };
    const description = `UPI receipt from ${String(fields.receipt_from || 'someone').slice(0, 80)}`;
    return { ...base, receipts: [{ date, description, credit: amount, debit: 0, reference: fields.receipt_reference || null, stream: classifyCredit(description), include: true }], usable: true };
  }
  if (kind === 'income_tax_return' || kind === 'gst_return') {
    const annual = parseRupees(kind === 'gst_return' ? fields.aggregate_turnover : fields.gross_total_income);
    if (!annual) return { ...base, problems: [`The ${kind === 'gst_return' ? 'turnover' : 'income'} on this return could not be read.`], usable: false };
    const year = fields.assessment_year ? `AY ${fields.assessment_year}` : fields.financial_year ? `FY ${fields.financial_year}` : '';
    return {
      ...base, years: { assessment: fields.assessment_year || null, financial: fields.financial_year || null },
      declared: [{ kind: kind === 'gst_return' ? 'turnover' : 'income', annual, label: kind === 'gst_return' ? 'GST return' : 'income tax return', source: `${KIND_LABEL[kind]}${year ? `, ${year}` : ''}` }],
      usable: true,
    };
  }
  return { ...base, problems: ['This does not look like a bank statement, receipt or tax return.'], usable: false };
}

// The customer's corrections: untick a row, or fix an amount MITRA misread.
// `edits`: [{ doc, row, include, amount }]. Amounts are their own words, so they are bounded, not trusted blindly.
export function applyEdits(docs, edits = []) {
  const copy = docs.map((doc) => ({ ...doc, transactions: doc.transactions.map((row) => ({ ...row })), receipts: doc.receipts.map((row) => ({ ...row })) }));
  let changed = 0;
  for (const edit of Array.isArray(edits) ? edits.slice(0, 500) : []) {
    const doc = copy[Number(edit?.doc)];
    const list = doc?.kind === 'payment_receipt' ? doc.receipts : doc?.transactions;
    const row = list?.[Number(edit?.row)];
    if (!row) continue;
    if (typeof edit.include === 'boolean' && edit.include !== row.include) { row.include = edit.include; changed += 1; }
    const amount = Number(edit.amount);
    if (edit.amount != null && Number.isFinite(amount) && amount > 0 && amount <= MAX_AMOUNT) {
      const field = row.credit ? 'credit' : 'debit';
      if (row[field] !== amount) { row[field] = Math.round(amount * 100) / 100; row.edited = true; changed += 1; }
    }
  }
  return { docs: copy, changed };
}

// Everything confirmed, in one profile. Receipts already on a statement count once.
export function profileFromDocuments(docs) {
  const used = docs.filter((doc) => doc.usable);
  const statements = used.filter((doc) => doc.kind === 'bank_statement');
  const transactions = statements.flatMap((doc) => doc.transactions.filter((row) => row.include));
  const receipts = used.flatMap((doc) => doc.receipts.filter((row) => row.include));
  const periods = statements.map((doc) => doc.period).filter((period) => period?.from && period?.to);
  const period = periods.length ? { from: periods.map((p) => p.from).sort()[0], to: periods.map((p) => p.to).sort().at(-1) } : {};
  const merged = transactions.length ? mergeReceipts(transactions, receipts, period) : { transactions: receipts, added: receipts, duplicates: [], outside: [] };
  const declared = used.flatMap((doc) => doc.declared);
  const profile = incomeProfile({ transactions: merged.transactions, declared });
  return {
    ...profile,
    documents: used.map((doc) => ({ kind: doc.kind, kindLabel: doc.kindLabel, name: doc.name, hash: doc.hash })),
    receipts: { added: merged.added.length, duplicates: merged.duplicates.length, outside: merged.outside.length },
  };
}

// Spoken after reading, before anything is used.
export function incomeReadBackLine(docs) {
  const used = docs.filter((doc) => doc.usable);
  if (!used.length) return 'I could not read income from these papers, and I will not guess. Please send a clearer copy of a bank statement, a payment receipt or a tax return, or tell me your monthly income.';
  const parts = used.map((doc) => {
    if (doc.kind === 'bank_statement') {
      const credits = doc.transactions.filter((row) => row.credit).length;
      return `a bank statement with ${credits} money-in lines`;
    }
    if (doc.kind === 'payment_receipt') return `a receipt for ${inr(doc.receipts[0].credit)}`;
    return `your ${doc.declared[0].label}, showing ${inr(doc.declared[0].annual)} for the year`;
  });
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  const skipped = docs.length - used.length;
  return `I read ${list}.${skipped ? ` ${skipped} file could not be used.` : ''} Please check the lines on screen, untick anything that is not your earning, and confirm.`;
}

export { STREAM_LABELS };
