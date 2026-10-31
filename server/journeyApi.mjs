// The journey API. One turn: language in, translation in, orchestrator, translation
// out behind the figures fence, then the receipt is sealed with what was really said.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSession, greeting, LANGUAGE_LABELS, takeTurn } from '../src/journeys/orchestrator.js';
import { sealPassport, verifyChain } from '../src/journeys/passport.js';
import { detectLanguage, scriptLanguage } from '../src/engine/languageDetect.js';
import { isoDate } from '../src/journeys/money.js';
import { packStamp, PACKS } from '../src/journeys/policyPacks.js';
import { clientId, modelRiskOpinion, modelToolCall, rateLimited, deepseekKey } from './aiProxy.mjs';
import { identifyLanguage, questionToEnglish, romanise, SARVAM_LANG, sarvamAvailable, translateFenced } from './sarvamServer.mjs';
import { newId, readStore, updateStore } from './store.mjs';
import { bump, recordTurn } from './ops.mjs';
import { buildLevel, gradeQuiz, levelFromCard, levelIds } from '../src/journeys/game/loanGame.js';
import { gradeDeck, SCAM_DECK } from '../src/journeys/game/scamDeck.js';
import { defaultScene, gradeScene, sceneFromGap } from '../src/journeys/game/termScene.js';
import { explainDeductions } from '../src/journeys/engines/claims.js';
import { CLAIM, POLICY_WORDING } from '../src/journeys/sampleData.js';
import { interpretLoanDocument, readBackLine } from '../src/journeys/documentRead.js';
import { fingerprint, MAX_DOCUMENT_BYTES, readIncomeDocument, readLoanDocument } from './documents.mjs';
import { applyEdits, incomeReadBackLine, interpretIncomeDocument, profileFromDocuments } from '../src/journeys/incomeRead.js';
import { grantConsent, recordFact } from '../src/journeys/consent.js';
import { carriedIncome, carriedSpoken, customerFor, saveIncomeToAccount, userFromRequest } from './accounts.mjs';
import { fetchStatements, linkLine, startLink, verifyLink } from './bankLink.mjs';
import { agentSpeaker, checkPromises, findPromisesByRules, promiseLine } from '../src/journeys/engines/promises.js';
import { freeLookStatus } from '../src/journeys/engines/insurance.js';
import { INSURANCE_PLANS, ISSUED_POLICY, LOAN_OFFERS } from '../src/journeys/sampleData.js';
import { englishFor, findPromises, MAX_CALL_BYTES, transcribeCall } from './callCheck.mjs';
import { paytmForSession } from './paytmProfile.mjs';
import { fileForensics } from './documentForensics.mjs';
import { checkIncomeDocuments, checkLine, checkLoanDocument, checksCarried } from '../src/journeys/engines/docCheck.js';

const DATA_DIR = path.resolve(process.env.MITRA_DATA_DIR || path.join(process.cwd(), '.data'));
const KEY_FILE = path.join(DATA_DIR, 'passport-signing-key.pem');
const sessions = new Map();
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
// Lets the voice cache be warmed the night before with the date of the demo.
const clockNow = () => (process.env.MITRA_NOW ? Date.parse(process.env.MITRA_NOW) : Date.now());

// ── signing key ─────────────────────────────────────────────────
// Created once and kept outside git. In production this would live in an HSM.
function loadSigningKey() {
  try { return createPrivateKey(readFileSync(KEY_FILE, 'utf8')); } catch { /* first run */ }
  const { privateKey } = generateKeyPairSync('ed25519');
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  return privateKey;
}
const privateKey = loadSigningKey();
const publicKey = createPublicKey(privateKey);
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const signHash = (hash) => sign(null, Buffer.from(hash), privateKey).toString('base64');
const verifyHash = (hash, signature) => {
  try { return Boolean(signature) && verify(null, Buffer.from(hash), publicKey, Buffer.from(signature, 'base64')); } catch { return false; }
};

// ── http helpers ────────────────────────────────────────────────
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
const problem = (res, status, title) => json(res, status, { type: 'about:blank', title, status });

async function readBody(req, limit = 2_000_000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw Object.assign(new Error('Request is too large'), { status: 413 });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Request body must be valid JSON'), { status: 400 }); }
}

// ── sessions ────────────────────────────────────────────────────
// Sessions live in memory and reach disk in batches, at most a quarter second behind.
// One JSON file rewritten per turn cost 1.6 s at 50 callers. A real deployment swaps
// this for Postgres: nothing above this function knows the difference.
const dirty = new Map();
let flushTimer = null;
const FLUSH_MS = 250;
const MAX_IN_MEMORY = 5000;

export async function flushSessions() {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (!dirty.size) return;
  const batch = [...dirty.values()];
  dirty.clear();
  await updateStore((db) => {
    db.journeySessions ||= {};
    for (const session of batch) db.journeySessions[session.id] = session;
    const ids = Object.keys(db.journeySessions);
    for (const id of ids.slice(0, Math.max(0, ids.length - 200))) delete db.journeySessions[id];
  }).catch((error) => console.error('Could not save journey sessions', error));
}

const persist = async (session) => {
  dirty.set(session.id, session);
  while (sessions.size > MAX_IN_MEMORY) sessions.delete(sessions.keys().next().value);
  flushTimer ||= setTimeout(flushSessions, FLUSH_MS);
};

async function findSession(id) {
  if (sessions.has(id)) return sessions.get(id);
  const stored = await readStore((db) => db.journeySessions?.[id] || null);
  if (stored?.erasedAt) throw Object.assign(new Error('This journey was erased at the customer’s request'), { status: 410 });
  if (stored) sessions.set(id, stored);
  return stored;
}

// The customer's right to erasure. What stays is a tombstone: when, how many receipts
// and the last hash, so an auditor can see that a record existed and was removed.
async function eraseSession(session) {
  dirty.delete(session.id);
  const tombstone = { id: session.id, erasedAt: new Date().toISOString(), receipts: session.chain.length, lastHash: session.chain.at(-1)?.hash || null };
  sessions.delete(session.id);
  await updateStore((db) => { db.journeySessions ||= {}; db.journeySessions[session.id] = tombstone; });
  bump('erasures');
  return tombstone;
}

const RETENTION_DAYS = Number(process.env.MITRA_RETENTION_DAYS || 30);
export async function sweepOldSessions(now = Date.now()) {
  await flushSessions();
  const cutoff = now - RETENTION_DAYS * 86_400_000;
  let removed = 0;
  await updateStore((db) => {
    for (const [id, session] of Object.entries(db.journeySessions || {})) {
      const at = Date.parse(session.erasedAt || session.startedAt || 0);
      if (at && at < cutoff) { delete db.journeySessions[id]; sessions.delete(id); removed += 1; }
    }
  });
  return removed;
}
setInterval(() => sweepOldSessions().catch(() => {}), 6 * 3_600_000).unref();

