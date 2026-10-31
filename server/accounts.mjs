// Accounts: who is calling, settled before the call starts. A prototype's sign-in:
// a mobile number and a 4-digit PIN, hashed with scrypt. No SMS is sent here; a real
// deployment signs in with an OTP or with the customer's Paytm login.
//
// Onboarding asks for income papers once, with consent for one purpose. What the
// customer confirms is kept on the account and carried into each call under that
// consent, so no agent asks for it again.
import { agentCallReady, cancelCall, cleanConfirmed, publicCall, requestCall } from './agentCall.mjs';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { CUSTOMERS } from '../src/journeys/sampleData.js';
import { applyEdits, incomeReadBackLine, interpretIncomeDocument, profileFromDocuments } from '../src/journeys/incomeRead.js';
import { PACKS } from '../src/journeys/policyPacks.js';
import { addDays, isoDate } from '../src/journeys/money.js';
import { clientId, rateLimited } from './aiProxy.mjs';
import { fingerprint, readIncomeDocument } from './documents.mjs';
import { fileForensics } from './documentForensics.mjs';
import { checkIncomeDocuments, checkLine, checksCarried } from '../src/journeys/engines/docCheck.js';
import { sarvamAvailable } from './sarvamServer.mjs';
import { newId, readStore, updateStore } from './store.mjs';
import { BANKS, fetchStatements, linkLine, startLink, verifyLink } from './bankLink.mjs';

const scrypt = promisify(scryptCallback);
const TOKEN_DAYS = 7;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const MAX_FILES = 5;
const MAX_BYTES = 15_000_000;

export const WORK = Object.freeze({
  gig: { label: 'Gig work: delivery, driving or freelance', papers: ['Bank statement, last 6 months', 'Payout or UPI receipts', 'Income tax return, if you file one'], sample: 'rider' },
  shop: { label: 'A shop or small business', papers: ['Bank statement, last 6 months', 'GST return, if you file one', 'UPI or Soundbox receipts'], sample: 'kirana' },
  salaried: { label: 'A salaried job', papers: ['Bank statement with your salary, last 6 months', 'Income tax return'], sample: 'rider' },
  other: { label: 'Something else', papers: ['Bank statement, last 6 months', 'Any receipts for money you earn'], sample: 'rider' },
});
export const LANGS = Object.freeze(['en', 'hi', 'ta', 'te', 'kn', 'ml', 'mr', 'bn', 'gu', 'pa', 'od']);

// The two people the demo has always had, now one tap from the sign-in screen.
const DEMO = Object.freeze({
  ramesh: { work: 'gig', lang: 'ta' },
  lakshmi: { work: 'shop', lang: 'ta' },
});

const fail = (status, message) => Object.assign(new Error(message), { status });
const sha = (text) => createHash('sha256').update(text).digest('hex');

export function normalisePhone(value) {
  const digits = String(value || '').replace(/[^\d]/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}
const validPin = (pin) => /^\d{4}$/.test(String(pin || ''));
const cleanName = (name) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);

export async function hashPin(pin, salt = randomBytes(16).toString('hex')) {
  const hash = (await scrypt(String(pin), salt, 32)).toString('hex');
  return { salt, hash };
}
export async function pinMatches(pin, { salt, hash }) {
  const tried = await scrypt(String(pin), salt, 32);
  return timingSafeEqual(tried, Buffer.from(hash, 'hex'));
}

const consentLive = (consent, today = isoDate(Date.now())) => Boolean(consent && !consent.revokedOn && consent.expiresOn >= today);

