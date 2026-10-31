// The orchestrator: knows the journey, the language and the consent in force,
// and takes one turn at a time. It holds no model and no key. The model is passed
// in as a router and may be absent, in which case the rules still run and anything
// unplaced becomes a guided menu.
//
// A turn returns everything the API needs to speak and to seal a receipt. Sealing
// happens after translation, because the receipt records what was actually said.
import { AGENTS, TOOLS, purposeLine } from './tools.js';
import { modelInput, routeBroad, routeByRules, routeSafety, routeWithModel } from './router.js';
import { activeConsent, grantConsent, readFact, recordFact } from './consent.js';
import { CUSTOMERS, MERCHANT_SALES } from './sampleData.js';
import { assertGrounded, inr, isoDate, parseYesNo } from './money.js';
import { checkPaymentRequest, isOnlyAsking } from './engines/payments.js';
import { packStamp, PACKS } from './policyPacks.js';

export const LANGUAGE_LABELS = { en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', bn: 'Bengali', mr: 'Marathi', gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam', od: 'Odia', pa: 'Punjabi', as: 'Assamese', brx: 'Bodo', doi: 'Dogri', kok: 'Konkani', ks: 'Kashmiri', mai: 'Maithili', mni: 'Manipuri', ne: 'Nepali', sa: 'Sanskrit', sat: 'Santali', sd: 'Sindhi', ur: 'Urdu' };

export const STAGES = ['reach', 'onboard', 'explain', 'decide', 'complete', 'handover', 'resolve'];
export const STAGE_LABELS = { reach: 'Reach out', onboard: 'Onboard once', explain: 'Explain', decide: 'Decide', complete: 'Complete', handover: 'Hand over', resolve: 'Resolve' };

const CLARIFY_LIMIT = 2;
const REASON_WHY = {
  asked: 'The customer asked for a person.',
  not_sure: 'MITRA was not sure what the customer needed.',
  dispute: 'A complaint or dispute.',
  irreversible: 'A step that is hard to undo.',
  distress: 'Signs of a scam or distress.',
  not_in_kfs: 'The answer is not in the documents MITRA has.',
  hardship: 'The customer may not be able to pay, or is worried about money.',
};

let handoffSequence = 0;

// `customer` comes from a signed-in account; without one, a demo customer by id.
export function createSession({ id, customerId = 'ramesh', customer: given = null, channel = 'call', now = Date.now() }) {
  const customer = given || CUSTOMERS[customerId];
  if (!customer) throw new RangeError(`Unknown customer ${customerId}`);
  const session = {
    id, customerId, customer, channel, startedAt: new Date(now).toISOString(),
    lang: 'en', facts: {}, consents: [], pending: null, declined: [], clarifications: 0,
    decisions: { claimDocs: [] }, explained: [], reminders: [], stage: 'reach', stagesReached: ['reach'],
    handoffs: [], chain: [], messages: [], reusedPairs: [], lastAgent: 'orchestrator', metrics: { riskyStopped: 0, reused: 0, turns: 0, questionsAsked: 0, intentToApplicationSeconds: null },
  };
  if (customer.kind === 'merchant') session.facts.salesSummary = { value: MERCHANT_SALES.name, words: '', collectedBy: 'system', collectedOn: isoDate(now) };
  return session;
}

export function greeting(session) {
  const merchant = session.customer.kind === 'merchant';
  const reply = merchant
    ? `Vanakkam, ${session.customer.name}. This is MITRA, an AI assistant on your Soundbox, not a person. You can talk in your own language. Need money for stock? Just say so.`
    : `Namaste${session.customer.fromAccount ? `, ${session.customer.name.split(' ')[0]}` : ', vanakkam'}. This is MITRA, an AI assistant, not a person. You can talk in your own language. A loan, insurance, a claim, or a payment you are unsure about: how can I help?`;
  return {
    reply,
    chips: merchant ? ['How is my business doing?', 'I need money for stock for my shop', 'Is this message a scam?']
      : session.facts.incomeProfile ? ['Can I afford this loan?', 'What does this loan really cost?', 'How much insurance do I need?', 'Is this message a scam?']
        : ['What does this loan really cost?', 'How much insurance do I need?', 'My claim was cut, why?', 'Is this message a scam?'],
    card: { type: 'menu', data: { merchant } },
    passport: {
      title: 'Call opened: AI disclosed', evidence: [{ field: 'Disclosure', value: 'Said it is an AI at the start of the call', source: 'MITRA', asOf: isoDate(Date.now()) }],
      formula: 'No formula', result: 'AI disclosed', pack: packStamp(PACKS.privacy), action: 'Disclosed, nothing executed',
    },
    agent: 'orchestrator', tool: 'open_call', stage: 'reach', journey: 'none', trace: [{ kind: 'disclosure', label: 'AI disclosure spoken first', detail: 'Before anything else, on every call' }],
  };
}

