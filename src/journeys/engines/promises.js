// Promise Check: what the agent said on the call, set against what the paper says.
// A model only finds and labels the sentences. It must quote them word for word, or
// the promise is dropped, and it is the engine that decides what the paper says.
import { PACKS, packStamp } from '../policyPacks.js';
import { explainLoanOffer } from './lending.js';
import { figuresIn, inr, pct } from '../money.js';

export const PROMISE_KINDS = Object.freeze(['guaranteed_return', 'no_waiting_period', 'refund_anytime', 'no_fee', 'interest_rate', 'pressure']);

export const PROMISE_LABEL = Object.freeze({
  guaranteed_return: 'A guaranteed return', no_waiting_period: 'No waiting period', refund_anytime: 'Full refund at any time',
  no_fee: 'No fee on the loan', interest_rate: 'The interest rate', pressure: 'Pressure to sign now',
});

// Used when no model can be asked: enough to catch the common lines on a translated call.
const FALLBACK_RULES = [
  ['guaranteed_return', /\b(guarantee\w*|assured|fixed|sure|certain)\b.{0,30}\b(return|profit|interest)\b|\b(return|profit)\b.{0,30}\b(guarantee\w*|assured|fixed|sure|certain)\b|\blike (an? )?(fd|fixed deposit)\b/i],
  ['no_waiting_period', /\bno waiting\b|\bwaiting period\b.{0,20}\b(no|not|none)\b|\bfrom (the )?(first|day one|day 1)\b/i],
  ['refund_anytime', /\b(any ?time|whenever)\b.{0,60}\b(refund|money back|back)\b|\b(full|whole|entire) (money|amount|refund)\b.{0,30}\bback\b/i],
  ['no_fee', /\bno\b.{0,20}\b(processing )?(fee|charge)s?\b/i],
  ['interest_rate', /\b(interest|rate)\b.{0,30}\d+(\.\d+)?\s*(%|percent)|\d+(\.\d+)?\s*(%|percent).{0,30}\b(interest|rate)\b/i],
  ['pressure', /\b(today|right now|immediately)\b.{0,40}\b(sign|decide|pay)\b|\b(sign|decide|pay)\b.{0,40}\b(today|right now|immediately)\b|\boffer\b.{0,30}\b(end|expire|finish|over)\w*/i],
];

export function findPromisesByRules(turnsEnglish) {
  const found = [];
  for (const turn of turnsEnglish) {
    for (const [kind, rule] of FALLBACK_RULES) if (rule.test(turn.english)) found.push({ kind, turn: turn.index, quote: turn.text });
  }
  return found;
}

// The agent is who explains and sells. The customer is who asks. A question mark is
// a better signal than word count, and the model's choice is preferred when it has one.
export function agentSpeaker(turns) {
  const tally = new Map();
  for (const turn of turns) {
    const row = tally.get(turn.speaker) || { words: 0, questions: 0 };
    row.words += String(turn.text).split(/\s+/).length;
    row.questions += /[?？]/.test(turn.text) ? 1 : 0;
    tally.set(turn.speaker, row);
  }
  return [...tally.entries()].sort((a, b) => (b[1].words - b[1].questions * 5) - (a[1].words - a[1].questions * 5))[0]?.[0] ?? null;
}

// A quote must really be in what the agent said. Spacing and punctuation may differ.
const squeeze = (text) => String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export function quoteIsReal(quote, turns, agent) {
  const needle = squeeze(quote);
  if (needle.length < 4) return null;
  return turns.find((turn) => turn.speaker === agent && squeeze(turn.text).includes(needle)) || null;
}

function verdictFor(kind, quote, { offer, plan, policyFreeLookDays, coolingOffDays }) {
  const loan = explainLoanOffer(offer);
  switch (kind) {
    case 'guaranteed_return': return {
      verdict: 'contradicted', paper: `${plan.name} is ${plan.type.toLowerCase()} cover. ${plan.pays} It pays no return at all.`, source: plan.name,
    };
    case 'no_waiting_period': return plan.waitingMonths ? {
      verdict: 'contradicted', paper: plan.watch, source: plan.name,
    } : { verdict: 'matches', paper: 'This plan states no waiting period.', source: plan.name };
    case 'refund_anytime': return {
      verdict: 'contradicted', paper: `You can return a policy within ${policyFreeLookDays} days of receiving it, with a small deduction. After that there is no full refund.`, source: 'Free-look rule',
    };
    case 'no_fee': return loan.fees ? {
      verdict: 'contradicted', paper: `The Key Fact Statement shows a ${inr(offer.processingFee)} processing fee plus ${inr(offer.gstOnFee)} GST, taken out of the loan.`, source: offer.id,
    } : { verdict: 'matches', paper: 'The Key Fact Statement shows no processing fee.', source: offer.id };
    case 'interest_rate': {
      const said = figuresIn(quote).map(Number).find((value) => value > 0 && value <= 60);
      if (said != null && Math.abs(said - offer.ratePct) > 0.01) return { verdict: 'contradicted', paper: `The Key Fact Statement shows ${pct(offer.ratePct)} interest, not ${pct(said)}. With the fee, the real yearly cost is ${pct(loan.aprPct)}.`, source: offer.id };
      return { verdict: 'half_truth', paper: `${pct(offer.ratePct)} is the rate on the page, but with the fee the real yearly cost is ${pct(loan.aprPct)}.`, source: offer.id };
    }
    case 'pressure': return {
      verdict: 'pressure', paper: `Nothing here has to be decided today. You can read the Key Fact Statement first, and you can still exit within ${coolingOffDays} days of signing.`, source: offer.id,
    };
    default: return { verdict: 'unknown', paper: 'MITRA has no document to check this against.', source: '' };
  }
}

export function checkPromises(found, turns, agent, { offer, plan, policyFreeLook }) {
  const facts = { offer, plan, policyFreeLookDays: PACKS.insurance.rules.freeLookDays, coolingOffDays: offer.coolingOffDays };
  const seen = new Set();
  const rows = [];
  for (const item of found) {
    if (!PROMISE_KINDS.includes(item.kind) || seen.has(item.kind)) continue;
    const turn = quoteIsReal(item.quote, turns, agent);
    if (!turn) continue;
    seen.add(item.kind);
    rows.push({ kind: item.kind, label: PROMISE_LABEL[item.kind], quote: item.quote, english: turn.english || null, at: turn.start ?? null, ...verdictFor(item.kind, item.quote, facts) });
  }
  const broken = rows.filter((row) => ['contradicted', 'half_truth'].includes(row.verdict)).length;
  return { rows, broken, total: rows.length, freeLookDaysLeft: policyFreeLook?.daysLeft ?? null, freeLookEnds: policyFreeLook?.endsLabel ?? null, pack: packStamp(PACKS.insurance) };
}

export function promiseLine(result) {
  if (!result.total) return 'I listened to the call and did not find a clear promise to check. A person can listen with you if something still feels wrong.';
  const lead = result.broken
    ? `I listened to the call. The agent made ${result.total} ${result.total === 1 ? 'promise' : 'promises'}, and ${result.broken} ${result.broken === 1 ? 'does' : 'do'} not match your papers.`
    : `I listened to the call. The agent made ${result.total} ${result.total === 1 ? 'promise' : 'promises'}, and nothing contradicts your papers.`;
  const worst = result.rows.find((row) => row.verdict === 'contradicted') || result.rows.find((row) => row.verdict === 'half_truth');
  const window = result.freeLookDaysLeft ? ` You still have ${result.freeLookDaysLeft} days to return the policy.` : '';
  return `${lead}${worst ? ` ${worst.paper}` : ''}${window}`;
}
