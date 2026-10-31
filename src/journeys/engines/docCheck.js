// Document checks: does an uploaded paper look like what it claims to be, and is it
// recent enough to use? Two kinds of evidence go in. The file's own details (which
// program made it, whether it was changed after it was made or signed) come from
// server/documentForensics.mjs. The figures on it (does the running balance add up,
// are the dates possible, is it the customer's name) come from what Sarvam read.
//
// MITRA cannot prove a paper is genuine: only the bank or the tax portal can. So the
// best verdict is "no warning signs found", never "verified", and a warning never
// blocks anything. It tells the customer a lender may reject the paper, and that
// anything worked out from it may not be accurate.
import { addDays, daysBetween, fmtDate, inr } from '../money.js';
import { parseStatementDate } from '../incomeRead.js';

export const DOC_CHECK_PACK = Object.freeze({
  id: 'mitra-doc-check-2026',
  label: 'Document checks, 2026',
  asOf: '2026-10-31',
  // MITRA's own thresholds, labelled on screen. A lender's rules may be stricter.
  assumptions: Object.freeze({
    statementFreshDays: 45, statementMinDays: 85, balanceToleranceRupees: 1, balanceMismatchesHigh: 3,
    returnYearsBack: 1, declaredVsBankRatio: 3, outOfOrderShare: 0.05, kfsOldDays: 60, editedAfterSeconds: 60,
  }),
  sources: Object.freeze(['MITRA defaults, for explanation only']),
});

export const CATEGORY = Object.freeze({
  edited: 'Signs of editing', inconsistent: 'Does not add up', expired: 'Out of date', identity: 'May not be yours', quality: 'Hard to verify',
});
const RANK = { high: 3, medium: 2, low: 1 };
const flag = (id, category, severity, text) => ({ id, category, label: CATEGORY[category], severity, text });
const A = DOC_CHECK_PACK.assumptions;

// ── the file itself ─────────────────────────────────────────────
// `f` is what documentForensics found. Official papers come from a bank's or the tax
// portal's system, or are printed from a browser; they are not made in an editor.
export function fileFlags(f, { kind = 'other' } = {}) {
  const flags = [], passed = [];
  if (!f) return { flags, passed };
  const official = ['bank_statement', 'income_tax_return', 'gst_return', 'loan_kfs'].includes(kind);
  if (f.mismatch) flags.push(flag('wrong_type', 'quality', 'medium', `The file says it is a ${f.claimed}, but its contents are a ${f.formatLabel}.`));
  if (f.editor) flags.push(flag('editor', 'edited', 'high', `The file was made or saved with ${f.editor}, an editing program. Bank and tax papers are not made that way.`));
  else if (f.office && official) flags.push(flag('office', 'edited', 'medium', `The file was made with ${f.office}. A bank or the tax portal does not make its papers in an office program.`));
  if (f.signed) {
    if (f.signed.coversWhole) passed.push('Digitally signed, and not changed since it was signed. MITRA cannot check who signed it.');
    else flags.push(flag('changed_after_signing', 'edited', 'high', 'The file was changed after it was digitally signed.'));
  } else {
    if (f.created && f.modified && (Date.parse(f.modified) - Date.parse(f.created)) / 1000 > A.editedAfterSeconds) {
      const sameDay = f.modified.slice(0, 10) === f.created.slice(0, 10);
      flags.push(flag('modified_later', 'edited', 'medium', sameDay ? `The file was changed after it was first made, later on ${fmtDate(f.created)}.` : `The file was changed on ${fmtDate(f.modified)}, after it was first made on ${fmtDate(f.created)}.`));
    }
    if (f.saves > 1) flags.push(flag('saved_again', 'edited', 'medium', `The file was saved ${f.saves} times. A paper straight from a bank is saved once.`));
  }
  if (f.format === 'pdf' && !f.editor && !f.office && (f.producer || f.creator)) passed.push(`Made by ${f.producer || f.creator}, not an editing program.`);
  if (f.format === 'image' && !f.editor) passed.push('No editing program named in the image’s details.');
  if (f.format === 'image' && official) flags.push(flag('photo', 'quality', 'low', 'This is a photo or screenshot. A lender can check the PDF from the bank or tax portal more easily.'));
  return { flags, passed };
}

// ── what is written on it ───────────────────────────────────────
const after = (date, today, days = 1) => date && date > addDays(today, days);