const reachStage = (session, stage) => {
  if (!stage) return;
  session.stage = stage;
  if (!session.stagesReached.includes(stage)) session.stagesReached.push(stage);
};

// What a tool still needs, one thing at a time. Facts already known are never
// asked again: if only the purpose is new, MITRA asks permission, not the value.
function nextNeed(session, tool, now) {
  for (const need of tool.needs || []) {
    if (session.declined.includes(`${need.purpose}:${need.field}`)) continue;
    // A silent need is read when it is there and never asked for: income papers are uploaded, not spoken.
    if (need.silent) continue;
    if (need.satisfiedBy && readFact(session, { agent: tool.agent, ...need.satisfiedBy, now }).status === 'ok') continue;
    const state = readFact(session, { agent: tool.agent, field: need.field, purpose: need.purpose, now });
    if (state.status === 'ok') continue;
    if (state.status === 'denied') throw new Error(`${tool.agent} may not read ${need.field}`);
    return { need, state };
  }
  return null;
}

function askFor({ session, need, state, now }) {
  if (state.status === 'no_consent') {
    const known = session.facts[need.field].value;
    const shown = typeof known === 'number' && need.field === 'income' ? ` You told me your income is ${inr(known)}, so I will not ask again.` : '';
    const purposeLabel = { insurance_needs: 'work out your insurance needs', loan_eligibility: 'check loan eligibility', merchant_credit: 'check working capital eligibility', business_insights: 'look at how your business is doing', affordability: 'check what you can afford' }[need.purpose];
    return { text: `${shown} May I use your ${need.label} to ${purposeLabel}, only for that, for 30 days? You can withdraw it any time.`.trim(), mode: 'consent' };
  }
  const firstForPurpose = !activeConsent(session, need.purpose, now);
  return { text: firstForPurpose ? `${need.ask} ${purposeLine()}` : need.ask, mode: 'value' };
}

function buildHandoff(session, { reason, carry = {}, turn, now, linkedPassport }) {
  const today = isoDate(now);
  const grant = grantConsent(session, 'rm_handoff', { words: turn.text, now });
  const sequence = String(++handoffSequence).padStart(4, '0');
  const lang = LANGUAGE_LABELS[session.lang] || 'English';
  const sharedFields = Object.keys(session.facts).filter((field) => field !== 'salesSummary');
  const brief = {
    id: `HB-${today.slice(2, 4)}-${today.slice(5).replace('-', '')}-${sequence}`,
    status: 'open', reason, createdAt: new Date(now).toISOString(), sessionId: session.id, callback: reason === 'distress' ? 'Call back now' : 'Call back today, 4–6 PM',
    customer: `${session.customer.name}, prefers a ${session.customer.preferredChannel} in ${lang}`,
    customerName: session.customer.name, language: lang,
    journey: journeyLabel(session),
    asked: { english: carry.askedText?.english || turn.textEn, original: carry.askedText?.original || turn.text },
    explained: [...session.explained],
    why: carry.why || REASON_WHY[reason] || REASON_WHY.asked,
    consent: sharedFields.length ? `${sharedFields.map((field) => ({ income: 'Income', dependants: 'dependants', existingLife: 'life cover', existingHealth: 'health cover', incomeProfile: 'income from their own papers' }[field] || field)).join(', ')}: shared with you for this case only` : 'Nothing beyond this call',
    consentId: grant.id, next: carry.next || `Call back in ${lang} and resolve the question above`,
    linkedPassport, notes: null, outcome: null,
  };
  session.handoffs.push(brief);
  return brief;
}

function journeyLabel(session) {
  const key = session.lastJourney;
  return {
    lending: 'Personal loan from a partner lender, ₹2,00,000 over 24 months',
    insurance: 'Buying the right health and life cover',
    claims: 'Health claim CLM-26-88120',
    payments: 'A payment request, checked before the PIN',
    merchant: 'Working capital for the shop',
  }[key] || 'General question';
}