const deskAllowed = (req) => !process.env.MITRA_DESK_TOKEN || req.headers['x-desk-token'] === process.env.MITRA_DESK_TOKEN;

let passportCount = 0;
function passportId(now) {
  const today = isoDate(now);
  return `JP-${today.slice(2, 4)}-${today.slice(5).replace('-', '')}-${String(++passportCount).padStart(4, '0')}`;
}

async function seal(session, descriptor, { now, turn = {}, said = {}, agent, tool, channel }) {
  const payload = {
    id: passportId(now), issuedAt: new Date(now).toISOString(), customer: session.customer.name, channel: channel || session.channel,
    journey: descriptor.title,
    language: { code: session.lang, label: LANGUAGE_LABELS[session.lang] || 'English', method: turn.langMethod || 'Not applicable', confidence: turn.langConfidence ?? null },
    aiDisclosed: true,
    asked: turn.text ? { original: turn.text, english: turn.textEn } : null,
    said: said.english ? { english: said.english, native: said.native, figuresChecked: said.figuresChecked ?? null, linesRejected: said.linesRejected ?? 0 } : null,
    agent, tool,
    evidence: descriptor.evidence || [], formula: descriptor.formula || 'No formula', result: descriptor.result || '',
    policyPack: descriptor.pack || null, consent: descriptor.consent || [], action: descriptor.action || 'Explained, not executed',
  };
  return sealPassport(session.chain, payload, { sha256, sign: signHash });
}

function publicState(session) {
  return {
    sessionId: session.id, customer: { id: session.customerId, name: session.customer.name, kind: session.customer.kind },
    channel: session.channel, lang: session.lang, langLabel: LANGUAGE_LABELS[session.lang] || 'English',
    stage: session.stage, stagesReached: session.stagesReached, consents: session.consents, reminders: session.reminders,
    understanding: session.understanding || [], handoffs: session.handoffs, chain: session.chain, metrics: session.metrics, notifications: session.notifications || [],
    messages: session.messages.slice(-40), lastCard: session.lastCard || null, lastTrace: session.lastTrace || [], lastChips: session.lastChips || [],
    explained: session.explained, facts: Object.fromEntries(Object.entries(session.facts).map(([field, fact]) => [field, { collectedBy: fact.collectedBy, collectedOn: fact.collectedOn }])),
    pending: session.pending ? { mode: session.pending.mode, need: session.pending.need || null } : null,
  };
}

// ── one turn ────────────────────────────────────────────────────
async function understand(input, session, trace, { modelOff }) {
  const text = String(input.text || '').trim();
  if (input.spoken?.lang) {
    trace.push({ kind: 'stt', label: `Saaras heard ${LANGUAGE_LABELS[input.spoken.lang] || input.spoken.lang}`, detail: `Detected automatically, ${Number(input.spoken.confidence || 0).toFixed(2)} confidence`, ok: true });
  }
  let lang = input.spoken?.lang || null;
  let method = input.spoken?.lang ? 'Detected automatically' : 'Script of the typed text';
  const confidence = input.spoken?.confidence ?? null;
  const voice = sarvamAvailable() && !modelOff;

  // "Yes", "ok" or "45,000" says nothing about the caller's language, and people
  // mix English words into every Indian language. Only a real English sentence
  // moves a call to English.
  const latin = scriptLanguage(text) === 'latin';
  const words = text.split(/\s+/).filter(Boolean).length;
  const tooShortToSwitch = latin && session.lang !== 'en' && (words < 4 || (/\d/.test(text) && words <= 6));
  if (tooShortToSwitch && (!lang || lang === 'en')) {
    trace.push({ kind: 'translate', label: `Short answer, staying in ${LANGUAGE_LABELS[session.lang]}`, detail: 'A few English words do not change the language of the call', ok: true });
    return { text, textEn: text, lang: session.lang, langMethod: 'Stayed with the language of the call', langConfidence: null };
  }

  if (!lang) {
    if (input.tapped) return { text, textEn: text, lang: session.lang, langMethod: 'Tapped option', langConfidence: null, tapped: true };
    if (voice) {
      const found = await detectLanguage(text, { identify: identifyLanguage }).catch(() => ({ lang: 'en' }));
      lang = found.lang;
    } else {
      const script = scriptLanguage(text);
      lang = script === 'latin' ? 'en' : script === 'deva' ? 'hi' : script;
    }
  }

  if (lang === 'en' || !voice) {
    if (lang !== 'en') trace.push({ kind: 'translate', label: 'Translation is off', detail: 'Matching on the original words only', ok: false });
    return { text, textEn: text, lang: voice || ['en', 'hi'].includes(lang) ? lang : 'en', langMethod: method, langConfidence: confidence };
  }
  const started = Date.now();
  try {
    const out = await questionToEnglish(text, lang);
    trace.push({ kind: 'translate', label: `${SARVAM_LANG[lang] ? 'Mayura' : 'Sarvam Translate'} translated the question`, detail: `“${out.text}”`, ms: Date.now() - started, ok: true });
    return { text, textEn: out.text, lang, langMethod: method, langConfidence: confidence };
  } catch (error) {
    trace.push({ kind: 'translate', label: 'Translation failed', detail: error.message, ms: Date.now() - started, ok: false });
    return { text, textEn: text, lang, langMethod: method, langConfidence: confidence };
  }
}

async function speakBack(result, session, trace, { modelOff, chaos }) {
  const english = result.reply;
  if (session.lang === 'en') return { english, native: english, figuresChecked: null, linesRejected: 0, voiceLang: 'en' };
  if (modelOff || !sarvamAvailable()) {
    // Guided fallback: hand-written Hindi where it exists, otherwise English.
    const hindi = session.lang === 'hi' && result.replyHi;
    trace.push({ kind: 'translate', label: hindi ? 'Hand-written Hindi, no model used' : 'Model off: replying in English', detail: 'Engines and receipts keep working', ok: true });
    return { english, native: hindi || english, figuresChecked: null, linesRejected: 0, voiceLang: hindi ? 'hi' : 'en' };
  }
  const started = Date.now();
  try {
    const out = await translateFenced(english, session.lang, { corrupt: chaos === 'mistranslate' });
    const figures = out.lines.flatMap((line) => line.figures);
    const rejected = out.lines.filter((line) => line.rejected);
    for (const line of rejected) {
      const attempt = line.attempts.find((item) => item.missing?.length) || line.attempts[0];
      trace.push({ kind: 'fence', label: 'Sentence rejected: a figure changed in translation', detail: `Expected ${attempt?.missing?.join(', ') || '?'}, got ${attempt?.added?.join(', ') || 'nothing'}. Kept in English: “${line.english}”`, ok: false });
    }
    trace.push({ kind: 'fence', label: rejected.length ? `${out.lines.length - rejected.length} of ${out.lines.length} sentences passed the figure check` : figures.length ? `All ${figures.length} figures survived translation` : 'Translated. No figures in this reply', detail: figures.join(', ') || 'Nothing to check', ms: Date.now() - started, ok: !rejected.length, figures });
    return { english, native: out.native, figuresChecked: figures, linesRejected: rejected.length, voiceLang: session.lang, onScreenOnly: !SARVAM_LANG[session.lang] };
  } catch (error) {
    trace.push({ kind: 'fence', label: 'Translation failed, replying in English', detail: error.message, ms: Date.now() - started, ok: false });
    return { english, native: english, figuresChecked: null, linesRejected: 0, voiceLang: 'en' };
  }
}

