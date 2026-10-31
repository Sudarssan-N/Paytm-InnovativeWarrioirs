// The allow-list. Each specialist agent owns a few narrow tools; a tool declares
// the facts it needs and the purpose it needs them for, runs a deterministic
// engine, and composes the reply from the engine's result. A model can choose a
// tool. It cannot supply a figure, and no argument here is a number.
import { SAMPLE_MESSAGES, CLAIM, INSURANCE_PLANS, ISSUED_POLICY, LOAN_OFFERS, MERCHANT_OFFER, MERCHANT_SALES, NEW_CLAIM, POLICY_WORDING } from './sampleData.js';
import { coolingOffStatus, explainLoanOffer, foreclosureTerms, prepayVsInvest } from './engines/lending.js';
import { explainPlans, freeLookStatus, protectionGap } from './engines/insurance.js';
import { claimChecklist, draftGrievance, explainDeductions } from './engines/claims.js';
import { checkPaymentRequest, isOnlyAsking } from './engines/payments.js';
import { explainMerchantOffer, merchantEligibility } from './engines/merchant.js';
import { PURPOSES, revokeConsent } from './consent.js';
import { PACKS, packStamp } from './policyPacks.js';
import { addDays, inr, parseAmount, parseDependants, parseLoanTerms, pct } from './money.js';

export const AGENTS = Object.freeze({
  orchestrator: { label: 'MITRA orchestrator', blurb: 'Knows the journey, the language and the consent in force' },
  onboarding: { label: 'Onboarding agent', blurb: 'Collects facts once, logs consent per purpose' },
  insurance: { label: 'Insurance agent', blurb: 'Protection gap, plan explainer, free-look' },
  claims: { label: 'Claims agent', blurb: 'Checklist, deductions, grievance draft' },
  lending: { label: 'Lending agent', blurb: 'Eligibility, KFS and APR, cooling-off' },
  safety: { label: 'Payment safety agent', blurb: 'Offer X-Ray, scam and request checks' },
  merchant: { label: 'Merchant agent', blurb: 'Working capital from consented sales data' },
  human: { label: 'Human expert', blurb: 'Receives a ready brief to act on' },
});

const OFFER_ID = 'KFS-v3-0412';
const offerArg = { type: 'object', additionalProperties: false, properties: { offer_id: { type: 'string', enum: Object.keys(LOAN_OFFERS) } }, required: ['offer_id'] };
const noArgs = { type: 'object', additionalProperties: false, properties: {} };
// The customer's own document, once they have confirmed what MITRA read from it.
const offerFor = (ctx) => ctx.session.documentOffer || LOAN_OFFERS[ctx.args.offer_id || OFFER_ID];