async function pickTool({ session, turn, modelRoute, trace, modelOff }) {
  const started = Date.now();
  const safety = routeSafety(turn.textEn, turn.text);
  if (safety) {
    trace.push({ kind: 'route', label: `Safety rule chose ${safety.name}`, detail: 'Instant, no model used', ms: Date.now() - started, args: safety.arguments });
    return safety;
  }
  const fallback = (label, detail, ok) => {
    const rule = routeByRules(turn.textEn, turn.text) || routeBroad(turn.textEn, turn.text);
    trace.push({ kind: 'route', label: rule ? `${label}. Rule chose ${rule.name}` : `${label}. Guided options`, detail, ms: Date.now() - started, ok, args: rule?.arguments });
    return rule || { name: 'clarify_request', arguments: {} };
  };
  if (turn.tapped) return fallback('Tapped option', 'Its wording is known, so no model is needed');
  if (modelOff || !modelRoute) return fallback('The model is off', 'Engines and receipts keep working');
  try {
    const call = await routeWithModel(modelInput(turn.textEn, turn.text), { complete: modelRoute });
    trace.push({ kind: 'route', label: `Model chose ${call.name}`, detail: 'Schema checked against the allow-list', ms: Date.now() - started, args: call.arguments, model: true });
    return call;
  } catch (error) {
    return fallback('Model unavailable or out of bounds', error.message, false);
  }
}

function finish({ session, name, tool, result, trace, turn, now }) {
  const grounded = assertGrounded(result.reply, result.computed ?? {}, turn.textEn);
  if (!grounded.ok) {
    // A template that states a figure the engine did not compute is a bug, and
    // the fence fails closed: the sentence is not spoken.
    trace.push({ kind: 'grounding', label: 'Reply blocked: a figure was not computed', detail: grounded.invented.join(', '), ok: false });
    return {
      reply: 'I could not verify that answer, so I will not read it out. Let me bring in a person.',
      chips: ['Talk to a person'], card: null, agent: tool.agent, tool: name, trace, stage: session.stage, journey: tool.journey, blocked: true,
    };
  }
  trace.push({ kind: 'grounding', label: 'Every figure comes from the engine', detail: 'Checked before translation' });
  session.lastAgent = tool.agent;
  session.lastResult = { reply: result.reply, replyHi: result.replyHi, simple: result.simple, card: result.card, chips: result.chips, computed: result.computed };
  if (!['none', 'close', 'handoff', 'onboarding'].includes(tool.journey)) session.lastJourney = tool.journey;
  reachStage(session, tool.stage);
  return { ...result, agent: tool.agent, tool: name, journey: tool.journey, stage: tool.stage, trace };
}