export async function runTurn(session, input) {
  const now = clockNow();
  const turnStarted = Date.now();
  const trace = [];
  const modelOff = Boolean(input.modelOff);
  const turn = await understand(input, session, trace, { modelOff });
  const before = session.consents.length;
  const modelRoute = !modelOff && (deepseekKey() || sarvamAvailable()) ? modelToolCall : null;
  const result = await takeTurn(session, turn, { now, modelRoute, riskCheck: modelRoute ? modelRiskOpinion : null, modelOff });
  const allTrace = [...trace, ...(result.trace || [])];
  const said = await speakBack(result, session, allTrace, { modelOff, chaos: input.chaos });

  const sealed = [];
  const channel = input.channel;
  for (const grant of session.consents.slice(before)) {
    sealed.push(await seal(session, {
      title: 'Consent given', evidence: [{ field: 'Customer said', value: turn.text.slice(0, 200), source: 'Customer', asOf: grant.grantedOn }],
      formula: 'No formula: the customer’s own choice', result: `${grant.label}, until ${grant.expiresOn}`, pack: packStamp(PACKS.privacy), action: 'Recorded, not executed',
      consent: [{ id: grant.id, purpose: grant.purpose, label: grant.label, expiresOn: grant.expiresOn, days: grant.days }],
    }, { now, turn, agent: 'onboarding', tool: 'record_consent', channel }));
  }
  if (result.passport) sealed.push(await seal(session, result.passport, { now, turn, said, agent: result.agent, tool: result.tool, channel }));
  if (result.handoff?.id && sealed.length) result.handoff.linkedPassport = sealed.at(-1).id;
  for (const passport of sealed) allTrace.push({ kind: 'seal', label: `Sealed ${passport.id}`, detail: `sha256 ${passport.hash.slice(0, 12)}…, linked to the receipt before it`, ok: true });

  session.lastCard = result.card ? { ...result.card, agent: result.agent, tool: result.tool, key: String(session.chain.length) } : session.lastCard;
  if (result.card?.type === 'loan') session.lastLoanCard = result.card.data;
  if (result.card?.type === 'gap') session.lastGap = result.card.data;
  session.lastTrace = allTrace;
  session.lastChips = result.chips || [];
  session.messages.push({ from: 'customer', native: turn.text, english: turn.textEn, lang: turn.lang, confidence: turn.langConfidence, at: now });
  session.messages.push({ from: 'mitra', native: said.native, english: said.english, lang: said.voiceLang, at: Date.now() });
  sessions.set(session.id, session);
  await persist(session);
  recordTurn({ ms: Date.now() - turnStarted, tool: result.tool, lang: said.voiceLang, blocked: said.linesRejected, figures: said.figuresChecked?.length || 0, routedBy: allTrace.some((event) => event.model) ? 'model' : 'rules' });

  return {
    customer: { native: turn.text, english: turn.textEn, lang: turn.lang, method: turn.langMethod, confidence: turn.langConfidence },
    reply: { native: said.native, english: said.english, lang: said.voiceLang, rejected: said.linesRejected },
    card: result.card ?? null, chips: result.chips || [], agent: result.agent, tool: result.tool, journey: result.journey,
    trace: allTrace, passports: sealed, handoff: result.handoff?.id ? result.handoff : null, state: publicState(session),
  };
}

export async function openSession({ customerId = 'ramesh', channel = 'call', user = null } = {}) {
  const now = clockNow();
  const session = createSession({ id: newId('jrn'), customerId: user ? user.customerId || user.id : customerId, customer: user ? customerFor(user) : null, channel, now });
  session.accountId = user && !user.demo ? user.id : null;
  // A shop's own Paytm records, or the labelled sample when Paytm is not connected.
  if (session.customer.kind === 'merchant') session.paytm = await paytmForSession({ now });
  // Papers confirmed at onboarding come with the account, under the consent given there.
  const carried = user ? carriedIncome(user, now) : null;
  let grant = null;
  if (carried) {
    recordFact(session, 'incomeProfile', carried.profile, { words: carried.consent.words, agent: 'lending', firstFor: 'lending', now });
    grant = grantConsent(session, 'affordability', { words: carried.consent.words, now });
    if (carried.consent.expiresOn < grant.expiresOn) grant.expiresOn = carried.consent.expiresOn;
  }
  const hello = greeting(session);
  const passport = await seal(session, hello.passport, { now, said: { english: hello.reply, native: hello.reply }, agent: hello.agent, tool: hello.tool, channel });
  const passports = [passport];
  const trace = [...hello.trace, { kind: 'seal', label: `Sealed ${passport.id}`, detail: `sha256 ${passport.hash.slice(0, 12)}…, the first receipt in this journey`, ok: true }];
  if (carried) {
    const stamp = await seal(session, {
      title: 'Income papers carried from onboarding',
      evidence: (carried.profile.documents || []).map((doc) => ({ field: doc.kindLabel, value: `sha256 ${doc.hash.slice(0, 32)}…`, source: doc.name, asOf: carried.profile.confirmedOn || isoDate(now) })),
      formula: 'Confirmed line by line by the customer at onboarding', result: `${carried.profile.monthCount} months, ${carried.profile.counted} a month counted`,
      pack: carried.profile.pack, action: 'Recorded, not executed',
      consent: [{ id: grant.id, purpose: grant.purpose, label: grant.label, expiresOn: grant.expiresOn, days: grant.days }],
    }, { now, agent: 'lending', tool: 'read_income_papers', channel });
    passports.push(stamp);
    trace.push({ kind: 'consent', label: 'Income papers from onboarding', detail: `Under consent ${grant.id}, until ${grant.expiresOn}. Not asked again.`, ok: true });
  }
  // What the customer told the onboarding call and confirmed on screen.
  const spoken = user ? carriedSpoken(user, now) : null;
  if (spoken) {
    const fields = ['income', 'dependants', 'existingLife', 'existingHealth'].filter((field) => spoken[field] != null);
    for (const field of fields) recordFact(session, field, spoken[field], { words: spoken.words, agent: 'insurance', firstFor: 'insurance', now });
    if (fields.length) {
      const said = grantConsent(session, 'insurance_needs', { words: spoken.words, now });
      if (spoken.expiresOn < said.expiresOn) said.expiresOn = spoken.expiresOn;
      passports.push(await seal(session, {
        title: 'Details carried from the onboarding call',
        evidence: fields.map((field) => ({ field, value: String(spoken[field]), source: 'Customer, on the onboarding call, confirmed on screen', asOf: spoken.confirmedOn })),
        formula: 'Heard by the voice agent, then checked and confirmed by the customer', result: `${fields.length} details carried`,
        pack: packStamp(PACKS.insurance), action: 'Recorded, not executed',
        consent: [{ id: said.id, purpose: said.purpose, label: said.label, expiresOn: said.expiresOn, days: said.days }],
      }, { now, agent: 'insurance', tool: 'onboarding_call', channel }));
      trace.push({ kind: 'consent', label: 'Details from the onboarding call', detail: `Under consent ${said.id}, until ${said.expiresOn}. Not asked again.`, ok: true });
    }
  }
  session.messages.push({ from: 'mitra', native: hello.reply, english: hello.reply, lang: 'en', at: now });
  sessions.set(session.id, session);
  await persist(session);
  return { session, opening: { reply: { native: hello.reply, english: hello.reply, lang: 'en' }, card: hello.card, chips: hello.chips, agent: hello.agent, tool: hello.tool, trace, passports, handoff: null, state: publicState(session) } };
}