export function statementFlags(doc, { today }) {
  const flags = [], passed = [];
  const rows = doc.transactions || [];
  const dates = rows.map((row) => row.date).filter(Boolean);
  if (!dates.length) return { flags, passed };
  const first = [...dates].sort()[0], last = [...dates].sort().at(-1);
  const end = doc.period?.to || last, start = doc.period?.from || first;

  if (after(last, today) || after(doc.period?.to, today)) flags.push(flag('future', 'inconsistent', 'high', `It has dates after today, up to ${fmtDate(after(last, today) ? last : doc.period.to)}.`));
  const age = daysBetween(end, today);
  if (age > A.statementFreshDays) flags.push(flag('stale', 'expired', 'medium', `It ends on ${fmtDate(end)}, ${age} days ago. Lenders usually want a statement that runs to within the last month or so.`));
  else if (age >= 0) passed.push(`Runs to ${fmtDate(end)}, which is recent.`);
  const span = daysBetween(start, end);
  if (span < A.statementMinDays) flags.push(flag('short', 'quality', 'low', `It covers ${span + 1} days. Lenders usually ask for six months.`));

  if (doc.period?.from && doc.period?.to) {
    const outside = rows.filter((row) => row.date < addDays(doc.period.from, -1) || row.date > addDays(doc.period.to, 1)).length;
    if (outside) flags.push(flag('outside_period', 'inconsistent', 'medium', `${outside} ${outside === 1 ? 'line is' : 'lines are'} dated outside the period the statement says it covers.`));
  }

  // Statements list oldest or newest first. Lines against that order are out of place.
  let up = 0, down = 0;
  for (let i = 1; i < rows.length; i += 1) { if (rows[i].date > rows[i - 1].date) up += 1; else if (rows[i].date < rows[i - 1].date) down += 1; }
  const against = Math.min(up, down);
  if (against > Math.max(2, rows.length * A.outOfOrderShare)) flags.push(flag('order', 'inconsistent', 'medium', `${against} lines are out of date order.`));

  // The running balance. Each line must move it by exactly its own amount.
  const ordered = down > up ? [...rows].reverse() : rows;
  let checked = 0;
  const wrong = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1], row = ordered[i];
    if (prev.balance == null || row.balance == null || Math.abs(row.line - prev.line) !== 1) continue;
    checked += 1;
    if (Math.abs(prev.balance + row.credit - row.debit - row.balance) > A.balanceToleranceRupees) wrong.push(row);
  }
  if (checked >= 3) {
    if (wrong.length >= A.balanceMismatchesHigh) flags.push(flag('balance', 'inconsistent', 'high', `${wrong.length} lines do not add up with the running balance, for example ${fmtDate(wrong[0].date)}. That is a common sign of a changed statement.`));
    else if (wrong.length) flags.push(flag('balance', 'inconsistent', 'medium', `${wrong.length === 1 ? 'One line does' : `${wrong.length} lines do`} not add up with the running balance, on ${fmtDate(wrong[0].date)}. It may be a misread, or an edit.`));
    else passed.push(`The running balance adds up on all ${checked} lines MITRA could check.`);
  }
  const { opening, closing } = doc.balances || {};
  if (opening != null && closing != null && !doc.unreadable) {
    const moved = rows.reduce((total, row) => total + row.credit - row.debit, 0);
    if (Math.abs(opening + moved - closing) > A.balanceToleranceRupees) flags.push(flag('totals', 'inconsistent', 'medium', `Opening balance ${inr(opening)} plus every line comes to ${inr(opening + moved)}, but the statement closes at ${inr(closing)}.`));
    else passed.push('Opening balance plus every line comes to the closing balance.');
  }
  return { flags, passed };
}

export function receiptFlags(doc, { today }) {
  const flags = [], passed = [];
  const receipt = doc.receipts?.[0];
  if (!receipt) return { flags, passed };
  if (after(receipt.date, today)) flags.push(flag('future', 'inconsistent', 'high', `It is dated ${fmtDate(receipt.date)}, after today.`));
  if (receipt.reference && !/^\d{12}$/.test(String(receipt.reference).replace(/\s/g, ''))) flags.push(flag('reference', 'inconsistent', 'low', `Its reference, ${receipt.reference}, is not the 12-digit number a UPI payment has.`));
  else if (receipt.reference) passed.push('Has a 12-digit UPI reference, which a lender can trace.');
  return { flags, passed };
}