function runTool({ session, name, args, turn, trace, now, modelOff }) {
  const tool = TOOLS[name];
  const today = isoDate(now);
  trace.push({ kind: 'agent', label: AGENTS[tool.agent].label, detail: `Calling ${name}`, agent: tool.agent, args });

  // A shop's tools are for a shop. Nobody is asked about a Soundbox they don't have.
  if (tool.merchantOnly && session.customer.kind !== 'merchant') {
    trace.push({ kind: 'engine', label: 'No Soundbox on this account', detail: 'Shop loans use the shop’s own sales, so this one stops here', ok: true });
    return {
      reply: 'This one is for shops with a Paytm Soundbox, and there is none on this account. I can explain the personal loan offered to you, check what you can afford from your bank statements, or bring in a person.',
      card: null, chips: ['What does this loan really cost?', 'Can I afford this loan?', 'Talk to a person'], agent: tool.agent, tool: name, journey: tool.journey, stage: tool.stage, trace,
    };
  }

  const pendingNeed = nextNeed(session, tool, now);
  if (pendingNeed && !pendingNeed.need.askAfter) {
    const ask = askFor({ session, ...pendingNeed, now });
    session.pending = { tool: name, args, need: pendingNeed.need.field, purpose: pendingNeed.need.purpose, mode: ask.mode, askedText: { english: turn.textEn, original: turn.text } };
    reachStage(session, 'onboard');
    session.metrics.questionsAsked += 1;
    trace.push({ kind: 'consent', label: ask.mode === 'consent' ? `Asking permission for one purpose: ${pendingNeed.need.purpose}` : `Asking once for ${pendingNeed.need.label}`, detail: ask.mode === 'consent' ? 'The fact is already known, so it is not asked again' : 'Stored for every agent, read only under consent' });
    return {
      reply: ask.text, card: { type: 'ask', data: { field: pendingNeed.need.label, purpose: pendingNeed.need.purpose, mode: ask.mode } },
      chips: ask.mode === 'consent' ? ['Yes, go ahead', 'No, not now'] : suggestAnswers(pendingNeed.need.field),
      agent: 'onboarding', tool: 'ask_customer', journey: 'onboarding', stage: 'onboard', trace,
    };
  }

  const facts = {};
  for (const need of tool.needs || []) {
    const state = readFact(session, { agent: tool.agent, field: need.field, purpose: need.purpose, now });
    if (state.status === 'ok') {
      facts[need.field] = state.value;
      const pair = `${need.field}:${tool.agent}`;
      if (state.reused && !session.reusedPairs.includes(pair)) {
        session.reusedPairs.push(pair);
        session.metrics.reused = session.reusedPairs.length;
      }
      trace.push({ kind: 'consent', label: `${state.reused ? 'Reused' : 'Read'} ${need.label}`, detail: `${state.reused ? `Collected for another agent, so ${AGENTS[tool.agent].label} did not ask again. ` : ''}Under consent ${state.grant.id}, until ${state.grant.expiresOn}`, ok: true });
    } else if (!(state.status === 'missing' && (need.silent || need.satisfiedBy))) {
      trace.push({ kind: 'consent', label: `Did not read ${need.label}`, detail: 'No consent for this purpose, so the agent cannot see it' });
    }
  }

  const started = Date.now();
  const ctx = {
    session, args, turn, facts, now, today,
    consentFor: (purpose) => activeConsent(session, purpose, now),
    turnQuestion: () => ({ english: turn.textEn, original: turn.text }),
  };
  const result = tool.run(ctx);
  trace.push({ kind: 'engine', label: 'Deterministic engine computed the answer', detail: result.passport?.formula || 'No figures in this answer', ms: Date.now() - started, ok: true });
  if (result.passport?.pack) trace.push({ kind: 'policy', label: `Policy pack: ${result.passport.pack.label}`, detail: `As of ${result.passport.pack.asOf}` });

  // An optional need is asked after the answer, so a question is never held hostage.
  if (pendingNeed?.need.askAfter) {
    const ask = askFor({ session, ...pendingNeed, now });
    session.pending = { tool: name, args, need: pendingNeed.need.field, purpose: pendingNeed.need.purpose, mode: ask.mode, optional: true, askedText: { english: turn.textEn, original: turn.text } };
    result.reply = `${result.reply} ${ask.text}`;
    result.computed = { ...result.computed, askedNumbers: ask.text };
    session.metrics.questionsAsked += 1;
    trace.push({ kind: 'consent', label: `Offered: check against ${pendingNeed.need.label}`, detail: 'Asked after answering, and it stays optional' });
  }

  if (result.confirm) session.pending = { mode: 'confirm', tool: result.confirm.tool, args: result.confirm.args, carry: result.confirm.carry, askedText: { english: turn.textEn, original: turn.text } };
  return finish({ session, name, tool, result, trace, turn, now });
}

const suggestAnswers = (field) => ({
  income: ['₹45,000 a month', 'I would rather not say'],
  dependants: ['My wife and two kids', 'No one'],
  existingLife: ['₹10 lakh', 'None'],
  existingHealth: ['₹3 lakh from my employer', 'None'],
}[field] || []);

