// Linking a bank account at onboarding, the way RBI's Account Aggregator framework
// works: the customer picks a bank, approves a consent for one purpose, proves it is
// their number with an OTP, chooses accounts, and the statement arrives as data.
//
// This is a SANDBOX. No bank is contacted and no SMS is sent: the OTP is shown on
// screen and the statement is synthetic, shaped like the sample papers. A real
// deployment registers as a Financial Information User and replaces the three calls
// marked "AA:" below with a licensed Account Aggregator's consent and FI APIs.
import { createHash, randomInt } from 'node:crypto';
import { INCOME_SAMPLES } from '../src/journeys/sampleIncome.js';
import { interpretIncomeDocument, incomeReadBackLine } from '../src/journeys/incomeRead.js';
import { PACKS } from '../src/journeys/policyPacks.js';

export const BANKS = Object.freeze([
  ['sbi', 'State Bank of India'], ['hdfc', 'HDFC Bank'], ['icici', 'ICICI Bank'], ['axis', 'Axis Bank'],
  ['kotak', 'Kotak Mahindra Bank'], ['pnb', 'Punjab National Bank'], ['bob', 'Bank of Baroda'], ['canara', 'Canara Bank'],
  ['union', 'Union Bank of India'], ['boi', 'Bank of India'], ['indusind', 'IndusInd Bank'], ['idfc', 'IDFC FIRST Bank'],
  ['yes', 'Yes Bank'], ['federal', 'Federal Bank'], ['iob', 'Indian Overseas Bank'], ['central', 'Central Bank of India'],
].map(([id, name]) => Object.freeze({ id, name })));

const OTP_MINUTES = 10;
const MAX_TRIES = 5;
const fail = (status, message) => Object.assign(new Error(message), { status });
const sha = (text) => createHash('sha256').update(String(text)).digest('hex');

// What the consent asks for, in the words an AA consent screen uses.
export function consentTerms(bank) {
  return {
    bank: bank.name, purpose: 'Check what you can safely afford before a loan', fiTypes: ['Deposit account: transactions and summary'],
    range: 'Last 6 months', frequency: 'Once', dataLife: `${PACKS.privacy.assumptions.consentDays} days`, aggregator: 'Account Aggregator (sandbox)',
  };
}

// AA: create a consent request and send the OTP. The sandbox returns the code instead.
export function startLink(user, bankId, now = Date.now()) {
  const bank = BANKS.find((item) => item.id === bankId);
  if (!bank) throw fail(422, 'Pick your bank');
  const otp = String(randomInt(100000, 1000000));
  const handle = `CR-${sha(`${user.id}${now}${otp}`).slice(0, 10).toUpperCase()}`;
  return {
    pending: { handle, bankId, otpHash: sha(`${handle}:${otp}`), expiresAt: now + OTP_MINUTES * 60_000, tries: 0, verified: false },
    reply: { handle, terms: consentTerms(bank), sentTo: user.phone ? `+91 ••••• ${user.phone.slice(-5)}` : null, sandboxOtp: otp, expiresInMinutes: OTP_MINUTES },
  };
}

// The accounts this number holds at that bank. Stable for one person, different between people.
export function discoverAccounts(user, bankId) {
  const seed = parseInt(sha(`${user.id}:${bankId}`).slice(0, 8), 16);
  const last4 = (offset) => String((seed + offset * 7919) % 10000).padStart(4, '0');
  const accounts = [{ ref: `${bankId}-sav`, type: 'Savings account', masked: `XXXXXX${last4(1)}`, primary: true }];
  if (seed % 3 === 0) accounts.push({ ref: `${bankId}-cur`, type: user.work === 'shop' ? 'Current account' : 'Savings account', masked: `XXXXXX${last4(2)}`, primary: false });
  return accounts;
}

// AA: verify the OTP the customer typed.
export function verifyLink(user, pending, { handle, otp }, now = Date.now()) {
  if (!pending || pending.handle !== handle) throw fail(409, 'Start linking your bank again');
  if (now > pending.expiresAt) throw fail(410, 'That code has expired. Ask for a new one.');
  if (pending.tries >= MAX_TRIES) throw fail(429, 'Too many wrong codes. Ask for a new one.');
  if (sha(`${handle}:${String(otp || '').trim()}`) !== pending.otpHash) {
    pending.tries += 1;
    throw fail(401, `That code is not right. ${MAX_TRIES - pending.tries} tries left.`);
  }
  pending.verified = true;
  return discoverAccounts(user, pending.bankId);
}

// AA: fetch the statement for the accounts the customer chose. Here it is the sample
// statement for their kind of work, scaled a little so no two people look the same.
export function fetchStatements(user, pending, refs, now = Date.now()) {
  if (!pending?.verified) throw fail(409, 'Verify the code first');
  const bank = BANKS.find((item) => item.id === pending.bankId);
  const found = discoverAccounts(user, pending.bankId);
  const chosen = found.filter((account) => (Array.isArray(refs) ? refs : []).includes(account.ref));
  if (!chosen.length) throw fail(422, 'Choose at least one account');
  const sample = INCOME_SAMPLES[user.work === 'shop' ? 'kirana' : 'rider'];
  const holder = String(user.name || 'Account holder').toUpperCase();
  const scale = 0.85 + (parseInt(sha(user.id).slice(0, 4), 16) % 31) / 100;
  const round10 = (value) => Math.round((value * scale) / 10) * 10;
  const dmy = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
  return chosen.map((account, index) => {
    // A second account carries a slice of the activity, not a copy of the first.
    const rows = sample.statement.rows.filter((_, at) => (chosen.length === 1 ? true : at % chosen.length === index));
    const transactions = rows.map((row) => ({
      date: dmy(row.date), description: row.description.replace(/RAMESH K|LAKSHMI STORES/g, holder),
      credit: row.credit ? round10(row.credit) : 0, debit: row.debit ? (/EMI|RENT/.test(row.description) ? row.debit : round10(row.debit)) : 0,
    }));
    const payload = { bank: bank.id, account: account.masked, transactions };
    const doc = interpretIncomeDocument({
      result: { doc_kind: 'bank_statement', holder: user.name, issuer: bank.name, period_from: dmy(sample.statement.from), period_to: dmy(sample.statement.to), transactions },
    }, { hash: sha(JSON.stringify(payload) + now), name: `${bank.name} ${account.type.toLowerCase()} ${account.masked.slice(-4)}` });
    return { ...doc, kindLabel: 'Bank statement, linked', via: 'aa', bank: bank.name, account: account.masked };
  });
}

export const linkLine = (docs) => incomeReadBackLine(docs).replace(/^I read /, 'Your bank shared ');