// ── the customer's own document ─────────────────────────────────
function turnShape(session, { english, said, card = null, chips = [], trace = [], agent = 'lending', tool = 'read_document', passports = [] }) {
  return {
    customer: null, reply: { native: said.native, english, lang: said.voiceLang, rejected: said.linesRejected }, card, chips, agent, tool, journey: 'lending',
    trace, passports, handoff: null, state: publicState(session),
  };
}

async function readDocument(session, input) {
  const buffer = Buffer.from(String(input.data || ''), 'base64');
  if (!buffer.length) throw Object.assign(new Error('Send the document'), { status: 422 });
  const trace = [];
  const hash = fingerprint(buffer);
  const read = await readLoanDocument(buffer, { name: input.name, mime: input.mime });
  const doc = interpretLoanDocument(read, { hash, today: isoDate(clockNow()) });
  // Is the paper what it claims, and still current? A warning, never a block.
  const check = checkLoanDocument(read.result, { forensics: fileForensics(buffer, { mime: input.mime }), today: isoDate(clockNow()), holderName: session.customer.name });
  if (doc.usable) doc.offer.check = { verdict: check.verdict, headline: check.headline };
  const lowest = doc.rows.reduce((low, row) => (row.confidence != null ? Math.min(low, row.confidence) : low), 1);
  trace.push({ kind: 'vision', label: `Sarvam Vision read ${read.pages || 1} ${read.pages === 1 ? 'page' : 'pages'}`, detail: `${doc.rows.length} fields found, lowest confidence ${lowest.toFixed(2)}. sha256 ${hash.slice(0, 12)}…. The file is not stored.`, ms: read.ms, ok: true });
  for (const item of doc.checks || []) trace.push({ kind: 'engine', label: 'The engine does not agree with the page', detail: item.text, ok: false });
  trace.push({ kind: 'check', label: `Document check: ${check.headline}`, detail: check.flags.map((item) => item.text).join(' ') || check.passed.join(' ') || 'Nothing to check on this file', ok: check.verdict === 'clean' });
  if (doc.usable) session.pendingDocument = { offer: doc.offer, hash, name: String(input.name || 'document').slice(0, 80), rows: doc.rows, check };
  const english = `${readBackLine(doc)}${checkLine([{ kindLabel: 'Key Fact Statement', check }])}`;
  const said = await speakBack({ reply: english }, session, trace, {});
  session.lastChips = [];
  sessions.set(session.id, session);
  await persist(session);
  return turnShape(session, { english, said, trace, card: { type: 'document', data: { lender: doc.lender, rows: doc.rows, usable: doc.usable, checks: doc.checks || [], ms: read.ms, kind: doc.kind, missing: doc.missing, documentCheck: check }, key: `doc-${hash.slice(0, 6)}` }, chips: doc.usable ? [] : ['Talk to a person'] });
}

async function confirmDocument(session, { accept }) {
  const pending = session.pendingDocument;
  if (!pending) throw Object.assign(new Error('There is no document waiting'), { status: 409 });
  session.pendingDocument = null;
  if (!accept) {
    const english = 'Thank you for checking. I will not use those numbers. You can send a clearer copy, tell me the figures, or talk to a person.';
    const trace = [{ kind: 'vision', label: 'The customer rejected what was read', detail: 'Nothing from this document is used', ok: false }];
    const said = await speakBack({ reply: english }, session, trace, {});
    await persist(session);
    return turnShape(session, { english, said, trace, chips: ['Talk to a person', 'What does this loan really cost?'] });
  }
  session.documentOffer = pending.offer;
  session.lastLoanCard = null;
  const now = clockNow();
  const stamp = await seal(session, {
    title: 'Document read, and confirmed by the customer',
    evidence: [
      { field: 'Document fingerprint', value: `sha256 ${pending.hash.slice(0, 32)}…`, source: pending.name, asOf: isoDate(now) },
      ...(pending.check ? [{ field: 'Document check', value: `${pending.check.headline}${pending.check.flags.length ? `: ${pending.check.flags.map((item) => item.label).join(', ')}` : ''}`, source: pending.check.pack.label, asOf: isoDate(now) }] : []),
      ...pending.rows.map((row) => ({ field: row.label, value: row.value, source: row.page ? `Page ${row.page}` : 'Document', asOf: isoDate(now) })),
    ],
    formula: 'Read by Sarvam Vision. Every figure confirmed by the customer before use', result: `${pending.rows.length} fields confirmed`, pack: packStamp(PACKS.privacy), action: 'Recorded, not executed',
  }, { now, agent: 'lending', tool: 'read_document' });
  const turn = await runTurn(session, { text: 'What does this loan really cost?', tapped: true });
  turn.passports = [stamp, ...turn.passports];
  turn.trace = [{ kind: 'seal', label: `Sealed ${stamp.id}`, detail: 'The figures the customer confirmed', ok: true }, ...turn.trace];
  return turn;
}

// ── the customer's income papers ────────────────────────────────
// Bank statements, UPI receipts and tax returns, read together. Nothing is used until
// the customer has seen every line, unticked what is not theirs, and confirmed.
const MAX_INCOME_FILES = 5;
const MAX_INCOME_BYTES = 15_000_000;