function handoffResult({ session, reason, carry, turn, now, trace, modelOff }) {
  const brief = buildHandoff(session, { reason, carry, turn, now, linkedPassport: session.chain.at(-1)?.id || null });
  reachStage(session, 'handover');
  const lang = LANGUAGE_LABELS[session.lang] || 'English';
  trace.push({ kind: 'handoff', label: `Handed to a person: ${REASON_WHY[reason] || reason}`, detail: `${brief.id}. The customer will not repeat their story.`, ok: true });
  const opening = reason === 'hardship' ? 'I am sorry, that is hard, and you are right to ask early. ' : '';
  const closing = reason === 'hardship' ? ' Please talk to them before the next EMI.' : '';
  return {
    reply: `${opening}I have passed this to an expert with everything we covered, so you will not have to repeat yourself. They will call you back today between 4 and 6 PM, in ${lang}.${closing}`,
    replyHi: `${reason === 'hardship' ? 'मुझे दुख है, यह मुश्किल है। ' : ''}मैंने यह सब एक विशेषज्ञ को दे दिया है, आपको दोबारा कुछ नहीं बताना पड़ेगा। वे आज शाम 4 से 6 बजे के बीच आपको कॉल करेंगे।`,
    card: { type: 'handoff', data: brief }, chips: ['That is all, thank you'],
    handoff: brief, agent: 'human', tool: 'handoff_to_human', journey: 'handoff', stage: 'handover', trace,
    computed: { brief, window: '4 6' },
    passport: {
      title: 'Handed to a person', evidence: [{ field: 'Why', value: brief.why, source: 'MITRA', asOf: isoDate(now) }, { field: 'Brief', value: brief.id, source: 'Handoff brief', asOf: isoDate(now) }],
      formula: 'No formula: handed over without guessing', result: `Brief ${brief.id}`, pack: packStamp(PACKS.privacy), action: 'Handed to a person',
      consent: [{ id: brief.consentId, purpose: 'rm_handoff', label: 'Case details, shared with one expert for this case only', days: 30 }],
    },
  };
}

// Answers to a question MITRA just asked come before fresh routing, but a turn
// that plainly starts something new abandons the question rather than being
// misread as its answer.
function resolvePending({ session, turn, now, trace }) {
  const pending = session.pending;
  if (!pending) return null;
  const startsNew = routeByRules(turn.textEn, turn.text);

  if (pending.mode === 'confirm') {
    const yes = parseYesNo(turn.textEn) ?? parseYesNo(turn.text);
    if (yes === true && !(startsNew && startsNew.name !== 'handoff_to_human')) { session.pending = null; return { run: pending }; }
    if (yes === false && !startsNew) {
      session.pending = null;
      return { reply: { reply: 'No problem. Nothing has been sent. What else can I help with?', replyHi: 'कोई बात नहीं। कुछ नहीं भेजा गया। और क्या मदद करूँ?', chips: ['What does this loan really cost?', 'How much insurance do I need?', 'That is all, thank you'], card: null, agent: 'orchestrator', tool: 'declined', journey: 'none', stage: session.stage, trace } };
    }
    session.pending = null;
    return null;
  }

  const tool = TOOLS[pending.tool];
  const need = (tool.needs || []).find((item) => item.field === pending.need);
  const declined = () => {
    session.declined.push(`${pending.purpose}:${pending.need}`);
    session.pending = null;
    trace.push({ kind: 'consent', label: `Customer declined: ${need.label}`, detail: 'Not asked again on this call. Sealed as declined.', ok: true });
    return { run: { tool: pending.tool, args: pending.args }, declinedNeed: need };
  };

  if (pending.mode === 'consent') {
    const yes = parseYesNo(turn.textEn) ?? parseYesNo(turn.text);
    if (yes === true) {
      const grant = grantConsent(session, pending.purpose, { words: turn.text, now });
      trace.push({ kind: 'consent', label: `Consent recorded: ${grant.label}`, detail: `${grant.id}, until ${grant.expiresOn}. In the customer's words.`, ok: true });
      session.pending = null;
      return { run: { tool: pending.tool, args: pending.args }, consentGranted: grant };
    }
    if (yes === false) return declined();
    session.pending = null;
    return null;
  }

  // Value mode: read the answer deterministically, the model does not write facts.
  const refusal = /\b(rather not|won'?t say|don'?t want to|not comfortable|skip|prefer not)\b/i.test(turn.textEn);
  if (refusal) return declined();
  if (startsNew && !/\b(income|earn|salary|cover|depend)\b/i.test(turn.textEn)) { session.pending = null; return null; }
  const value = need?.parse?.(turn.textEn) ?? null;
  if (value !== null && need.valid && !need.valid(value)) {
    // Not stored: "45" is much more likely to mean 45,000 than a real income of ₹45.
    trace.push({ kind: 'consent', label: `Did not accept ${need.label}`, detail: `Heard ${value}, which is outside a sensible range`, ok: false });
    session.metrics.questionsAsked += 1;
    return { reply: { reply: need.invalid(value), card: { type: 'ask', data: { field: need.label, purpose: pending.purpose, mode: 'value' } }, chips: suggestAnswers(pending.need), agent: 'onboarding', tool: 'ask_customer', journey: 'onboarding', stage: 'onboard', trace, computed: { value } } };
  }
  if (value === null) {
    if (parseYesNo(turn.textEn) === false) return declined();
    session.pending = null;
    return null;
  }
  recordFact(session, pending.need, value, { words: turn.text, firstFor: tool.agent, now });
  const grant = grantConsent(session, pending.purpose, { words: turn.text, now });
  trace.push({ kind: 'consent', label: `Recorded ${need.label} once`, detail: `From the customer's own words, under ${grant.id}. Other agents reuse it.`, ok: true });
  session.pending = null;
  return { run: { tool: pending.tool, args: pending.args }, consentGranted: grant };
}