// "2026-27", "AY 2026-2027" → 2026. A financial year 2025-26 is assessed in 2026.
const yearStart = (text) => { const m = String(text || '').match(/(20\d{2})/); return m ? Number(m[1]) : null; };
export function returnFlags(doc, { today }) {
  const flags = [], passed = [];
  const assessed = yearStart(doc.years?.assessment) ?? (yearStart(doc.years?.financial) != null ? yearStart(doc.years.financial) + 1 : null);
  if (assessed == null) return { flags, passed };
  // The latest return anyone can have filed is for the year that ended last March.
  const [y, m] = today.split('-').map(Number);
  const latest = m >= 4 ? y : y - 1;
  const label = `AY ${assessed}-${String(assessed + 1).slice(2)}`;
  if (assessed > latest) flags.push(flag('future_year', 'inconsistent', 'high', `It is for ${label}, a year that cannot have been filed yet.`));
  else if (assessed < latest - A.returnYearsBack) flags.push(flag('old_year', 'expired', 'medium', `It is for ${label}. Lenders usually want the return for the last year or two.`));
  else passed.push(`It is for ${label}, a recent year.`);
  return { flags, passed };
}

export function loanFlags(fields, { today }) {
  const flags = [], passed = [];
  const issued = parseStatementDate(fields?.issue_date), until = parseStatementDate(fields?.valid_until);
  if (until && until < today) flags.push(flag('lapsed', 'expired', 'high', `It says the offer was valid until ${fmtDate(until)}. It has lapsed, and the lender’s new terms may differ.`));
  else if (until) passed.push(`Valid until ${fmtDate(until)}.`);
  if (after(issued, today)) flags.push(flag('future', 'inconsistent', 'high', `It is dated ${fmtDate(issued)}, after today.`));
  else if (issued && !until && daysBetween(issued, today) > A.kfsOldDays) flags.push(flag('old', 'expired', 'medium', `It was issued on ${fmtDate(issued)}, ${daysBetween(issued, today)} days ago. Ask the lender whether it still holds.`));
  return { flags, passed };
}

// ── across the papers, and against the account ─────────────────
const nameTokens = (name) => String(name || '').toLowerCase().replace(/\b(mr|mrs|ms|shri|smt|sri|kumari|m\/s)\b\.?/g, ' ').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
// "Ramesh K." and "RAMESH KUMAR" are the same person; "Suresh" is not.
export function sameName(a, b) {
  const x = nameTokens(a), y = nameTokens(b);
  if (!x.length || !y.length) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const used = new Set();
  return short.every((token) => {
    const at = long.findIndex((other, i) => !used.has(i) && (other === token || (token.length === 1 && other.startsWith(token)) || (other.length === 1 && token.startsWith(other))));
    if (at === -1) return false;
    used.add(at);
    return true;
  });
}

// Income MITRA would count from statement lines, as a yearly figure.
function statementYearly(doc) {
  const credits = doc.transactions.filter((row) => row.credit && row.stream !== 'excluded');
  const dates = doc.transactions.map((row) => row.date).sort();
  const days = dates.length ? daysBetween(dates[0], dates.at(-1)) + 1 : 0;
  return days >= 28 ? Math.round((credits.reduce((total, row) => total + row.credit, 0) / days) * 365) : null;
}

// Flags that need more than one paper. Returned per document, by its fingerprint.
export function crossFlags(docs, { holderName = null } = {}) {
  const out = new Map(docs.map((doc) => [doc.hash, []]));
  const add = (doc, item) => out.get(doc.hash).push(item);
  const named = docs.filter((doc) => doc.holder);
  for (const doc of named) {
    const against = holderName || named[0].holder;
    if (doc !== named[0] || holderName) {
      if (!sameName(doc.holder, against)) add(doc, flag('name', 'identity', 'medium', `The name on it, ${doc.holder}, is not ${holderName ? 'the name on your account' : 'the name on your other papers'}, ${against}.`));
    }
  }
  const seenFiles = new Set(), seenRefs = new Map();
  for (const doc of docs) {
    if (seenFiles.has(doc.hash)) add(doc, flag('same_file', 'quality', 'low', 'The same file was shared twice. It is counted once.'));
    seenFiles.add(doc.hash);
    for (const receipt of doc.receipts || []) {
      const ref = receipt.reference && String(receipt.reference).replace(/\s/g, '');
      if (!ref) continue;
      const earlier = seenRefs.get(ref);
      if (earlier && earlier.doc.hash !== doc.hash && earlier.receipt.credit !== receipt.credit) add(doc, flag('reused_reference', 'inconsistent', 'high', `Its UPI reference ${ref} is on another receipt, for a different amount.`));
      seenRefs.set(ref, { doc, receipt });
    }
  }
  const statements = docs.filter((doc) => doc.kind === 'bank_statement');
  const banked = statements.map(statementYearly).filter((value) => value != null);
  if (banked.length) {
    const yearly = Math.max(...banked);
    for (const doc of docs.filter((item) => item.kind === 'income_tax_return' || item.kind === 'gst_return')) {
      const declared = doc.declared?.[0]?.annual;
      if (!declared || doc.kind === 'gst_return') continue;
      const ratio = yearly / declared;
      if (ratio > A.declaredVsBankRatio || ratio < 1 / A.declaredVsBankRatio) add(doc, flag('return_vs_bank', 'inconsistent', 'medium', `It declares ${inr(declared)} for the year, but the bank statement shows income of about ${inr(yearly)} a year.`));
    }
  }
  return out;
}