async function readIncome(session, input) {
  const files = Array.isArray(input.files) ? input.files.slice(0, MAX_INCOME_FILES) : [];
  const buffers = files.map((file) => ({ ...file, buffer: Buffer.from(String(file?.data || ''), 'base64') })).filter((file) => file.buffer.length);
  if (!buffers.length) throw Object.assign(new Error('Send at least one document'), { status: 422 });
  if (buffers.reduce((total, file) => total + file.buffer.length, 0) > MAX_INCOME_BYTES) throw Object.assign(new Error('Those files are larger than 15 MB together'), { status: 413 });
  const trace = [];
  const started = Date.now();
  const docs = await Promise.all(buffers.map(async (file) => {
    const hash = fingerprint(file.buffer);
    const name = String(file.name || 'document').slice(0, 80);
    try {
      const read = await readIncomeDocument(file.buffer, { name, mime: file.mime });
      const doc = interpretIncomeDocument(read, { hash, name });
      const lines = doc.transactions.length || doc.receipts.length || doc.declared.length;
      trace.push({ kind: 'vision', label: `Sarvam Vision read ${name}`, detail: `${doc.kindLabel}, ${lines} ${lines === 1 ? 'figure' : 'lines'} found. sha256 ${hash.slice(0, 12)}…. The file is not stored.`, ms: read.ms, ok: doc.usable });
      for (const problem of doc.problems) trace.push({ kind: 'vision', label: 'Left out, not guessed', detail: problem, ok: false });
      return doc;
    } catch (error) {
      trace.push({ kind: 'vision', label: `Could not read ${name}`, detail: error.message, ok: false });
      return { kind: 'other', kindLabel: 'Could not be read', hash, name, transactions: [], receipts: [], declared: [], problems: [error.message], usable: false };
    }
  }));
  const usable = docs.filter((doc) => doc.usable);
  // Each paper checked on its own and against the others. A warning, never a block.
  const forensics = Object.fromEntries(buffers.map((file) => [fingerprint(file.buffer), fileForensics(file.buffer, { mime: file.mime })]));
  checkIncomeDocuments(usable, { forensics, today: isoDate(clockNow()), holderName: session.customer.name }).forEach((check, index) => {
    usable[index].check = check;
    trace.push({ kind: 'check', label: `${usable[index].name}: ${check.headline}`, detail: check.flags.map((item) => item.text).join(' ') || check.passed.join(' ') || 'Nothing to check on this file', ok: check.verdict === 'clean' });
  });
  if (usable.length) {
    // A first look, before any edits, so the customer sees what the papers add up to.
    const preview = profileFromDocuments(usable);
    trace.push({ kind: 'engine', label: 'Income engine sorted every line', detail: `${preview.streams.map((stream) => `${stream.label} ${stream.monthly}/month`).join(', ') || 'No income lines'}. ${preview.excluded.length} not counted as income${preview.receipts.duplicates ? `, ${preview.receipts.duplicates} receipt already on the statement` : ''}`, ms: Date.now() - started, ok: true });
  }
  session.pendingIncome = usable.length ? { docs: usable } : null;
  const english = `${incomeReadBackLine(docs)}${checkLine(usable)}`;
  const said = await speakBack({ reply: english }, session, trace, {});
  session.lastChips = [];
  sessions.set(session.id, session);
  await persist(session);
  return turnShape(session, {
    english, said, trace, tool: 'read_income_papers',
    card: { type: 'incomeRead', data: { docs: usable, failed: docs.filter((doc) => !doc.usable).map((doc) => ({ name: doc.name, kindLabel: doc.kindLabel, problems: doc.problems })), ms: Date.now() - started }, key: `income-${usable.map((doc) => doc.hash.slice(0, 4)).join('')}` },
    chips: usable.length ? [] : ['My monthly income is ₹45,000', 'Talk to a person'],
  });
}

async function confirmIncome(session, { accept, edits }) {
  const pending = session.pendingIncome;
  if (!pending) throw Object.assign(new Error('There are no income papers waiting'), { status: 409 });
  session.pendingIncome = null;
  if (!accept) {
    const english = 'Thank you for checking. I will not use those papers. You can send clearer copies, tell me your monthly income, or talk to a person.';
    const trace = [{ kind: 'vision', label: 'The customer rejected what was read', detail: 'Nothing from these papers is used', ok: false }];
    const said = await speakBack({ reply: english }, session, trace, {});
    await persist(session);
    return turnShape(session, { english, said, trace, tool: 'read_income_papers', chips: ['Talk to a person', 'What does this loan really cost?'] });
  }
  const now = clockNow();
  const { docs, changed } = applyEdits(pending.docs, edits);
  const profile = profileFromDocuments(docs);
  if (!profile.monthCount && profile.basis !== 'declared') throw Object.assign(new Error('Nothing is left to count once those lines are unticked'), { status: 422 });
  // A warning on a paper stays with every answer worked out from it.
  profile.checks = checksCarried(docs);
  recordFact(session, 'incomeProfile', profile, { words: 'Confirmed on screen, line by line', agent: 'lending', firstFor: 'lending', now });
  const linked = docs.filter((doc) => doc.via === 'aa');
  const words = linked.length ? `Linked ${linked[0].bank} through an Account Aggregator, then confirmed the statement line by line` : 'Uploaded income papers and confirmed them on screen';
  const grant = grantConsent(session, 'affordability', { words, now });
  if (session.accountId) await saveIncomeToAccount(session.accountId, { profile, linked, words }).catch((error) => console.error('Could not save income to the account', error.message));
  const stamp = await seal(session, {
    title: 'Income papers read, and confirmed by the customer',
    evidence: [
      ...profile.documents.map((doc) => ({ field: doc.kindLabel, value: `sha256 ${doc.hash.slice(0, 32)}…`, source: doc.name, asOf: isoDate(now) })),
      ...docs.filter((doc) => doc.check).map((doc) => ({ field: 'Document check', value: `${doc.name}: ${doc.check.headline}`, source: doc.check.pack.label, asOf: isoDate(now) })),
      ...profile.months.map((month) => ({ field: month.label, value: `${month.net} counted`, source: 'Lines the customer kept', asOf: isoDate(now) })),
      { field: 'Corrections by the customer', value: String(changed), source: 'Customer', asOf: isoDate(now) },
    ],
    formula: 'Read by Sarvam Vision. Every line shown to the customer, who unticked or corrected it before use', result: `${profile.monthCount} months, ${profile.counted} a month counted`,
    pack: profile.pack, action: 'Recorded, not executed',
    consent: [{ id: grant.id, purpose: grant.purpose, label: grant.label, expiresOn: grant.expiresOn, days: grant.days }],
  }, { now, agent: 'lending', tool: 'read_income_papers' });
  const turn = await runTurn(session, { text: 'Can I afford this loan?', tapped: true });
  turn.passports = [stamp, ...turn.passports];
  turn.trace = [{ kind: 'seal', label: `Sealed ${stamp.id}`, detail: `The lines the customer confirmed${changed ? `, with ${changed} ${changed === 1 ? 'correction' : 'corrections'}` : ''}. Consent ${grant.id}`, ok: true }, ...turn.trace];
  return turn;
}

