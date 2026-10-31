import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { INCOME_SAMPLES } from '../src/journeys/sampleIncome.js';
import { interpretIncomeDocument } from '../src/journeys/incomeRead.js';

// Accounts live in the store, so each run gets its own empty one.
process.env.MITRA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mitra-accounts-'));
const accounts = await import('../server/accounts.mjs');
const { updateStore } = await import('../server/store.mjs');
const { openSession } = await import('../server/journeyApi.mjs');

const asRequest = (token) => ({ headers: { authorization: `Bearer ${token}` } });
const dmy = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const riderStatement = () => interpretIncomeDocument({
  result: { doc_kind: 'bank_statement', period_from: '01-05-2026', period_to: '31-10-2026', transactions: INCOME_SAMPLES.rider.statement.rows.map((row) => ({ ...row, date: dmy(row.date) })) },
}, { hash: 'f'.repeat(64), name: 'statement.pdf' });

test('mobile numbers are read the way people type them, and anything else is refused', () => {
  assert.equal(accounts.normalisePhone('+91 98765 43210'), '9876543210');
  assert.equal(accounts.normalisePhone('09876543210'), '9876543210');
  assert.equal(accounts.normalisePhone('98765-43210'), '9876543210');
  assert.equal(accounts.normalisePhone('12345 67890'), null, 'Indian mobiles start with 6 to 9');
  assert.equal(accounts.normalisePhone('98765'), null);
});

test('a PIN is stored hashed, and only the right PIN matches', async () => {
  const secret = await accounts.hashPin('4821');
  assert.notEqual(secret.hash, '4821');
  assert.equal(await accounts.pinMatches('4821', secret), true);
  assert.equal(await accounts.pinMatches('4822', secret), false);
});

test('a new account signs up, signs in, and is found from its token', async () => {
  const made = await accounts.signUp({ name: '  Priya   S ', phone: '+91 91234 56789', pin: '2580', work: 'gig', city: 'Pune', lang: 'mr' });
  assert.equal(made.user.name, 'Priya S');
  assert.equal(made.user.phone, '+91 ••••• 56789', 'the number is masked');
  assert.equal(made.user.onboarded, false);
  assert.equal(made.user.kind, 'customer');
  assert.equal(made.user.sample, 'rider');
  const found = await accounts.userFromRequest(asRequest(made.token));
  assert.equal(found.name, 'Priya S');
  assert.equal(found.pin.hash.length, 64);
  const back = await accounts.signIn({ phone: '9123456789', pin: '2580' });
  assert.equal(back.user.id, made.user.id);
  await assert.rejects(accounts.signUp({ name: 'Someone', phone: '9123456789', pin: '1111' }), { status: 409 });
  await assert.rejects(accounts.signUp({ name: 'X', phone: '9123456780', pin: '1111' }), { status: 422 });
  await assert.rejects(accounts.signUp({ name: 'Xavier', phone: '9123456780', pin: '12' }), { status: 422 });
});

test('a wrong PIN and an unknown number get the same answer, and five wrong PINs lock the account', async () => {
  await accounts.signUp({ name: 'Arun', phone: '9000000001', pin: '1234' });
  await assert.rejects(accounts.signIn({ phone: '9000000002', pin: '1234' }), { status: 401, message: 'That number and PIN do not match' });
  for (let i = 0; i < 5; i++) await assert.rejects(accounts.signIn({ phone: '9000000001', pin: '0000' }), { status: 401, message: 'That number and PIN do not match' });
  await assert.rejects(accounts.signIn({ phone: '9000000001', pin: '1234' }), { status: 429 });
});

test('the two demo people sign in with one tap and are already set up', async () => {
  const ramesh = await accounts.signInDemo('ramesh');
  assert.equal(ramesh.user.demo, true);
  assert.equal(ramesh.user.onboarded, true);
  assert.equal(ramesh.user.customerId, 'ramesh');
  const lakshmi = await accounts.signInDemo('lakshmi');
  assert.equal(lakshmi.user.kind, 'merchant');
  assert.equal(lakshmi.user.sample, 'kirana');
  assert.equal((await accounts.userFromRequest(asRequest(lakshmi.token))).customerId, 'lakshmi');
  await assert.rejects(accounts.signInDemo('mallory'), { status: 404 });
  await accounts.signOut(asRequest(ramesh.token));
  assert.equal(await accounts.userFromRequest(asRequest(ramesh.token)), null, 'signing out ends the token');
});

test('papers need consent before they are read', async () => {
  const made = await accounts.signUp({ name: 'Meena', phone: '9000000003', pin: '4444' });
  const user = await accounts.userFromRequest(asRequest(made.token));
  await assert.rejects(accounts.readPapers(user, { files: [], consent: false }), { status: 422 });
});

test('papers confirmed at onboarding are kept on the account and carried into each call', async () => {
  const made = await accounts.signUp({ name: 'Ravi Kumar', phone: '9000000004', pin: '7777', work: 'gig', city: 'Chennai', lang: 'ta' });
  await updateStore((db) => { db.users[made.user.id].pendingPapers = [riderStatement()]; });
  let user = await accounts.userFromRequest(asRequest(made.token));
  const confirmed = await accounts.confirmPapers(user, { accept: true, edits: [] });
  assert.equal(confirmed.income.counted, 43000);
  assert.equal(confirmed.income.comfortableEmi, 9700);
  assert.equal(confirmed.consent.purpose, 'affordability');
  assert.equal((await accounts.finishOnboarding(user)).onboarded, true);

  user = await accounts.userFromRequest(asRequest(made.token));
  const { session, opening } = await openSession({ user, channel: 'call' });
  assert.equal(session.customer.name, 'Ravi Kumar');
  assert.equal(session.customer.kind, 'customer');
  assert.equal(session.facts.incomeProfile.value.counted, 43000);
  assert.equal(session.consents[0].purpose, 'affordability');
  assert.match(opening.reply.english, /^Namaste, Ravi\./);
  assert.equal(opening.chips[0], 'Can I afford this loan?');
  assert.equal(opening.passports.length, 2);
  assert.equal(opening.passports[1].journey, 'Income papers carried from onboarding');
});

test('papers the customer rejects are not kept', async () => {
  const made = await accounts.signUp({ name: 'Kavya', phone: '9000000005', pin: '5555' });
  await updateStore((db) => { db.users[made.user.id].pendingPapers = [riderStatement()]; });
  const user = await accounts.userFromRequest(asRequest(made.token));
  const out = await accounts.confirmPapers(user, { accept: false });
  assert.equal(out.income, null);
  await assert.rejects(accounts.confirmPapers(user, { accept: true }), { status: 409 });
});