export function publicUser(user) {
  if (!user) return null;
  const profile = user.incomeProfile;
  return {
    id: user.id, demo: Boolean(user.demo), name: user.name, customerId: user.customerId || user.id,
    kind: user.kind || 'customer', work: user.work, workLabel: WORK[user.work]?.label || null, city: user.city || null, lang: user.lang || 'en',
    phone: user.phone ? `+91 ••••• ${user.phone.slice(-5)}` : null,
    // In full for the account's own screen, so nobody confirms a call to a number they cannot read.
    phoneFull: user.phone ? `+91 ${user.phone.slice(0, 5)} ${user.phone.slice(5)}` : null, onboarded: Boolean(user.onboarded),
    papers: WORK[user.work]?.papers || [], sample: WORK[user.work]?.sample || 'rider',
    income: profile && consentLive(user.consent) ? {
      counted: profile.counted, comfortableEmi: profile.comfortableEmi, stretchEmi: profile.stretchEmi, existingEmi: profile.existingEmi,
      monthCount: profile.monthCount, from: profile.from, to: profile.to, basis: profile.basis, documents: profile.documents?.length || 0,
    } : null,
    consent: user.consent || null,
    banks: (user.linkedAccounts || []).map(({ bank, account, linkedOn }) => ({ bank, account, linkedOn })),
    agentCall: publicCall(user),
    spoken: user.spoken || null,
  };
}

function demoUser(id) {
  const customer = CUSTOMERS[id];
  return { id, demo: true, customerId: id, name: customer.name, kind: customer.kind, city: customer.profile.city, ...DEMO[id], onboarded: true };
}

// The customer as a call sees them. A new account is never a Soundbox merchant:
// shop tools read the Soundbox's own sales, and there is none connected yet.
export function customerFor(user) {
  if (user.demo) return CUSTOMERS[user.customerId];
  return { id: user.id, kind: 'customer', name: user.name, preferredChannel: 'phone call', profile: { city: user.city || 'your city', age: null }, answers: {}, fromAccount: true };
}

async function issueToken(userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + TOKEN_DAYS * 86_400_000;
  await updateStore((db) => {
    db.authTokens ||= {};
    for (const [key, item] of Object.entries(db.authTokens)) if (item.expiresAt < Date.now()) delete db.authTokens[key];
    db.authTokens[sha(token)] = { userId, expiresAt };
  });
  return token;
}

const bearer = (req) => String(req.headers.authorization || '').match(/^Bearer ([\w-]{20,100})$/)?.[1] || null;

export async function userFromRequest(req) {
  const token = bearer(req);
  if (!token) return null;
  return readStore((db) => {
    const entry = db.authTokens?.[sha(token)];
    if (!entry || entry.expiresAt < Date.now()) return null;
    if (DEMO[entry.userId]) return demoUser(entry.userId);
    return db.users?.[entry.userId] || null;
  });
}

export async function signUp({ name, phone, pin, work, city, lang }) {
  const cleaned = cleanName(name);
  const mobile = normalisePhone(phone);
  if (cleaned.length < 2) throw fail(422, 'Tell us your name');
  if (!mobile) throw fail(422, 'Enter a 10-digit Indian mobile number');
  if (!validPin(pin)) throw fail(422, 'Choose a 4-digit PIN');
  const secret = await hashPin(pin);
  const user = await updateStore((db) => {
    db.users ||= {};
    if (Object.values(db.users).some((item) => item.phone === mobile)) throw fail(409, 'This number already has an account. Sign in instead.');
    const created = {
      id: newId('usr'), name: cleaned, phone: mobile, pin: secret, kind: 'customer',
      work: WORK[work] ? work : null, city: String(city || '').trim().slice(0, 40) || null, lang: LANGS.includes(lang) ? lang : 'en',
      createdAt: new Date().toISOString(), onboarded: false, incomeProfile: null, consent: null, pendingPapers: null, failures: null,
    };
    db.users[created.id] = created;
    return created;
  });
  return { token: await issueToken(user.id), user: publicUser(user) };
}

export async function signIn({ phone, pin }) {
  const mobile = normalisePhone(phone);
  if (!mobile || !validPin(pin)) throw fail(422, 'Enter your mobile number and 4-digit PIN');
  const user = await readStore((db) => Object.values(db.users || {}).find((item) => item.phone === mobile) || null);
  // The same answer for a wrong number and a wrong PIN, so numbers cannot be probed.
  if (!user) throw fail(401, 'That number and PIN do not match');
  if (user.failures?.count >= MAX_FAILURES && Date.now() - user.failures.at < LOCK_MS) throw fail(429, 'Too many wrong PINs. Try again in 15 minutes.');
  const ok = await pinMatches(pin, user.pin);
  await updateStore((db) => {
    const stored = db.users[user.id];
    stored.failures = ok ? null : { count: (stored.failures && Date.now() - stored.failures.at < LOCK_MS ? stored.failures.count : 0) + 1, at: Date.now() };
  });
  if (!ok) throw fail(401, 'That number and PIN do not match');
  return { token: await issueToken(user.id), user: publicUser(user) };
}