// ── linking a bank on a call (Account Aggregator, sandbox) ──────
// The same consent, OTP and account choice as onboarding. The statement arrives as
// data, waits for the customer to check it like any paper, then confirmIncome runs.
function linkUserFor(session, user) {
  return {
    id: user?.id || `${session.customerId}:${session.id}`, name: session.customer.name, phone: user?.phone || null,
    work: user?.work || (session.customer.kind === 'merchant' ? 'shop' : 'gig'),
  };
}

async function startBank(session, user, { bankId, consent }) {
  if (consent !== true) throw Object.assign(new Error('Agree to how your statement is used first'), { status: 422 });
  const linkUser = linkUserFor(session, user);
  const { pending, reply } = startLink(linkUser, bankId);
  session.pendingLink = { ...pending, userId: linkUser.id };
  await persist(session);
  return { ...reply, sentTo: user?.phone ? `+91 ••••• ${user.phone.slice(-5)}` : 'your registered mobile' };
}

async function verifyBank(session, user, body) {
  try {
    return { accounts: verifyLink(linkUserFor(session, user), session.pendingLink, body) };
  } finally { await persist(session); }
}

async function fetchBank(session, user, { handle, accounts }) {
  if (session.pendingLink?.handle !== handle) throw Object.assign(new Error('Start linking your bank again'), { status: 409 });
  const started = Date.now();
  const docs = fetchStatements(linkUserFor(session, user), session.pendingLink, accounts);
  session.pendingLink = null;
  session.pendingIncome = { docs };
  const trace = [
    { kind: 'consent', label: `Consent approved for ${docs[0].bank}`, detail: 'One purpose, last 6 months, fetched once, kept 30 days. OTP verified.', ok: true },
    ...docs.map((doc) => ({ kind: 'vision', label: `Account Aggregator (sandbox) shared ${doc.account}`, detail: `${doc.transactions.length} lines from ${doc.bank}. No file, no password, no money movement.`, ms: Date.now() - started, ok: true })),
  ];
  const preview = profileFromDocuments(docs);
  trace.push({ kind: 'engine', label: 'Income engine sorted every line', detail: `${preview.streams.map((stream) => `${stream.label} ${stream.monthly}/month`).join(', ') || 'No income lines'}. ${preview.excluded.length} not counted as income`, ok: true });
  const english = linkLine(docs);
  const said = await speakBack({ reply: english }, session, trace, {});
  session.lastChips = [];
  sessions.set(session.id, session);
  await persist(session);
  return turnShape(session, {
    english, said, trace, tool: 'link_bank',
    card: { type: 'incomeRead', data: { docs, failed: [], ms: Date.now() - started }, key: `bank-${docs.map((doc) => doc.hash.slice(0, 4)).join('')}` },
  });
}

// ── promise check ───────────────────────────────────────────────
async function promiseCheck(session, input) {
  const buffer = Buffer.from(String(input.data || ''), 'base64');
  if (!buffer.length) throw Object.assign(new Error('Send the recording'), { status: 422 });
  const now = clockNow();
  const trace = [];
  const hash = fingerprint(buffer);
  const heard = await transcribeCall(buffer, { mime: input.mime });
  const speakers = new Set(heard.turns.map((turn) => turn.speaker)).size;
  trace.push({ kind: 'stt', label: `Saaras separated ${speakers} ${speakers === 1 ? 'voice' : 'voices'} on the call`, detail: `${heard.turns.length} turns. sha256 ${hash.slice(0, 12)}…. The audio is not stored by MITRA.`, ms: heard.ms, ok: true });

  // The model only labels sentences. Each quote is checked against the transcript.
  let agent = agentSpeaker(heard.turns);
  let found = [];
  const started = Date.now();
  try {
    const out = await findPromises(heard.turns);
    if (heard.turns.some((turn) => turn.speaker === out.agent)) agent = out.agent;
    found = out.promises;
    trace.push({ kind: 'route', label: `Sarvam-105B found ${found.length} promises`, detail: 'Each must be an exact quote from the agent, or it is dropped', ms: Date.now() - started, ok: true, model: true });
  } catch (error) {
    trace.push({ kind: 'route', label: 'No model available: rules looked for promises', detail: error.message, ok: false });
  }
  const agentTurns = await Promise.all(heard.turns.map(async (turn) => (turn.speaker === agent ? { ...turn, english: await englishFor(turn.text) } : turn)));
  if (!found.length) found = findPromisesByRules(agentTurns.filter((turn) => turn.english)).map((item) => ({ kind: item.kind, quote: item.quote }));

  const offer = session.documentOffer || LOAN_OFFERS['KFS-v3-0412'];
  const plan = INSURANCE_PLANS.find((item) => item.name === ISSUED_POLICY.name);
  const result = checkPromises(found, agentTurns, agent, { offer, plan, policyFreeLook: freeLookStatus(ISSUED_POLICY, { today: isoDate(now) }) });
  trace.push({ kind: 'engine', label: `The engine compared ${result.total} promises with the papers`, detail: `${result.broken} do not match`, ok: !result.broken });

  const english = promiseLine(result);
  const passport = await seal(session, {
    title: 'Promise Check: what the agent said, against the papers',
    evidence: [{ field: 'Call fingerprint', value: `sha256 ${hash.slice(0, 32)}…`, source: String(input.name || 'recording').slice(0, 80), asOf: isoDate(now) }, ...result.rows.map((row) => ({ field: row.label, value: `“${row.quote}” → ${row.verdict}`, source: row.source, asOf: isoDate(now) }))],
    formula: 'Each promise is an exact quote from the transcript. The paper decides, not a model', result: `${result.broken} of ${result.total} promises do not match`, pack: result.pack, action: 'Recorded, not executed',
  }, { now, agent: 'insurance', tool: 'promise_check' });
  trace.push({ kind: 'seal', label: `Sealed ${passport.id}`, detail: 'Evidence the customer can show the ombudsman', ok: true });
  const said = await speakBack({ reply: english }, session, trace, {});
  session.messages.push({ from: 'mitra', native: said.native, english, lang: said.voiceLang, at: now });
  session.explained.push(`Promise Check: ${result.broken} of ${result.total} promises did not match the papers`);
  sessions.set(session.id, session);
  await persist(session);
  return turnShape(session, {
    english, said, trace, passports: [passport], agent: 'insurance', tool: 'promise_check',
    card: { type: 'promises', data: { ...result, turns: agentTurns.map(({ index, speaker, text, start }) => ({ index, speaker, text, start })), agent, ms: heard.ms }, key: `promises-${hash.slice(0, 6)}` },
    chips: result.broken ? ['Talk to a person', 'Show me this loan as a game'] : ['What does this loan really cost?'],
  });
}