// ── the verdict ─────────────────────────────────────────────────
const VERDICTS = {
  suspect: { tone: 'bad', warning: 'A lender may reject this paper when you apply, and anything MITRA works out from it may not be accurate.' },
  expired: { tone: 'warn', warning: 'A lender will likely ask for a newer one, and what MITRA works out from it may not reflect what you have now.' },
  caution: { tone: 'warn', warning: 'A lender may question it. MITRA can still read it, but treat what comes from it with care.' },
  clean: { tone: 'ok', warning: null },
};

export function verdictFor(flags) {
  const worst = [...flags].sort((a, b) => RANK[b.severity] - RANK[a.severity])[0];
  const verdict = !worst || worst.severity === 'low' ? 'clean'
    : worst.severity === 'high' ? (worst.category === 'expired' ? 'expired' : 'suspect')
      : flags.some((item) => item.category === 'expired' && item.severity !== 'low') ? 'expired' : 'caution';
  const headline = verdict === 'clean' ? 'No warning signs found' : verdict === 'expired' ? CATEGORY.expired : worst.label;
  return { verdict, headline, tone: VERDICTS[verdict].tone, warning: VERDICTS[verdict].warning };
}

export function summarise({ flags = [], passed = [] }) {
  const sorted = [...flags].sort((a, b) => RANK[b.severity] - RANK[a.severity]);
  return { ...verdictFor(sorted), flags: sorted, passed, pack: { id: DOC_CHECK_PACK.id, label: DOC_CHECK_PACK.label, asOf: DOC_CHECK_PACK.asOf } };
}

const merge = (...parts) => ({ flags: parts.flatMap((part) => part.flags), passed: parts.flatMap((part) => part.passed) });

// Every income paper, checked on its own and against the others.
export function checkIncomeDocuments(docs, { forensics = {}, today, holderName = null } = {}) {
  const across = crossFlags(docs, { holderName });
  return docs.map((doc) => {
    const own = doc.kind === 'bank_statement' ? statementFlags(doc, { today })
      : doc.kind === 'payment_receipt' ? receiptFlags(doc, { today })
        : doc.kind === 'income_tax_return' || doc.kind === 'gst_return' ? returnFlags(doc, { today }) : { flags: [], passed: [] };
    return summarise(merge(fileFlags(forensics[doc.hash], { kind: doc.kind }), own, { flags: across.get(doc.hash) || [], passed: [] }));
  });
}

export function checkLoanDocument(fields, { forensics = null, today, holderName = null } = {}) {
  const name = holderName && fields?.borrower && !sameName(fields.borrower, holderName)
    ? { flags: [flag('name', 'identity', 'medium', `It is made out to ${fields.borrower}, not ${holderName}.`)], passed: [] } : { flags: [], passed: [] };
  return summarise(merge(fileFlags(forensics, { kind: 'loan_kfs' }), loanFlags(fields, { today }), name));
}

// Spoken after the read-back. Plain words, no figures, so nothing here can be misheard.
export function checkLine(checked) {
  const worrying = checked.filter(({ check }) => check && check.verdict !== 'clean');
  if (!worrying.length) return '';
  const worst = worrying.find(({ check }) => check.verdict === 'suspect') || worrying.find(({ check }) => check.verdict === 'expired') || worrying[0];
  const which = worrying.length === 1 ? `Your ${worst.kindLabel.toLowerCase()}` : `${worrying.length} of your papers, including your ${worst.kindLabel.toLowerCase()},`;
  const what = { suspect: worst.check.headline === CATEGORY.edited ? 'shows signs of editing' : worst.check.headline === CATEGORY.identity ? 'may not be in your name' : 'has figures that do not add up', expired: 'is out of date', caution: 'has something a lender may question' }[worst.check.verdict];
  return ` One warning: ${which} ${what}. ${worst.check.warning} The details are on your screen.`;
}

// Carried with what was confirmed, so later answers can say what they rest on.
export const checksCarried = (docs) => docs.filter((doc) => doc.check && doc.check.verdict !== 'clean')
  .map((doc) => ({ name: doc.name, kindLabel: doc.kindLabel, verdict: doc.check.verdict, headline: doc.check.headline }));