export async function signInDemo(id) {
  if (!DEMO[id]) throw fail(404, 'No such demo account');
  return { token: await issueToken(id), user: publicUser(demoUser(id)) };
}

export async function signOut(req) {
  const token = bearer(req);
  if (token) await updateStore((db) => { if (db.authTokens) delete db.authTokens[sha(token)]; });
}

async function changeUser(id, fn) {
  return updateStore((db) => {
    const user = db.users?.[id];
    if (!user) throw fail(404, 'Account not found');
    const out = fn(user);
    return out === undefined ? user : out;
  });
}

export async function updateProfile(user, { work, city, lang }) {
  const saved = await changeUser(user.id, (stored) => {
    if (WORK[work]) stored.work = work;
    if (city != null) stored.city = String(city).trim().slice(0, 40) || null;
    if (LANGS.includes(lang)) stored.lang = lang;
  });
  return publicUser(saved);
}

// Onboarding: the same reader as a call, and nothing used until the customer confirms.
export async function readPapers(user, { files, consent }) {
  if (consent !== true) throw fail(422, 'Agree to how your papers are used first');
  if (!sarvamAvailable()) throw fail(503, 'Reading documents needs Sarvam Vision, which is not available right now. You can skip this step.');
  const list = Array.isArray(files) ? files.slice(0, MAX_FILES) : [];
  const buffers = list.map((file) => ({ ...file, buffer: Buffer.from(String(file?.data || ''), 'base64') })).filter((file) => file.buffer.length);
  if (!buffers.length) throw fail(422, 'Add at least one document');
  if (buffers.reduce((total, file) => total + file.buffer.length, 0) > MAX_BYTES) throw fail(413, 'Those files are larger than 15 MB together');
  const started = Date.now();
  const docs = await Promise.all(buffers.map(async (file) => {
    const hash = fingerprint(file.buffer);
    const name = String(file.name || 'document').slice(0, 80);
    try {
      return interpretIncomeDocument(await readIncomeDocument(file.buffer, { name, mime: file.mime }), { hash, name });
    } catch (error) {
      return { kind: 'other', kindLabel: 'Could not be read', hash, name, transactions: [], receipts: [], declared: [], problems: [error.message], usable: false };
    }
  }));
  const usable = docs.filter((doc) => doc.usable);
  // Each paper checked on its own and against the account's name. A warning, never a block.
  const forensics = Object.fromEntries(buffers.map((file) => [fingerprint(file.buffer), fileForensics(file.buffer, { mime: file.mime })]));
  checkIncomeDocuments(usable, { forensics, today: isoDate(Date.now()), holderName: user.name }).forEach((check, index) => { usable[index].check = check; });
  await changeUser(user.id, (stored) => { stored.pendingPapers = usable.length ? usable : null; });
  return {
    docs: usable, failed: docs.filter((doc) => !doc.usable).map((doc) => ({ name: doc.name, kindLabel: doc.kindLabel, problems: doc.problems })),
    ms: Date.now() - started, line: `${incomeReadBackLine(docs)}${checkLine(usable)}`,
  };
}

export async function confirmPapers(user, { accept, edits }) {
  const now = Date.now();
  const saved = await changeUser(user.id, (stored) => {
    const pending = stored.pendingPapers;
    if (!pending) throw fail(409, 'There are no papers waiting');
    stored.pendingPapers = null;
    if (!accept) return stored;
    const { docs, changed } = applyEdits(pending, edits);
    const profile = profileFromDocuments(docs);
    if (!profile.monthCount && profile.basis !== 'declared') throw fail(422, 'Nothing is left to count once those lines are unticked');
    const today = isoDate(now);
    const linked = pending.filter((doc) => doc.via === 'aa');
    stored.incomeProfile = { ...profile, corrections: changed, confirmedOn: today, checks: checksCarried(docs) };
    if (linked.length) stored.linkedAccounts = [...(stored.linkedAccounts || []), ...linked.map((doc) => ({ bank: doc.bank, account: doc.account, linkedOn: today }))];
    stored.consent = {
      purpose: 'affordability',
      words: linked.length ? `Linked ${linked[0].bank} through an Account Aggregator, then confirmed the statement line by line` : 'Agreed at onboarding, then confirmed the papers line by line',
      grantedOn: today, expiresOn: addDays(today, PACKS.privacy.assumptions.consentDays), revokedOn: null,
    };
    return stored;
  });
  return publicUser(saved);
}