// ── learn by playing ────────────────────────────────────────────
// Lines for the games go through the same figures fence as anything said on a call.
async function translateGameLines(lang, lines) {
  const entries = Object.entries(lines).slice(0, 60);
  const out = {};
  let at = 0;
  const worker = async () => {
    while (at < entries.length) {
      const [key, value] = entries[at++];
      const text = String(value).slice(0, 400);
      if (!/\p{L}/u.test(text)) { out[key] = text; continue; }
      try {
        let fenced = await translateFenced(text, lang);
        // Rate limited on a first visit to a language: wait a moment and ask once more.
        if (fenced.lines.some((line) => line.attempts.some((attempt) => /429/.test(attempt.error || '')))) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          fenced = await translateFenced(text, lang);
        }
        out[key] = fenced.native;
      } catch { out[key] = text; }
    }
  };
  await Promise.all([worker(), worker()]);
  return out;
}

// What the customer understood, graded here and sealed. It blocks nothing: it is
// evidence for the customer and the lender that the terms were really understood.
async function sealUnderstanding(session, input) {
  const now = clockNow();
  let grade, title, evidence;
  if (input.game === 'scam') {
    const answers = Array.isArray(input.answers) ? input.answers.slice(0, SCAM_DECK.length) : [];
    grade = gradeDeck(answers);
    title = 'Scam Shield: payment safety check';
    evidence = grade.rows.map((row) => ({ field: row.id, value: row.correct ? 'Decided correctly' : 'Decided wrongly', source: 'Offer X-Ray engine', asOf: isoDate(now) }));
  } else if (input.game === 'claim') {
    const analysis = explainDeductions({ claim: CLAIM, wording: POLICY_WORDING });
    const marked = Array.isArray(input.answers) ? input.answers.map(String) : [];
    const rows = analysis.lines.map((line) => ({ id: line.id, correct: marked.includes(line.id) === (line.status === 'looks-wrong') }));
    grade = { rows, correct: rows.filter((row) => row.correct).length, total: rows.length };
    title = 'Claim Detective: deductions understood';
    evidence = analysis.lines.map((line) => ({ field: line.head, value: rows.find((row) => row.id === line.id).correct ? 'Judged correctly' : 'Judged wrongly', source: analysis.claimId, asOf: analysis.settledOn }));
  } else if (input.game === 'karz') {
    const id = levelIds().includes(input.level) ? input.level : 'personal';
    const level = id === 'personal' && session.lastLoanCard ? levelFromCard(session.lastLoanCard) : buildLevel(id);
    grade = gradeQuiz(level, input.answers);
    title = `Karz Yatra: ${level.title} understood`;
    evidence = grade.rows.map((row) => ({ field: row.question, value: `${row.chosen ?? 'Not answered'}${row.correct ? ', correct' : `, the answer is ${row.right}`}`, source: 'Computed from the loan', asOf: isoDate(now) }));
  } else if (input.game === 'term') {
    const scene = session.lastGap?.life && activeConsent(session, 'insurance_needs', now) ? sceneFromGap(session.lastGap) : defaultScene();
    grade = gradeScene(scene, input.answers);
    title = 'Kal Ka Ghar: what a term plan does';
    evidence = grade.rows.map((row) => ({ field: row.question, value: `${row.chosen ?? 'Not answered'}${row.correct ? ', correct' : `, the answer is ${row.right}`}`, source: 'Same protection-gap engine as the call', asOf: isoDate(now) }));
  } else throw Object.assign(new Error('Unknown game'), { status: 422 });
  const packForGame = { scam: PACKS.payments, claim: PACKS.claims, term: PACKS.insurance, karz: PACKS.lending };
  const passport = await seal(session, {
    title, evidence, formula: 'Graded on the server from the same engines as the call', result: `${grade.correct} of ${grade.total} understood`,
    pack: packStamp(packForGame[input.game] || PACKS.lending), action: 'Recorded. It blocks nothing and signs nothing.',
  }, { now, agent: 'orchestrator', tool: 'understanding_check', channel: 'game' });
  session.understanding = [...(session.understanding || []), { game: input.game, correct: grade.correct, total: grade.total, passportId: passport.id, at: new Date(now).toISOString() }];
  bump('understandingChecks');
  sessions.set(session.id, session);
  await persist(session);
  return { grade, passport, state: publicState(session) };
}

// ── the expert's desk ───────────────────────────────────────────
const OUTCOMES = {
  resolved: { title: 'Resolved by the expert', action: 'Resolved by a person', say: (notes) => `The expert has looked at your question. ${notes}` },
  routed: { title: 'Routed to the lender or insurer', action: 'Routed to the partner', say: (notes) => `The expert has passed this to the partner and I am tracking it. ${notes}` },
  grievance: { title: 'Grievance raised', action: 'Grievance raised with the partner', say: (notes) => `A grievance has been raised with the evidence. If it is not settled, I will explain how to go to the Ombudsman. ${notes}` },
  walked: { title: 'Customer walked away', action: 'Closed, nothing executed', say: (notes) => `Closed, as you asked, with no pressure. ${notes}` },
};

export async function resolveHandoff(briefId, { outcome, notes = '' }) {
  const spec = OUTCOMES[outcome];
  if (!spec) throw Object.assign(new Error('Unknown outcome'), { status: 422 });
  const session = [...sessions.values()].find((item) => item.handoffs.some((brief) => brief.id === briefId));
  if (!session) throw Object.assign(new Error('Unknown brief'), { status: 404 });
  const brief = session.handoffs.find((item) => item.id === briefId);
  const now = clockNow();
  const cleanNotes = String(notes).trim().slice(0, 1000);
  brief.status = 'closed';
  brief.outcome = outcome;
  brief.notes = cleanNotes;
  session.stage = 'resolve';
  if (!session.stagesReached.includes('resolve')) session.stagesReached.push('resolve');

  const english = spec.say(cleanNotes).trim();
  let native = english;
  let figuresChecked = null;
  if (session.lang !== 'en' && sarvamAvailable()) {
    try {
      const out = await translateFenced(english, session.lang);
      native = out.native;
      figuresChecked = out.lines.flatMap((line) => line.figures);
    } catch { /* the follow-up still goes out, in English */ }
  }
  const passport = await seal(session, {
    title: spec.title, evidence: [{ field: 'Brief', value: brief.id, source: 'Handoff brief', asOf: isoDate(now) }, ...(cleanNotes ? [{ field: 'Expert notes', value: cleanNotes, source: 'Human expert', asOf: isoDate(now) }] : [])],
    formula: 'No formula: decided by a person', result: spec.title, pack: packStamp(PACKS.privacy), action: spec.action,
  }, { now, said: { english, native, figuresChecked }, agent: 'human', tool: 'resolve_case' });
  session.notifications = [...(session.notifications || []), { id: passport.id, native, english, lang: session.lang, passportId: passport.id }];
  session.messages.push({ from: 'mitra', native, english, lang: session.lang, at: now });
  await persist(session);
  return { brief, passport, state: publicState(session) };
}