const parseCover = (text) => (/\b(no|none|nothing|don'?t have|zero|nil)\b|இல்லை|नहीं/i.test(text) ? 0 : parseAmount(text));

const coverOk = (value) => value === 0 || (value >= 1000 && value <= 500000000);
const NEED = {
  income: (purpose, why) => ({
    field: 'income', purpose, label: 'monthly income', parse: parseAmount, ask: `${why} What is your monthly income?`,
    valid: (value) => value >= 1000 && value <= 100000000,
    invalid: (value) => `I heard ${inr(value)}. Did you mean ${inr(value * 1000)}? Please say your monthly income in rupees.`,
  }),
  dependants: {
    field: 'dependants', purpose: 'insurance_needs', label: 'dependants', parse: parseDependants, ask: 'How many people depend on your income?',
    valid: (value) => value >= 0 && value <= 20, invalid: () => 'I did not catch that. How many people depend on your income?',
  },
  existingLife: {
    field: 'existingLife', purpose: 'insurance_needs', label: 'life cover', parse: parseCover, ask: 'How much life cover do you already have? Say none if you have none.',
    valid: coverOk, invalid: () => 'Please say the cover in rupees, like ten lakh, or say none.',
  },
  existingHealth: {
    field: 'existingHealth', purpose: 'insurance_needs', label: 'health cover', parse: parseCover, ask: 'And how much health cover, including from your employer?',
    valid: coverOk, invalid: () => 'Please say the cover in rupees, like three lakh, or say none.',
  },
};

const purposeLine = () => 'Used only for this, for 30 days. You can withdraw it any time.';

// A loan the customer describes. MITRA must not answer with the sample offer, and
// must not guess a term it was not told.
function ownLoanAnswer(ctx, stated) {
  const missing = [!stated.principal && 'the amount', !stated.ratePct && 'the interest rate', !stated.months && 'how many months'].filter(Boolean);
  if (missing.length) {
    return {
      reply: `For your own loan, I also need ${missing.join(' and ')}. Please tell me, and I will work it out. If you have a Key Fact Statement, read me the fee as well.`,
      card: { type: 'note', data: { title: 'Your own loan', body: 'MITRA works this out from your numbers. It will not guess the ones it does not have.', tone: 'info' } },
      chips: ['What does this loan really cost?', 'Talk to a person'], computed: stated,
    };
  }
  const fee = stated.fee || 0;
  const offer = { id: 'Customer’s own words', version: 'As stated', lender: 'your lender', product: 'Your loan', principal: stated.principal, ratePct: stated.ratePct, rateType: 'not stated', months: stated.months, processingFee: fee, gstOnFee: Math.round(fee * 0.18), otherCharges: 0, coolingOffDays: null, foreclosure: null, issuedOn: ctx.today };
  const r = explainLoanOffer(offer);
  const interest = r.totalRepay - stated.principal;
  const tail = fee ? `With the fee, the real yearly cost is ${pct(r.aprPct)}.` : 'You have not told me the fees, and they change the real cost. Read me the processing fee and I will add it.';
  return {
    reply: `For ${inr(stated.principal)} at ${pct(stated.ratePct)} over ${stated.months} months, the EMI is ${inr(r.emi)}. You repay ${inr(r.totalRepay)}, which is ${inr(interest)} in interest. ${tail}`,
    simple: `You pay ${inr(r.emi)} every month. In the end you pay ${inr(interest)} more than you borrowed.`,
    card: { type: 'loan', data: { ...r, income: null, sharePct: null, lender: offer.lender, product: offer.product, ownNumbers: true } },
    chips: ['Should I prepay or invest ₹50,000?', 'Talk to a person'],
    passport: { title: 'Customer’s own loan worked out', evidence: [{ field: 'Customer said', value: ctx.turn.text.slice(0, 200), source: 'Customer', asOf: ctx.today }], formula: r.formula, result: `EMI ${inr(r.emi)}`, pack: r.pack, action: 'Explained, not executed' },
    computed: { ...r, interest, stated },
  };
}

const TERM_TEXT = {
  apr: 'APR is the real yearly cost of a loan. It counts the interest and all the fees together, so you can compare two loans fairly. It is usually higher than the interest rate shown.',
  emi: 'EMI is the fixed amount you pay every month until the loan is finished. Part of it pays interest, and part of it pays back the loan.',
  kfs: 'The Key Fact Statement is a short sheet the lender must give you before you sign. It shows the real cost, the fees, and how to complain.',
  cooling_off: 'Cooling-off is a short time after signing when you can leave a digital loan. You repay what you took and the interest for those days, with no penalty.',
  free_look: 'Free-look is the time after you get a policy when you can return it if you do not like it, and get most of your money back.',
  waiting_period: 'A waiting period is the time before the policy pays for some illnesses, especially ones you already have.',
  processing_fee: 'A processing fee is what the lender charges to give you the loan. It is usually cut from the money you receive, so you get less than the loan amount.',
  foreclosure: 'Foreclosure means closing a loan early by paying everything left. Some lenders charge for this, so check before you do it.',
  sum_insured: 'Sum insured is the most the policy will pay. If the bill is higher, you pay the rest.',
  deductible: 'A deductible is the part of the bill you pay yourself before the policy starts paying.',
  premium: 'A premium is what you pay to keep your insurance policy active.',
};

const remember = (session, line) => { if (!session.explained.includes(line)) session.explained.push(line); };
const addReminder = (session, reminder) => {
  session.reminders = session.reminders.filter((item) => item.id !== reminder.id);
  session.reminders.push(reminder);
};

const consentStamps = (ctx, purposes) => purposes.map((purpose) => ctx.consentFor(purpose)).filter(Boolean)
  .map((grant) => ({ id: grant.id, purpose: grant.purpose, label: grant.label, expiresOn: grant.expiresOn, days: grant.days }));

export const TOOLS = {
  learn_by_playing: {
    agent: 'orchestrator', journey: 'lending', stage: 'explain', params: noArgs,
    description: 'The customer asks for a game, wants to learn by playing, or wants to see how a loan, a scam or a claim works in a game.',
    run(ctx) {
      const game = /\b(scams?|fraud|otp|collect)\b/i.test(ctx.turn.textEn) ? 'scam' : /\b(claims?|hospital|insurance)\b/i.test(ctx.turn.textEn) ? 'claim' : 'karz';
      return {
        reply: 'Let us play it, then. Every rupee in the game comes from the same numbers I use here. Tap the screen when you are ready, and we can talk again after.',
        card: { type: 'arcade', data: { game } },
        chips: ['What does this loan really cost?', 'Talk to a person'],
        computed: {},
      };
    },
  },
  // ── lending ──────────────────────────────────────────────────
  explain_loan_offer: {
    agent: 'lending', journey: 'lending', stage: 'explain', params: offerArg,
    description: 'Explain what a loan offer really costs: APR beside the headline rate, EMI, total repayment and cooling-off.',
    needs: [{ ...NEED.income('loan_eligibility', 'To check the EMI against your income, I need one number.'), optional: true, askAfter: true }],
    run(ctx) {
      const stated = ctx.turn.resumedFrom ? null : parseLoanTerms(ctx.turn.textEn);
      if (stated?.mentioned) return ownLoanAnswer(ctx, stated);
      const offer = offerFor(ctx);
      const income = ctx.facts.income ?? null;
      const r = explainLoanOffer(offer, { income });
      const share = r.fit ? Math.round(r.fit.sharePct) : null;
      remember(ctx.session, `APR ${pct(r.aprPct)} against a ${pct(r.ratePct)} headline rate`);
      if (r.fit) remember(ctx.session, `EMI ${inr(r.emi)}, ${share}% of income`);
      const full = `On this ${inr(r.principal)} loan, it shows ${pct(r.ratePct)} interest. With the ${inr(r.fees)} fee, the APR is ${pct(r.aprPct)}. You get ${inr(r.net)} and repay ${inr(r.totalRepay)}, at ${inr(r.emi)} a month.`;
      const exit = r.coolingOffDays ? `You can exit within ${r.coolingOffDays} days of signing, without penalty. Nothing is signed here.` : 'Nothing is signed here.';
      const statedApr = offer.statedApr != null && Math.abs(offer.statedApr - r.aprPct) > 0.25 ? offer.statedApr : null;
      const aprNote = statedApr != null ? ` The page states an APR of ${pct(statedApr)}, but counting every charge on it I get ${pct(r.aprPct)}. A person should check that with the lender.` : '';
      const fitLine = r.fit && `The EMI of ${inr(r.emi)} is ${share}% of your ${inr(income)} income, which ${{ fits: 'fits comfortably', tight: 'is tight', stretch: 'is a stretch' }[r.fit.band]}.`;
      return {
        reply: fitLine && ctx.turn.resumedFrom
          ? `${fitLine} ${exit}`
          : fitLine ? `${full}${aprNote} ${fitLine} ${exit}` : ctx.turn.resumedFrom ? `${full}${aprNote} ${exit}` : `${full}${aprNote}`,
        simple: `You get ${inr(r.net)} today and pay back ${inr(r.totalRepay)}. So this loan costs you ${inr(r.totalCost)} in all.`,
        replyHi: `इस पर ${pct(r.ratePct)} ब्याज दिखता है। ${inr(r.fees)} की फ़ीस जोड़ने पर असली सालाना लागत यानी APR ${pct(r.aprPct)} है। आपको ${inr(r.net)} मिलेंगे और ${r.months} महीनों में ${inr(r.totalRepay)} लौटाने होंगे। EMI ${inr(r.emi)} है। साइन करने के बाद ${r.coolingOffDays} दिन तक बिना पेनल्टी निकल सकते हैं।`,
        card: { type: 'loan', data: { ...r, income, sharePct: share, lender: offer.lender, product: offer.product, statedApr, fromDocument: Boolean(offer.fromDocument), otherCharges: offer.otherCharges } },
        chips: ['Show me this loan as a game', 'Can I close the loan early without a penalty?', 'Should I prepay or invest ₹50,000?', 'I will take this loan', 'Talk to a person'],
        passport: {
          title: offer.fromDocument ? `${offer.product} explained, from the customer’s own document` : 'Personal loan offer explained', evidence: r.evidence, formula: r.formula, result: `${pct(r.aprPct)} APR`,
          pack: r.pack, action: 'Explained, not executed', consent: consentStamps(ctx, income ? ['loan_eligibility'] : []),
        },
        computed: { ...r, share, income, statedApr },
      };
    },
  },
  cooling_off_status: {
    agent: 'lending', journey: 'lending', stage: 'complete', params: offerArg,
    description: 'The customer wants to cancel or leave a loan they took or just signed, or asks how many days they have and what it costs.',
    run(ctx) {
      const offer = offerFor(ctx);
      // "I just signed, can I cancel?" also tells us when the window started.
      if (!ctx.session.decisions.loanSignedOn && /\b(signed|took|taken)\b/i.test(ctx.turn.textEn)) {
        ctx.session.decisions.loanSignedOn = /\byesterday\b/i.test(ctx.turn.textEn) ? addDays(ctx.today, -1) : ctx.today;
      }
      const signedOn = ctx.session.decisions.loanSignedOn;
      const r = coolingOffStatus(offer, { signedOn, today: ctx.today });
      if (!r.signed) {
        return {
          reply: `The lender gives ${r.days} days after signing to exit without penalty. RBI's minimum is ${r.minimumDays} day. You have not signed anything yet, so nothing is running.`,
          card: { type: 'cooling', data: r }, chips: ['What does this loan really cost?', 'Talk to a person'],
          passport: { title: 'Cooling-off explained', evidence: [{ field: 'Key Fact Statement', value: `${r.days} day cooling-off`, source: offer.id, asOf: offer.issuedOn }], formula: 'Stated in the KFS, checked against the RBI minimum', result: `${r.days} days after signing`, pack: r.pack, action: 'Explained, not executed' },
          computed: r,
        };
      }
      return {
        reply: r.open
          ? `Yes, you can still leave. Your window closes on ${r.endsLabel}, ${r.daysLeft} days from now. To exit, you repay about ${inr(r.exitCost)}, with no penalty.`
          : `Your cooling-off window closed on ${r.endsLabel}. Closing now follows the lender's foreclosure terms.`,
        card: { type: 'cooling', data: r }, chips: ['Can I close the loan early without a penalty?', 'Talk to a person'],
        passport: { title: 'Cooling-off tracked', evidence: [{ field: 'Signed on', value: r.signedOn, source: 'Customer', asOf: ctx.today }], formula: r.formula, result: `Window ends ${r.endsLabel}`, pack: r.pack, action: 'Explained, not executed' },
        computed: r,
      };
    },
  },
  foreclosure_question: {
    agent: 'lending', journey: 'lending', stage: 'explain', params: offerArg,
    description: 'Answer whether a loan can be closed early and what it costs.',
    run(ctx) {
      const offer = offerFor(ctx);
      const r = foreclosureTerms(offer);
      if (r.known) {
        return {
          reply: `Closing early: ${r.terms}.`, card: { type: 'note', data: { title: 'Closing the loan early', body: r.terms, tone: 'ok' } }, chips: ['What does this loan really cost?'],
          passport: { title: 'Foreclosure terms explained', evidence: [{ field: 'Source', value: r.source, source: offer.id, asOf: offer.issuedOn }], formula: 'Read from the KFS or the RBI rule', result: r.terms, pack: r.pack, action: 'Explained, not executed' },
          computed: r,
        };
      }
      return {
        reply: `I do not have this answer, and I will not guess. ${r.reason} Shall I ask an expert to confirm it with the lender and call you back?`,
        replyHi: `मैं इसका अंदाज़ा नहीं लगाऊँगी। लेंडर के KFS में फ़ोरक्लोज़र शुल्क नहीं दिया गया है। क्या मैं किसी विशेषज्ञ से पुष्टि करवाकर आपको कॉल बैक करवाऊँ?`,
        card: { type: 'note', data: { title: 'Not in the Key Fact Statement', body: `${r.reason} For a fixed-rate loan, these follow ${r.ruleNote}. MITRA will not guess.`, tone: 'warn' } },
        chips: ['Yes, ask an expert', 'No, not now'],
        confirm: { tool: 'handoff_to_human', args: { reason: 'not_in_kfs' }, carry: { why: `${r.reason} MITRA will not guess them.`, next: 'Confirm foreclosure terms with the lender', askedText: ctx.turnQuestion() } },
        passport: { title: 'Foreclosure question: declined to guess', evidence: [{ field: 'Key Fact Statement', value: 'Foreclosure charges not stated', source: offer.id, asOf: offer.issuedOn }], formula: 'No formula: the input is not in the KFS', result: 'Not answered, offered a person', pack: r.pack, action: 'Explained, not executed' },
        computed: r,
      };
    },
  },
  prepay_vs_invest: {
    agent: 'lending', journey: 'lending', stage: 'explain', params: offerArg,
    description: 'The customer has spare money, a bonus or savings and wonders whether to repay the loan early or put it in a SIP, FD, gold or a fund.',
    run(ctx) {
      const offer = offerFor(ctx);
      const extra = parseAmount(ctx.turn.textEn) || 50000;
      const r = prepayVsInvest(offer, { extra });
      return {
        reply: `Prepaying ${inr(extra)} saves about ${inr(r.interestSaved)} in interest and ${r.monthsSaved} months of EMIs. Investing it at an assumed ${pct(r.investReturnPct)} could earn about ${inr(r.investGain)}, but that is not guaranteed. ${r.better === 'prepay' ? 'Prepaying looks better here,' : 'Investing could earn more here,'} if the lender charges nothing for prepaying, which I would confirm first.`,
        card: { type: 'prepay', data: r }, chips: ['Can I close the loan early without a penalty?', 'Talk to a person'],
        passport: { title: 'Prepay vs invest compared', evidence: [{ field: 'Key Fact Statement', value: `${pct(offer.ratePct)} over ${offer.months} months`, source: offer.id, asOf: offer.issuedOn }, { field: 'Assumption', value: r.assumption, source: 'MITRA default', asOf: ctx.today }], formula: r.formula, result: `${inr(r.interestSaved)} saved vs ${inr(r.investGain)} possible`, pack: r.pack, action: 'Explained, not executed' },
        computed: r,
      };
    },
  },
  record_loan_decision: {
    agent: 'lending', journey: 'lending', stage: 'decide',
    params: { type: 'object', additionalProperties: false, properties: { choice: { type: 'string', enum: ['take', 'decline'] } }, required: ['choice'] },
    description: 'Record, in the customer’s words, that they want to go ahead with the loan or walk away. Nothing is signed.',
    run(ctx) {
      const take = ctx.args.choice === 'take';
      ctx.session.decisions.loan = ctx.args.choice;
      const r = { choice: ctx.args.choice, words: ctx.turn.text };
      return {
        reply: take
          ? 'Noted. Your application is pre-filled from what you told me, so only your PAN and bank account are left, on the lender’s secure page. I do not sign or pay for you. Tell me when you have signed, and I will track your exit window.'
          : 'Noted. Nothing has been signed or shared, and there is no pressure. Your record stays yours.',
        card: take
          ? { type: 'application', data: {
            words: ctx.turn.text, status: 'Ready for the lender. Sending needs a partner connection.',
            filled: [['Name', ctx.session.customer.name], ['Loan amount', inr(LOAN_OFFERS[OFFER_ID].principal)], ['Tenure', `${LOAN_OFFERS[OFFER_ID].months} months`], ['Offer', OFFER_ID], ...(ctx.session.facts.income ? [['Monthly income', inr(ctx.session.facts.income.value)]] : [])],
            left: ['PAN', 'Bank account'],
          } }
          : { type: 'note', data: { title: 'You chose to walk away', body: `“${ctx.turn.text}”. MITRA explains. You decide. Nothing is signed here.`, tone: 'info' } },
        chips: take ? ['I have signed the loan', 'How long is the cooling-off?'] : ['How much insurance do I need?', 'Is this message a scam?'],
        passport: { title: take ? 'Decision: go ahead with the loan' : 'Decision: walked away', evidence: [{ field: 'Customer said', value: ctx.turn.text.slice(0, 200), source: 'Customer', asOf: ctx.today }], formula: 'No formula: the customer’s own choice', result: take ? 'Going ahead with the lender' : 'Not proceeding', pack: packStamp(PACKS.lending), action: 'Recorded, not executed' },
        computed: r,
      };
    },
  },
  mark_loan_signed: {
    agent: 'lending', journey: 'lending', stage: 'complete', params: offerArg,
    description: 'Only when the customer simply reports having signed and asks nothing else. If they ask about cancelling, use cooling_off_status.',
    run(ctx) {
      const offer = offerFor(ctx);
      ctx.session.decisions.loanSignedOn = ctx.today;
      const r = coolingOffStatus(offer, { signedOn: ctx.today, today: ctx.today });
      addReminder(ctx.session, { id: 'cooling-off', label: 'Loan cooling-off ends', on: r.remindOn, ends: r.endsOn });
      remember(ctx.session, 'cooling-off reminder set');
      return {
        reply: `Your ${r.days} day cooling-off window is now running and closes on ${r.endsLabel}. To exit before then, you repay about ${inr(r.exitCost)}, with no penalty. I will remind you on ${r.remindLabel}.`,
        card: { type: 'cooling', data: r }, chips: ['Can I close the loan early without a penalty?', 'That is all, thank you'],
        passport: { title: 'Loan signed with the lender: cooling-off tracked', evidence: [{ field: 'Signed on', value: ctx.today, source: 'Customer', asOf: ctx.today }], formula: r.formula, result: `Window ends ${r.endsLabel}`, pack: r.pack, action: 'Tracked, not executed' },
        computed: r,
      };
    },
  },

  // ── insurance ────────────────────────────────────────────────
  protection_gap: {
    agent: 'insurance', journey: 'insurance', stage: 'explain', params: noArgs,
    description: 'Work out how much life and health cover the family needs against what they have.',
    needs: [NEED.income('insurance_needs', 'To work out your cover, I need a few facts.'), NEED.dependants, NEED.existingLife, NEED.existingHealth],
    run(ctx) {
      const r = protectionGap({ ...ctx.facts, city: ctx.session.customer.profile.city });
      ctx.session.decisions.gap = r;
      remember(ctx.session, `Life cover gap ${inr(r.life.gap)}, health gap ${inr(r.health.gap)}`);
      return {
        reply: `On your ${inr(ctx.facts.income)} income, with ${r.dependants} people depending on it, a sensible life cover is ${inr(r.life.target)}. You have ${inr(r.life.existing)}, so you are short by ${inr(r.life.gap)}. For health, you are short by ${inr(r.health.gap)}.`,
        simple: `If something happens to you, your family needs ${inr(r.life.target)}. You have ${inr(r.life.existing)}. You are short by ${inr(r.life.gap)}.`,
        replyHi: `आप पर ${r.dependants} लोग निर्भर हैं, इसलिए ${inr(r.life.target)} का जीवन बीमा ठीक रहेगा। आपके पास ${inr(r.life.existing)} है, यानी ${inr(r.life.gap)} की कमी है। स्वास्थ्य बीमा का लक्ष्य ${inr(r.health.target)} है, आपके पास ${inr(r.health.existing)} है, और कमी ${inr(r.health.gap)} की है।`,
        card: { type: 'gap', data: r }, chips: ['Explain the plans in simple words', 'How long can I return a policy?', 'Talk to a person'],
        passport: {
          title: 'Protection gap worked out',
          evidence: [{ field: 'Income', value: inr(ctx.facts.income), source: 'Customer, shared once', asOf: ctx.today }, { field: 'Dependants', value: String(r.dependants), source: 'Customer', asOf: ctx.today }, { field: 'Existing cover', value: `Life ${inr(r.life.existing)}, health ${inr(r.health.existing)}`, source: 'Customer', asOf: ctx.today }],
          formula: r.formula, result: `Life gap ${inr(r.life.gap)}, health gap ${inr(r.health.gap)}`, pack: r.pack, action: 'Explained, not executed', consent: consentStamps(ctx, ['insurance_needs']),
        },
        computed: { ...r, income: ctx.facts.income },
      };
    },
  },
  explain_plans: {
    agent: 'insurance', journey: 'insurance', stage: 'decide', params: noArgs,
    description: 'Explain the plan types side by side in plain words: term life, family health, super top-up.',
    run(ctx) {
      const r = explainPlans(INSURANCE_PLANS, ctx.session.decisions.gap);
      const [term, floater, topup] = r.plans;
      return {
        reply: `Three kinds. A term plan pays your family if you die: ${inr(term.cover)} for ${inr(term.premiumYear)} a year. A family health plan pays hospital bills: ${inr(floater.cover)} for ${inr(floater.premiumYear)} a year. A top-up pays only above ${inr(topup.deductible)}, for ${inr(topup.premiumYear)} a year. These are sample prices.`,
        simple: 'A term plan is for your family if you die. A health plan is for hospital bills. A top-up adds more health cover cheaply.',
        card: { type: 'plans', data: r }, chips: ['How long can I return a policy?', 'I bought the family floater', 'Talk to a person'],
        passport: { title: 'Plan types explained', evidence: r.plans.map((plan) => ({ field: plan.type, value: `${inr(plan.cover)} for ${inr(plan.premiumYear)} a year`, source: 'Sample catalogue', asOf: ctx.today })), formula: r.formula, result: `${r.plans.length} plan types compared`, pack: r.pack, action: 'Explained, not executed' },
        computed: r,
      };
    },
  },
  free_look_status: {
    agent: 'insurance', journey: 'insurance', stage: 'complete', params: noArgs,
    description: 'The customer regrets buying an insurance policy and asks to return it or get a refund.',
    run(ctx) {
      const r = freeLookStatus(ISSUED_POLICY, { today: ctx.today });
      addReminder(ctx.session, { id: 'free-look', label: 'Free-look window ends', on: r.remindOn, ends: r.endsOn });
      remember(ctx.session, 'free-look reminder set');
      return {
        reply: r.open
          ? `Yes. You can return it until ${r.endsLabel}, ${r.daysLeft} days from now, and get most of your ${inr(r.premium)} back. I will remind you on ${r.remindLabel}.`
          : `The ${r.days} day free-look on ${r.policyName} ended on ${r.endsLabel}.`,
        card: { type: 'window', data: r }, chips: ['My claim was cut, why?', 'That is all, thank you'],
        passport: { title: 'Free-look window tracked', evidence: [{ field: 'Policy received', value: r.receivedOn, source: r.policyId, asOf: ctx.today }], formula: r.formula, result: `Free-look ends ${r.endsLabel}`, pack: r.pack, action: 'Tracked, not executed' },
        computed: r,
      };
    },
  },

  // ── claims ───────────────────────────────────────────────────
  claim_checklist: {
    agent: 'claims', journey: 'claims', stage: 'complete', params: noArgs,
    description: 'Build the document checklist and deadlines to file a health claim, and pre-fill the intimation.',
    run(ctx) {
      const r = claimChecklist({ claim: NEW_CLAIM, wording: POLICY_WORDING, have: ctx.session.decisions.claimDocs, today: ctx.today });
      addReminder(ctx.session, { id: 'claim-documents', label: 'Claim documents due', on: r.documentsBy, ends: r.documentsBy });
      remember(ctx.session, 'claim checklist built');
      return {
        reply: r.late
          ? `The ${r.documentsByLabel} date for documents has passed. Send what you have now, with a note saying why it is late. You need ${r.total} documents, and I have pre-filled your claim intimation.`
          : `You need ${r.total} documents, and ${r.missing} are still to come. Send them by ${r.documentsByLabel}, ${r.daysLeft} days from now. I have pre-filled your claim intimation from what is on record. It is a draft and nothing has been submitted.`,
        replyHi: `आपको ${r.total} दस्तावेज़ चाहिए। इन्हें ${r.documentsByLabel} तक भेजें। क्लेम की सूचना मैंने भर दी है, पर अभी जमा नहीं की है।`,
        card: { type: 'checklist', data: r }, chips: ['My claim was cut, why?', 'I have the discharge summary and bills', 'Talk to a person'],
        passport: { title: 'Claim checklist and deadlines', evidence: [{ field: 'Policy wording', value: POLICY_WORDING.clauses.documents, source: POLICY_WORDING.id, asOf: ctx.today }, { field: 'Discharged on', value: r.dischargedOn, source: NEW_CLAIM.id, asOf: ctx.today }], formula: r.formula, result: `${r.total} documents, due ${r.documentsByLabel}`, pack: r.pack, action: 'Drafted, not submitted' },
        computed: r,
      };
    },
  },
  mark_claim_documents: {
    agent: 'claims', journey: 'claims', stage: 'complete', params: noArgs,
    description: 'The customer says which claim documents they already have.',
    run(ctx) {
      const said = ctx.turn.textEn.toLowerCase();
      const map = { discharge: /discharge/, bills: /\bbills?\b/, receipts: /receipt/, reports: /report|prescription/, id: /\bid\b|aadhaar|pan\b/, bank: /cheque|bank/, claim_form: /claim form/ };
      const docs = new Set(ctx.session.decisions.claimDocs);
      for (const [id, re] of Object.entries(map)) if (re.test(said)) docs.add(id);
      ctx.session.decisions.claimDocs = [...docs];
      const r = claimChecklist({ claim: NEW_CLAIM, wording: POLICY_WORDING, have: ctx.session.decisions.claimDocs, today: ctx.today });
      const next = r.docs.find((doc) => !doc.have);
      return {
        reply: r.missing ? `Good. ${r.missing} documents are left, due by ${r.documentsByLabel}. Next: ${next.label}.` : `That is everything, ahead of the ${r.documentsByLabel} date. The insurer should decide within ${r.decisionDays} days of the last document.`,
        card: { type: 'checklist', data: r }, chips: ['My claim was cut, why?', 'That is all, thank you'],
        passport: { title: 'Claim documents updated', evidence: [{ field: 'Customer said', value: ctx.turn.text.slice(0, 200), source: 'Customer', asOf: ctx.today }], formula: r.formula, result: `${r.total - r.missing} of ${r.total} documents`, pack: r.pack, action: 'Tracked, not executed' },
        computed: r,
      };
    },
  },
  explain_claim_deductions: {
    agent: 'claims', journey: 'claims', stage: 'explain', params: noArgs,
    description: 'Explain every deduction on a settled health claim against the policy wording and flag any that look wrong.',
    run(ctx) {
      const r = explainDeductions({ claim: CLAIM, wording: POLICY_WORDING });
      // The customer named a figure that is not on this claim: it may not be this claim.
      const said = /\d/.test(ctx.turn.textEn) ? parseAmount(ctx.turn.textEn) : null;
      if (said && said >= 1000 && ![r.billed, r.paid, r.shortBy].includes(said)) {
        const carry = { why: `The customer mentioned ${inr(said)}, which does not match the claim on record.`, next: 'Find the right claim and explain the deductions', askedText: ctx.turnQuestion() };
        return {
          reply: `The claim I can see paid ${inr(r.paid)} on a ${inr(r.billed)} bill. That does not match the ${inr(said)} you said, so I will not guess. Shall I ask an expert to look at yours?`,
          card: { type: 'note', data: { title: 'This may be a different claim', body: `MITRA can see ${r.claimId}. It will not explain a claim it cannot see.`, tone: 'warn' } },
          chips: ['Yes, ask an expert', 'No, not now'], confirm: { tool: 'handoff_to_human', args: { reason: 'dispute' }, carry },
          computed: { paid: r.paid, billed: r.billed, said },
        };
      }
      ctx.session.decisions.claimAnalysis = r;
      remember(ctx.session, `Claim: ${inr(r.paid)} paid of ${inr(r.billed)}, ${inr(r.shortBy)} looks wrong`);
      return {
        reply: `The insurer paid ${inr(r.paid)} of your ${inr(r.billed)} bill. Most of the cut is right, because your room cost more than the limit. But pharmacy and diagnostics were cut too, and the IRDAI rule does not allow that. ${inr(r.shortBy)} looks wrong. Shall I draft a complaint?`,
        simple: `They paid ${inr(r.paid)}. They should have paid about ${inr(r.allowed)}. I can help you ask for the ${inr(r.shortBy)} difference.`,
        replyHi: `आपका बिल ${inr(r.billed)} था और बीमा कंपनी ने ${inr(r.paid)} दिए। ज़्यादातर कटौती सही है, क्योंकि कमरा पॉलिसी की सीमा से महँगा था। लेकिन दवाइयों और जाँच पर भी कटौती हुई, जो IRDAI नियम के ख़िलाफ़ है। ${inr(r.shortBy)} ग़लत लगते हैं। मैं शिकायत का मसौदा बना सकती हूँ।`,
        card: { type: 'claim', data: r }, chips: ['Draft the grievance', 'Talk to a person'],
        passport: { title: 'Claim deductions explained', evidence: r.evidence, formula: r.formula, result: `${inr(r.shortBy)} looks wrong on ${r.flagged.length} heads`, pack: r.pack, action: 'Explained, not executed' },
        computed: r,
      };
    },
  },
  draft_grievance: {
    agent: 'claims', journey: 'claims', stage: 'handover', params: noArgs,
    description: 'Draft a grievance letter with the evidence for a wrong claim deduction.',
    run(ctx) {
      const analysis = ctx.session.decisions.claimAnalysis || explainDeductions({ claim: CLAIM, wording: POLICY_WORDING });
      const r = draftGrievance({ claim: CLAIM, analysis, customerName: ctx.session.customer.name, today: ctx.today });
      addReminder(ctx.session, { id: 'grievance', label: 'Insurer reply due', on: r.respondBy, ends: r.respondBy });
      remember(ctx.session, `Grievance drafted for ${inr(r.shortBy)}`);
      return {
        reply: `Your complaint for ${inr(r.shortBy)} is drafted, not sent. The insurer has ${r.firstComplaintDays} days to reply, and after that you can go to the Ombudsman. Shall I ask an expert to check it first?`,
        card: { type: 'grievance', data: r }, chips: ['Yes, ask an expert', 'No, not now'],
        confirm: { tool: 'handoff_to_human', args: { reason: 'dispute' }, carry: { why: `A disputed claim deduction of ${inr(r.shortBy)}.`, next: 'Review the grievance draft and send it to the insurer', askedText: ctx.turnQuestion() } },
        passport: { title: 'Grievance drafted', evidence: [{ field: 'Claim', value: CLAIM.id, source: CLAIM.policyId, asOf: ctx.today }, { field: 'Route', value: r.route, source: 'Grievance routes', asOf: ctx.today }], formula: r.formula, result: `${inr(r.shortBy)} requested`, pack: r.pack, action: 'Drafted, not sent' },
        computed: r,
      };
    },
  },

  // ── payment safety ───────────────────────────────────────────
  check_payment_request: {
    agent: 'safety', journey: 'payments', stage: 'explain',
    params: { type: 'object', additionalProperties: false, properties: { message_text: { type: 'string', maxLength: 1000 } } },
    description: 'Check a payment request, collect request, forward or offer for scam red flags before the customer pays.',
    run(ctx) {
      const text = ctx.turn.text === ctx.turn.textEn ? ctx.turn.text : `${ctx.turn.textEn}\n${ctx.turn.text}`;
      const r = checkPaymentRequest(ctx.args.message_text ? `${ctx.args.message_text}\n${text}` : text, { modelRisk: ctx.turn.modelRisk });
      if (!r.flags.length && isOnlyAsking(ctx.turn.textEn)) {
        return {
          reply: 'Please read me the message, or tell me what they asked you to do. Until I have checked it, do not pay and do not share your PIN or OTP.',
          card: { type: 'note', data: { title: 'Read it out to MITRA', body: 'Offer X-Ray checks the actual words. It will not call a message safe without reading it.', tone: 'info' } },
          chips: [SAMPLE_MESSAGES.loanScam, SAMPLE_MESSAGES.collect, 'Talk to a person'], computed: {},
        };
      }
      if (r.verdict === 'stop') ctx.session.metrics.riskyStopped += 1;
      const top = r.flags.slice(0, 3);
      const flagLine = top.length ? top[0].why : '';
      const lead = { stop: 'Please stop. Do not pay.', caution: 'Pause before you pay.', clear: '' }[r.verdict];
      const distress = /\b(on the (phone|line|call)|calling me|told me to|pressur\w*|scared|afraid|threat\w*|forcing|forced)\b/i.test(ctx.turn.textEn);
      remember(ctx.session, `Offer X-Ray: ${r.verdict}, ${r.flags.length} red flags`);
      return {
        reply: `${lead} ${flagLine} ${{ stop: `If you already paid, call ${r.helpline} right away.`, caution: r.action, clear: r.action }[r.verdict]}`.replace(/\s+/g, ' ').trim(),
        simple: { stop: 'Do not pay anyone. Do not share your PIN or OTP.', caution: 'Wait. Check it in your own app before you pay.', clear: 'I see nothing wrong, but pay only someone you know.' }[r.verdict],
        replyHi: { stop: `कृपया रुकिए, पैसे न भेजें। मुझे ${r.flags.length} ख़तरे के संकेत मिले। अपना PIN न डालें। अगर पैसे भेज चुके हैं, तो तुरंत 1930 पर कॉल करें।`, caution: 'भुगतान से पहले रुकिए और इसे अपने ऐप में जाँचिए।', clear: 'मुझे इसमें कोई ख़तरे का संकेत नहीं मिला, फिर भी केवल जान-पहचान वाले को ही भुगतान करें।' }[r.verdict],
        card: { type: 'risk', data: r }, chips: r.verdict === 'stop' ? ['Talk to a person', 'What does this loan really cost?'] : ['Check another message', 'Talk to a person'],
        handoff: distress ? { reason: 'distress', why: 'Signs of a scam or distress: someone is pressing the customer to pay.', next: 'Call now and stay on the line until the customer is safe' } : null,
        passport: { title: 'Offer X-Ray: request checked before the PIN', evidence: [{ field: 'Message checked', value: r.checkedText.slice(0, 200), source: 'Customer', asOf: ctx.today }, ...r.flags.slice(0, 5).map((flag) => ({ field: 'Red flag', value: flag.label, source: 'Safety rules', asOf: ctx.today }))], formula: r.formula, result: `${{ stop: 'Do not pay', caution: 'Pause and check', clear: 'No red flags' }[r.verdict]}, score ${r.score}`, pack: r.pack, action: 'Checked, not paid' },
        computed: r,
      };
    },
  },

  // ── merchant ─────────────────────────────────────────────────
  merchant_sales_summary: {
    agent: 'merchant', journey: 'merchant', stage: 'explain', params: noArgs,
    description: 'A shopkeeper asks how much they sold or collected, or how their sales are going.',
    run(ctx) {
      // One customer's sales are never read out to another.
      if (ctx.session.customer.kind !== 'merchant') {
        return { reply: 'I only have sales for a shop that has connected its Soundbox, and there is none on this call. I can help with a loan, insurance, a claim or a payment.', card: null, chips: ['What does this loan really cost?', 'Talk to a person'], computed: {} };
      }
      const { months, source } = MERCHANT_SALES;
      const last = months.at(-1), before = months.at(-2);
      const change = Math.round(((last.sales - before.sales) / before.sales) * 1000) / 10;
      const best = months.reduce((top, month) => (month.sales > top.sales ? month : top), months[0]);
      return {
        reply: `In ${last.month} you collected ${inr(last.sales)}, ${change >= 0 ? `up ${pct(Math.abs(change))}` : `down ${pct(Math.abs(change))}`} on ${before.month}. Your best month was ${best.month}, at ${inr(best.sales)}.`,
        card: { type: 'note', data: { title: 'Your sales', body: `${months.map((month) => `${month.month}: ${inr(month.sales)}`).join(' · ')}. Source: ${source}.`, tone: 'blue' } },
        chips: ['I need money for stock for my shop', 'That is all, thank you'],
        computed: { months, change: Math.abs(change) },
      };
    },
  },
  merchant_eligibility: {
    agent: 'merchant', journey: 'merchant', stage: 'explain', params: noArgs, merchantOnly: true,
    description: 'Check a shopkeeper’s working capital eligibility from their consented Soundbox sales summary and explain the offer.',
    needs: [{ field: 'salesSummary', purpose: 'merchant_credit', label: 'Soundbox sales summary', ask: 'May I look at your Soundbox sales summary?' }],
    run(ctx) {
      const eligibility = merchantEligibility(MERCHANT_SALES);
      const r = explainMerchantOffer(MERCHANT_OFFER, eligibility);
      ctx.session.decisions.merchant = { eligibility, offer: r };
      remember(ctx.session, `Working capital: ${inr(r.principal)} at ${pct(r.aprPct)} APR, ${inr(r.dailyRepayment)} a day`);
      return {
        reply: `Your Soundbox sales average ${inr(eligibility.averageMonthly)} a month, so you may get up to ${inr(eligibility.limit)}. One offer: you get ${inr(r.net)} and pay ${inr(r.dailyRepayment)} a day for ${r.days} days. The real yearly cost is ${pct(r.aprPct)}. Shall I prepare a brief for the lender, with no form?`,
        simple: `You get ${inr(r.net)} now and pay ${inr(r.dailyRepayment)} every day for ${r.days} days.`,
        replyHi: `आपकी साउंडबॉक्स बिक्री औसतन ${inr(eligibility.averageMonthly)} महीना है। आपको ${inr(eligibility.limit)} तक मिल सकते हैं। एक ऑफ़र ${inr(r.principal)} का है, ${r.days} दिनों के लिए, ${inr(r.dailyRepayment)} रोज़। असली सालाना लागत ${pct(r.aprPct)} है। क्या मैं लेंडर को आपकी जानकारी भेजूँ?`,
        card: { type: 'merchant', data: { ...r, eligibility } }, chips: ['Yes, send it to the lender', 'No, not now', 'Talk to a person'],
        confirm: { tool: 'send_lender_brief', args: {} },
        passport: { title: 'Working capital explained', evidence: r.evidence, formula: r.formula, result: `${pct(r.aprPct)} APR, ${inr(r.dailyRepayment)} a day`, pack: r.pack, action: 'Explained, not executed', consent: consentStamps(ctx, ['merchant_credit']) },
        computed: { ...r, eligibility },
      };
    },
  },
  send_lender_brief: {
    merchantOnly: true, agent: 'merchant', journey: 'merchant', stage: 'complete', params: noArgs,
    description: 'Prepare a ready application brief for the partner lender, with no 12-field form.',
    run(ctx) {
      const started = ctx.session.startedAt ? Date.parse(ctx.session.startedAt) : ctx.now;
      const seconds = Math.max(Math.round((ctx.now - started) / 1000), 1);
      const saved = ctx.session.decisions.merchant || {};
      const r = { merchant: ctx.session.customer.name, amount: saved.offer?.principal ?? MERCHANT_OFFER.principal, averageMonthly: saved.eligibility?.averageMonthly, seconds, status: 'Brief ready. Sending to a lender needs a partner connection.' };
      ctx.session.metrics.intentToApplicationSeconds = seconds;
      return {
        reply: `Your brief is ready, and you did not fill any form. The lender would call you to confirm and read the Key Fact Statement. You sign only with them.`,
        card: { type: 'lenderBrief', data: r }, chips: ['How long is the cooling-off?', 'That is all, thank you'],
        passport: { title: 'Lender brief prepared', evidence: [{ field: 'Sales summary', value: MERCHANT_SALES.source, source: 'Consented data', asOf: ctx.today }], formula: 'Brief assembled from the sealed explanation', result: `${inr(r.amount)} requested`, pack: packStamp(PACKS.merchant), action: 'Drafted, not sent', consent: consentStamps(ctx, ['merchant_credit']) },
        computed: r,
      };
    },
  },

  // ── onboarding and consent ───────────────────────────────────
  show_consents: {
    agent: 'onboarding', journey: 'onboarding', stage: 'onboard', params: noArgs,
    description: 'Say what the customer has agreed to share, for which purpose, and until when.',
    run(ctx) {
      const live = ctx.session.consents.filter((grant) => grant.status === 'active');
      const r = { live, count: live.length };
      return {
        reply: live.length ? `You have agreed to ${live.length} ${live.length === 1 ? 'use' : 'uses'} of your data. ${live.map((grant) => `${grant.label}, until ${grant.expiresOn}`).join('. ')}. You can withdraw any of them, just say so.` : 'You have not shared anything with me yet.',
        card: { type: 'consents', data: r }, chips: ['Withdraw my income consent', 'That is all, thank you'],
        computed: r,
      };
    },
  },
  revoke_consent: {
    agent: 'onboarding', journey: 'onboarding', stage: 'onboard',
    params: { type: 'object', additionalProperties: false, properties: { purpose: { type: 'string', enum: Object.keys(PURPOSES) } }, required: ['purpose'] },
    description: 'The customer says not to use, or to remove, information they shared such as income.',
    run(ctx) {
      const grant = revokeConsent(ctx.session, ctx.args.purpose, { now: ctx.now });
      const label = PURPOSES[ctx.args.purpose]?.label || 'that use';
      if (!grant) return { reply: 'You have no active consent for that, so there is nothing to withdraw.', card: null, chips: ['What have I shared?'], computed: {} };
      return {
        reply: `Done. ${label}: withdrawn. No agent can read it for this purpose now, and this is on your record.`,
        replyHi: 'हो गया। आपकी सहमति वापस ले ली गई है। अब कोई एजेंट इस काम के लिए यह जानकारी नहीं पढ़ सकता।',
        card: { type: 'consents', data: { live: ctx.session.consents.filter((item) => item.status === 'active'), count: 0, revoked: grant } }, chips: ['What does this loan really cost?', 'What have I shared?'],
        passport: { title: 'Consent withdrawn', evidence: [{ field: 'Purpose', value: grant.label, source: 'Customer', asOf: ctx.today }], formula: 'No formula: the customer’s own choice', result: 'Withdrawn', pack: packStamp(PACKS.privacy), action: 'Recorded, not executed', consent: [{ id: grant.id, purpose: grant.purpose, label: grant.label, expiresOn: grant.revokedOn, days: 0, status: 'revoked' }] },
        computed: { grant },
      };
    },
  },
  close_journey: {
    agent: 'orchestrator', journey: 'close', stage: 'resolve', params: noArgs,
    description: 'The customer is done. Close the journey and seal the outcome.',
    run(ctx) {
      const r = { reminders: ctx.session.reminders, explained: ctx.session.explained };
      return {
        reply: ctx.session.reminders.length ? `You are welcome. I will remind you about ${ctx.session.reminders.map((item) => item.label.toLowerCase()).join(' and ')}. Your record of this call is sealed and yours to keep.` : 'You are welcome. Your record of this call is sealed and yours to keep.',
        replyHi: 'आपका स्वागत है। इस कॉल का रिकॉर्ड सील कर दिया गया है और वह आपका है।',
        card: { type: 'closed', data: r }, chips: [],
        passport: { title: 'Journey closed', evidence: ctx.session.explained.slice(-6).map((line) => ({ field: 'Covered', value: line, source: 'This call', asOf: ctx.today })), formula: 'No formula: summary of sealed receipts', result: 'Closed by the customer', pack: packStamp(PACKS.privacy), action: 'Closed, nothing executed' },
        computed: r,
      };
    },
  },
  fraud_emergency: {
    agent: 'safety', journey: 'payments', stage: 'handover', params: noArgs,
    description: 'The customer has already paid or lost money to a scam. Tell them what to do right now.',
    run(ctx) {
      const r = checkPaymentRequest(ctx.turn.textEn);
      const pack = PACKS.payments;
      ctx.session.metrics.riskyStopped += 1;
      remember(ctx.session, 'Customer reports money already lost to a scam');
      return {
        reply: `Call ${pack.rules.helpline} right now. It is the national cyber fraud helpline, and the first hours matter most. Then ask your bank to block the payment, and report it at ${pack.rules.portal}. I am also asking a person to call you now.`,
        replyHi: `अभी ${pack.rules.helpline} पर कॉल करें। यह साइबर फ्रॉड हेल्पलाइन है, और शुरुआती घंटे सबसे ज़रूरी हैं। फिर अपने बैंक से कहें। मैं किसी व्यक्ति से भी अभी आपको कॉल करवा रही हूँ।`,
        simple: `Call ${pack.rules.helpline} now.`,
        card: { type: 'risk', data: { ...r, verdict: 'stop', action: `Call ${pack.rules.helpline} now, then your bank, then report at ${pack.rules.portal}.`, emergency: true } },
        chips: ['Talk to a person', 'That is all, thank you'],
        handoff: { reason: 'distress', why: 'The customer says money has already been lost to a scam.', next: 'Call now. Help them reach 1930 and their bank' },
        passport: { title: 'Fraud reported: told to call the helpline', evidence: [{ field: 'Customer said', value: ctx.turn.text.slice(0, 200), source: 'Customer', asOf: ctx.today }], formula: 'No formula: the first step is always the helpline', result: `Told to call ${pack.rules.helpline}`, pack: packStamp(pack), action: 'Checked, not paid' },
        computed: { helpline: pack.rules.helpline },
      };
    },
  },
  explain_term: {
    agent: 'orchestrator', journey: 'none', stage: null,
    params: { type: 'object', additionalProperties: false, properties: { term: { type: 'string', enum: Object.keys(TERM_TEXT) } }, required: ['term'] },
    description: 'Explain a financial word in plain language: APR, EMI, KFS, cooling-off, free-look, waiting period, processing fee, foreclosure, sum insured, deductible, premium.',
    run(ctx) {
      return {
        reply: TERM_TEXT[ctx.args.term], simple: TERM_TEXT[ctx.args.term],
        card: { type: 'note', data: { title: 'In plain words', body: TERM_TEXT[ctx.args.term], tone: 'info' } },
        chips: ['What does this loan really cost?', 'Talk to a person'], computed: {},
      };
    },
  },
  repeat_last: { agent: 'orchestrator', journey: 'none', stage: null, params: noArgs, description: 'The customer asks MITRA to say the last thing again.', run: null },
  say_simpler: { agent: 'orchestrator', journey: 'none', stage: null, params: noArgs, description: 'The customer did not understand the last answer and needs it said more simply.', run: null },
  whats_possible: {
    agent: 'orchestrator', journey: 'none', stage: null, params: noArgs,
    description: 'Greet the customer or say what MITRA can help with.',
    run() {
      return {
        reply: 'I can tell you what a loan really costs, work out how much insurance you need, help file a claim, or check a payment request before you enter your PIN. What would you like?',
        replyHi: 'मैं बता सकती हूँ कि लोन की असली लागत कितनी है, कितना बीमा चाहिए, क्लेम कैसे करें, और PIN डालने से पहले कोई पेमेंट रिक्वेस्ट जाँच सकती हूँ। आप क्या जानना चाहेंगे?',
        card: { type: 'menu', data: {} }, chips: ['What does this loan really cost?', 'How much insurance do I need?', 'My claim was cut, why?', 'Is this message a scam?'],
        computed: {},
      };
    },
  },
  clarify_request: {
    agent: 'orchestrator', journey: 'none', stage: null, params: noArgs,
    description: 'Use when no other tool clearly fits. Ask the customer to clarify.',
    run() {
      return {
        reply: 'I want to get this right. Is it about a loan, insurance, a claim, or a payment someone asked you to make?',
        replyHi: 'मैं इसे सही समझना चाहती हूँ। क्या यह लोन, बीमा, क्लेम, या किसी पेमेंट रिक्वेस्ट के बारे में है?',
        card: { type: 'menu', data: {} }, chips: ['What does this loan really cost?', 'How much insurance do I need?', 'My claim was cut, why?', 'Talk to a person'],
        computed: {},
      };
    },
  },
  handoff_to_human: {
    agent: 'human', journey: 'handoff', stage: 'handover',
    params: { type: 'object', additionalProperties: false, properties: { reason: { type: 'string', enum: ['asked', 'not_sure', 'dispute', 'irreversible', 'distress', 'not_in_kfs', 'hardship'] } }, required: ['reason'] },
    description: 'Hand over to a human expert with a ready brief. Use when the customer asks for a person, disputes something, or the step is hard to undo.',
    run: null, // built by the orchestrator, which holds the whole conversation
  },
};

export const toolsForModel = () => Object.entries(TOOLS).map(([name, tool]) => ({
  type: 'function',
  function: { name, description: tool.description, parameters: tool.params },
}));

// Schema check for a tool call from a model. Enum, type and unknown-key checks
// are all this allow-list needs, because no argument carries a figure.
export function validateToolCall(call) {
  const tool = TOOLS[call?.name];
  if (!tool) return { ok: false, error: 'Tool is not on the allow-list' };
  const args = call.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, error: 'Arguments must be an object' };
  const { properties = {}, required = [] } = tool.params;
  for (const key of Object.keys(args)) if (!(key in properties)) return { ok: false, error: `Unexpected argument ${key}` };
  for (const key of required) if (args[key] === undefined) return { ok: false, error: `Missing argument ${key}` };
  for (const [key, value] of Object.entries(args)) {
    const spec = properties[key];
    if (spec.type && typeof value !== spec.type) return { ok: false, error: `Argument ${key} has the wrong type` };
    if (spec.enum && !spec.enum.includes(value)) return { ok: false, error: `Argument ${key} is not allowed` };
    if (spec.maxLength && value.length > spec.maxLength) return { ok: false, error: `Argument ${key} is too long` };
  }
  return { ok: true, value: { name: call.name, arguments: args } };
}

export { purposeLine };