// Linking a bank: consent and OTP, then the accounts, then the statement as data.
export async function startBankLink(user, { bankId, consent }) {
  if (consent !== true) throw fail(422, 'Agree to how your statement is used first');
  const { pending, reply } = startLink(user, bankId);
  await changeUser(user.id, (stored) => { stored.pendingLink = pending; });
  return reply;
}

export async function verifyBankLink(user, body) {
  return changeUserKeeping(user.id, (stored) => ({ accounts: verifyLink(stored, stored.pendingLink, body) }));
}

export async function fetchBankLink(user, { handle, accounts }) {
  const started = Date.now();
  const docs = await changeUser(user.id, (stored) => {
    if (stored.pendingLink?.handle !== handle) throw fail(409, 'Start linking your bank again');
    const fetched = fetchStatements(stored, stored.pendingLink, accounts);
    stored.pendingLink = null;
    stored.pendingPapers = fetched;
    return fetched;
  });
  return { docs, failed: [], ms: Date.now() - started, line: linkLine(docs) };
}

// A wrong OTP still has to count against the tries, so the change is saved even when it fails.
async function changeUserKeeping(id, fn) {
  let failure = null;
  const out = await updateStore((db) => {
    const user = db.users?.[id];
    if (!user) throw fail(404, 'Account not found');
    try { return fn(user); } catch (error) { failure = error; return null; }
  });
  if (failure) throw failure;
  return out;
}

// Income confirmed on a call is saved to the account too, so the next call has it.
export async function saveIncomeToAccount(userId, { profile, linked = [], words }) {
  const now = Date.now();
  return publicUser(await changeUser(userId, (stored) => {
    const today = isoDate(now);
    stored.incomeProfile = { ...profile, confirmedOn: today };
    if (linked.length) stored.linkedAccounts = [...(stored.linkedAccounts || []).filter((item) => !linked.some((doc) => doc.account === item.account)), ...linked.map((doc) => ({ bank: doc.bank, account: doc.account, linkedOn: today }))];
    stored.consent = { purpose: 'affordability', words, grantedOn: today, expiresOn: addDays(today, PACKS.privacy.assumptions.consentDays), revokedOn: null };
  }));
}

export async function finishOnboarding(user) {
  return publicUser(await changeUser(user.id, (stored) => { stored.onboarded = true; stored.pendingPapers = null; }));
}

// A new login number. It signs the customer in from now on, so the PIN must match.
export async function changePhone(user, { phone, pin }) {
  const mobile = normalisePhone(phone);
  if (!mobile) throw fail(422, 'Enter a 10-digit Indian mobile number.');
  if (!validPin(pin) || !(await pinMatches(pin, user.pin))) throw fail(401, 'That PIN is not right.');
  const saved = await updateStore((db) => {
    const stored = db.users?.[user.id];
    if (!stored) throw fail(404, 'Account not found');
    if (Object.values(db.users).some((item) => item.id !== user.id && item.phone === mobile)) throw fail(409, 'That number already has an account.');
    stored.phone = mobile;
    return stored;
  });
  return publicUser(saved);
}

// The customer's answer to what the agent heard. Only this makes any of it count.
export async function confirmCall(user, { accept, edits }) {
  const now = Date.now();
  const saved = await changeUser(user.id, (stored) => {
    const call = stored.agentCall;
    if (!call || call.status !== 'connected' || call.decided) throw fail(409, 'There are no call details waiting');
    if (!accept) { call.decided = 'discarded'; call.details = null; call.transcript = []; return stored; }
    const clean = cleanConfirmed(edits || {}, call.details || {});
    if (clean.work) stored.work = clean.work;
    if (clean.city) stored.city = clean.city;
    if (clean.lang) stored.lang = clean.lang;
    const today = isoDate(now);
    stored.spoken = {
      income: clean.income, dependants: clean.dependants, existingLife: clean.existingLife, existingHealth: clean.existingHealth, goal: clean.goal,
      words: 'Said on the onboarding call, then checked and confirmed on screen', confirmedOn: today,
      expiresOn: addDays(today, PACKS.privacy.assumptions.consentDays), revokedOn: null,
    };
    call.decided = 'confirmed';
    return stored;
  });
  return publicUser(saved);
}