// ── routes ──────────────────────────────────────────────────────
const input_modelOff = (req) => req.headers['x-mitra-model-off'] === '1';

export async function handleJourney(req, res, url) {
  try {
    if (rateLimited(clientId(req), 'journey')) return problem(res, 429, 'Too many requests. Try again in a minute.');
    const parts = url.pathname.split('/').filter(Boolean).slice(2);

    if (req.method === 'GET' && parts[0] === 'phone-status') {
      const latest = [...sessions.values()].filter((item) => item.channel === 'phone').sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
      return json(res, 200, { latestSession: latest?.id || null, latestStartedAt: latest?.startedAt || null });
    }
    if (req.method === 'POST' && parts[0] === 'romanise') {
      const input = await readBody(req);
      if (!LANGUAGE_LABELS[input.lang] || typeof input.text !== 'string' || input.text.length > 1000) return problem(res, 422, 'Send the text and its language');
      if (input.lang === 'en' || !sarvamAvailable()) return json(res, 200, { roman: input.text });
      return json(res, 200, { roman: await romanise(input.text, input.lang) });
    }
    if (req.method === 'POST' && parts[0] === 'game' && parts[1] === 'translate') {
      const input = await readBody(req);
      if (!LANGUAGE_LABELS[input.lang] || !input.lines || typeof input.lines !== 'object') return problem(res, 422, 'Send a language and the lines');
      if (input.lang === 'en' || !sarvamAvailable()) return json(res, 200, { lines: input.lines });
      return json(res, 200, { lines: await translateGameLines(input.lang, input.lines) });
    }
    if (req.method === 'GET' && parts[0] === 'public-key') return json(res, 200, { algorithm: 'Ed25519', publicKey: publicKeyPem });

    if (req.method === 'POST' && parts[0] === 'session' && parts.length === 1) {
      const input = await readBody(req);
      const user = await userFromRequest(req);
      const { opening } = await openSession({ user, customerId: input.customerId, channel: ['call', 'app', 'soundbox', 'phone'].includes(input.channel) ? input.channel : 'call' });
      return json(res, 201, opening);
    }

    if (req.method === 'POST' && parts[0] === 'verify') {
      const input = await readBody(req, 5_000_000);
      if (!Array.isArray(input.chain)) return problem(res, 422, 'Send the chain as an array');
      return json(res, 200, await verifyChain(input.chain, { sha256, verifySignature: verifyHash }));
    }

    if (parts[0] === 'desk' && !deskAllowed(req)) return problem(res, 401, 'The expert desk needs a staff token');
    if (req.method === 'GET' && parts[0] === 'desk') {
      const briefs = [...sessions.values()].flatMap((session) => session.handoffs).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return json(res, 200, { briefs });
    }
    if (req.method === 'POST' && parts[0] === 'desk' && parts[2] === 'resolve') {
      return json(res, 200, await resolveHandoff(parts[1], await readBody(req)));
    }

    const session = parts[0] ? await findSession(parts[0]) : null;
    if (!session) return problem(res, 404, 'Journey not found');

    if (req.method === 'DELETE' && parts.length === 1) return json(res, 200, await eraseSession(session));
    if (req.method === 'GET' && parts[1] === 'state') return json(res, 200, publicState(session));
    if (req.method === 'POST' && parts[1] === 'turn') {
      const input = await readBody(req);
      if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 2000) return problem(res, 422, 'Send the customer’s words as text');
      return json(res, 200, await runTurn(session, input));
    }
    if (req.method === 'POST' && parts[1] === 'document' && parts.length === 2) {
      if (!sarvamAvailable() || input_modelOff(req)) return problem(res, 503, 'Reading documents needs Sarvam Vision, which is not available right now');
      return json(res, 200, await readDocument(session, await readBody(req, Math.ceil(MAX_DOCUMENT_BYTES * 1.4))));
    }
    if (req.method === 'POST' && parts[1] === 'document' && parts[2] === 'confirm') {
      return json(res, 200, await confirmDocument(session, await readBody(req)));
    }
    if (req.method === 'POST' && parts[1] === 'income' && parts.length === 2) {
      if (!sarvamAvailable() || input_modelOff(req)) return problem(res, 503, 'Reading documents needs Sarvam Vision, which is not available right now');
      return json(res, 200, await readIncome(session, await readBody(req, Math.ceil(MAX_INCOME_BYTES * 1.4))));
    }
    if (req.method === 'POST' && parts[1] === 'income' && parts[2] === 'confirm') {
      return json(res, 200, await confirmIncome(session, await readBody(req)));
    }
    if (req.method === 'POST' && parts[1] === 'bank' && ['start', 'verify', 'fetch'].includes(parts[2])) {
      if (parts[2] === 'verify' && rateLimited(clientId(req), 'auth')) return problem(res, 429, 'Too many attempts. Try again in a minute.');
      const user = await userFromRequest(req);
      const body = await readBody(req);
      if (parts[2] === 'start') return json(res, 200, await startBank(session, user, body));
      if (parts[2] === 'verify') return json(res, 200, await verifyBank(session, user, body));
      return json(res, 200, await fetchBank(session, user, body));
    }
    if (req.method === 'POST' && parts[1] === 'promise-check') {
      if (!sarvamAvailable() || input_modelOff(req)) return problem(res, 503, 'Listening to a call needs Saaras, which is not available right now');
      return json(res, 200, await promiseCheck(session, await readBody(req, Math.ceil(MAX_CALL_BYTES * 1.4))));
    }
    if (req.method === 'POST' && parts[1] === 'understanding') {
      return json(res, 201, await sealUnderstanding(session, await readBody(req)));
    }
    if (req.method === 'POST' && parts[1] === 'notifications' && parts[2] === 'seen') {
      session.notifications = [];
      await persist(session);
      return json(res, 200, { ok: true });
    }
    return problem(res, 404, 'Not found');
  } catch (error) {
    if (!error.status) console.error(error);
    return problem(res, error.status || 500, error.status ? error.message : 'Internal server error');
  }
}