// One turn. `turn` is { text, textEn, lang, langMethod, langConfidence }.
export async function takeTurn(session, turn, { now = Date.now(), modelRoute = null, riskCheck = null, modelOff = false } = {}) {
  const trace = [];
  if (turn.lang) session.lang = turn.lang;
  session.metrics.turns += 1;

  const resumed = resolvePending({ session, turn, now, trace });
  if (resumed?.reply) return resumed.reply;

  if (resumed?.run) {
    const { tool: resumedName, args, carry } = resumed.run;
    if (resumedName === 'handoff_to_human') return handoffResult({ session, reason: args.reason, carry, turn, now, trace, modelOff });
    return runTool({ session, name: resumedName, args, turn: { ...turn, resumedFrom: true }, trace, now, modelOff });
  }

  const call = await pickTool({ session, turn, modelRoute, trace, modelOff });
  if (session.documentOffer && call.arguments?.offer_id) {
    call.arguments = { ...call.arguments, offer_id: session.documentOffer.id };
    for (const event of trace) if (event.args?.offer_id) event.args = { ...event.args, offer_id: session.documentOffer.id };
  }
  if (call.name === 'clarify_request') {
    session.clarifications += 1;
    if (session.clarifications >= CLARIFY_LIMIT) {
      session.clarifications = 0;
      return handoffResult({ session, reason: 'not_sure', turn, now, trace, modelOff });
    }
  } else session.clarifications = 0;

  if (call.name === 'handoff_to_human') return handoffResult({ session, reason: call.arguments.reason || 'asked', turn, now, trace, modelOff });

  // Saying it again, or more simply, is not a new explanation, so no new receipt.
  if (call.name === 'repeat_last' || call.name === 'say_simpler') {
    const last = session.lastResult;
    const simpler = call.name === 'say_simpler';
    const reply = !last ? 'I have not explained anything yet. What would you like to know?' : simpler ? (last.simple || last.reply) : last.reply;
    return { reply, replyHi: last?.replyHi, card: last?.card ?? null, chips: last?.chips || [], agent: 'orchestrator', tool: call.name, journey: 'none', stage: session.stage, trace, computed: last?.computed };
  }

  // A second opinion on a request the rules did not stop. It can only raise the alarm.
  if (call.name === 'check_payment_request' && riskCheck && !modelOff && !isOnlyAsking(turn.textEn)) {
    const words = `${turn.textEn}\n${turn.text}`;
    if (checkPaymentRequest(words).verdict !== 'stop') {
      try {
        turn.modelRisk = await riskCheck(modelInput(turn.textEn, turn.text));
        trace.push({ kind: 'route', label: `Second opinion: ${String(turn.modelRisk).replace('_', ' ')}`, detail: 'A model can raise this alarm. It can never lower one', model: true });
      } catch (error) { trace.push({ kind: 'route', label: 'Second opinion unavailable', detail: 'The rules still decide', ok: false }); }
    }
  }

  const result = runTool({ session, name: call.name, args: call.arguments, turn, trace, now, modelOff });
  if (result.handoff && !result.handoff.id) {
    // A safety finding that also needs a person: the check still runs and its
    // receipt is sealed, and the brief goes out in the same turn.
    const brief = buildHandoff(session, { reason: result.handoff.reason, carry: { why: result.handoff.why, next: result.handoff.next }, turn, now, linkedPassport: session.chain.at(-1)?.id || null });
    trace.push({ kind: 'handoff', label: `Handed to a person: ${REASON_WHY[result.handoff.reason]}`, detail: brief.id, ok: true });
    result.handoff = brief;
    result.reply = `${result.reply} I am also asking a person to call you right now. Please stay with me.`;
    result.computed = { ...result.computed, brief };
  }
  return result;
}