// What the customer told the agent and confirmed, if that consent still holds.
export function carriedSpoken(user, now = Date.now()) {
  return !user.demo && user.spoken && consentLive(user.spoken, isoDate(now)) ? user.spoken : null;
}

// Income papers confirmed at onboarding, if the consent for them still holds.
export function carriedIncome(user, now = Date.now()) {
  if (user.demo || !user.incomeProfile || !consentLive(user.consent, isoDate(now))) return null;
  return { profile: user.incomeProfile, consent: user.consent };
}

// ── routes ──────────────────────────────────────────────────────
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readBody(req, limit = 100_000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw fail(413, 'Request is too large');
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw fail(400, 'Request body must be valid JSON'); }
}

export async function handleAuth(req, res, url) {
  try {
    const route = url.pathname.slice('/api/auth'.length);
    const writes = req.method === 'POST' && ['/signup', '/login', '/demo', '/bank/verify', '/phone', '/call'].includes(route);
    if (writes && rateLimited(clientId(req), 'auth')) throw fail(429, 'Too many attempts. Try again in a minute.');
    if (req.method === 'POST' && route === '/signup') return json(res, 201, await signUp(await readBody(req)));
    if (req.method === 'POST' && route === '/login') return json(res, 200, await signIn(await readBody(req)));
    if (req.method === 'POST' && route === '/demo') return json(res, 200, await signInDemo((await readBody(req)).id));

    const user = await userFromRequest(req);
    if (!user) throw fail(401, 'Please sign in');
    if (req.method === 'GET' && route === '/me') return json(res, 200, { user: publicUser(user) });
    if (req.method === 'GET' && route === '/call') return json(res, 200, { ready: agentCallReady(), call: publicCall(user), user: publicUser(user) });
    if (req.method === 'POST' && route === '/logout') { await signOut(req); return json(res, 200, { ok: true }); }
    if (req.method === 'GET' && route === '/bank/banks') return json(res, 200, { banks: BANKS, sandbox: true });
    if (user.demo) throw fail(403, 'Demo accounts are already set up');
    if (req.method === 'POST' && route === '/profile') return json(res, 200, { user: await updateProfile(user, await readBody(req)) });
    if (req.method === 'POST' && route === '/papers') return json(res, 200, await readPapers(user, await readBody(req, Math.ceil(MAX_BYTES * 1.4))));
    if (req.method === 'POST' && route === '/papers/confirm') return json(res, 200, { user: await confirmPapers(user, await readBody(req)) });
    if (req.method === 'POST' && route === '/bank/start') return json(res, 200, await startBankLink(user, await readBody(req)));
    if (req.method === 'POST' && route === '/bank/verify') return json(res, 200, await verifyBankLink(user, await readBody(req)));
    if (req.method === 'POST' && route === '/bank/fetch') return json(res, 200, await fetchBankLink(user, await readBody(req)));
    if (req.method === 'POST' && route === '/phone') return json(res, 200, { user: await changePhone(user, await readBody(req)) });
    if (req.method === 'POST' && route === '/call') return json(res, 201, { call: await requestCall(user, await readBody(req)) });
    if (req.method === 'POST' && route === '/call/cancel') return json(res, 200, { call: await cancelCall(user) });
    if (req.method === 'POST' && route === '/call/confirm') return json(res, 200, { user: await confirmCall(user, await readBody(req)) });
    if (req.method === 'POST' && route === '/onboarded') return json(res, 200, { user: await finishOnboarding(user) });
    throw fail(404, 'Not found');
  } catch (error) {
    if (!error.status) console.error(error);
    return json(res, error.status || 500, { type: 'about:blank', title: error.status ? error.message : 'Internal server error', status: error.status || 500 });
  }
}
