// Purpose-bound consent. A fact is asked for once, but each purpose needs its
// own yes: income shared for a loan cannot silently be read by the insurance
// agent. Agents only ever read facts through readFact().
import { PACKS } from './policyPacks.js';
import { addDays, isoDate } from './money.js';

export const PURPOSES = Object.freeze({
  loan_eligibility: Object.freeze({ id: 'loan_eligibility', label: 'Income summary, for loan eligibility only', fields: ['income'], agents: ['lending'] }),
  insurance_needs: Object.freeze({ id: 'insurance_needs', label: 'Income, family and cover, to work out insurance needs', fields: ['income', 'dependants', 'existingLife', 'existingHealth'], agents: ['insurance'] }),
  merchant_credit: Object.freeze({ id: 'merchant_credit', label: 'Soundbox sales summary, for working capital eligibility only', fields: ['salesSummary'], agents: ['merchant'] }),
  rm_handoff: Object.freeze({ id: 'rm_handoff', label: 'Case details, shared with one expert for this case only', fields: ['income', 'dependants', 'existingLife', 'existingHealth', 'salesSummary'], agents: ['human'] }),
});

const DAYS = PACKS.privacy.assumptions.consentDays;
let sequence = 0;

export function grantConsent(session, purposeId, { words = '', now }) {
  const purpose = PURPOSES[purposeId];
  if (!purpose) throw new RangeError(`Unknown consent purpose ${purposeId}`);
  const live = activeConsent(session, purposeId, now);
  if (live) return live;
  const today = isoDate(now);
  const grant = {
    id: `CN-${String(++sequence).padStart(4, '0')}-${today.slice(5).replace('-', '')}`,
    purpose: purposeId, label: purpose.label, fields: [...purpose.fields], agents: [...purpose.agents],
    grantedOn: today, expiresOn: addDays(today, DAYS), days: DAYS, words: String(words).slice(0, 200), status: 'active', revokedOn: null,
  };
  session.consents.push(grant);
  return grant;
}

export function activeConsent(session, purposeId, now) {
  const today = isoDate(now);
  return session.consents.find((grant) => grant.purpose === purposeId && grant.status === 'active' && grant.expiresOn >= today) || null;
}

export function revokeConsent(session, purposeId, { now }) {
  const grant = activeConsent(session, purposeId, now);
  if (!grant) return null;
  grant.status = 'revoked';
  grant.revokedOn = isoDate(now);
  return grant;
}

// The only door to a customer's facts. `missing` and `no_consent` are distinct:
// the first means ask the question, the second means ask only for permission.
export function readFact(session, { agent, field, purpose, now }) {
  const known = session.facts[field];
  const spec = PURPOSES[purpose];
  if (!spec || !spec.fields.includes(field) || !spec.agents.includes(agent)) return { status: 'denied' };
  if (!known) return { status: 'missing' };
  const grant = activeConsent(session, purpose, now);
  if (!grant) return { status: 'no_consent', known: true };
  return { status: 'ok', value: known.value, grant, reused: Boolean(known.firstFor) && known.firstFor !== agent, known };
}

// `firstFor` is the agent whose question collected the fact. Any other agent reading
// it is a question the customer did not have to answer twice.
export function recordFact(session, field, value, { words = '', agent = 'onboarding', firstFor = null, now }) {
  session.facts[field] = { value, words: String(words).slice(0, 200), collectedBy: agent, firstFor, collectedOn: isoDate(now) };
}
