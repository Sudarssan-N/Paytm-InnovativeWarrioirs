// Picks one allow-listed tool for a turn.
//
// Safety rules catch what must never wait or be misread: a scam, a person in trouble,
// a request for a human. The model places everything else, because customers do not
// talk in keywords. Topic and broad rules are the fallback for when no model can be
// asked, and for tapped options, whose wording is known.
//
// Measured on blind test sets: the model routed 95% correctly and keyword rules 85%,
// and 16 of 18 wrong answers came from rules. "I run a tea shop, which insurance is
// good for my family?" matched "shop" and got a merchant loan.
// Either way the choice is schema-checked before anything runs.
import { toolsForModel, validateToolCall } from './tools.js';
import { LOAN_OFFERS } from './sampleData.js';
import { PURPOSES } from './consent.js';

const OFFER_ID = Object.keys(LOAN_OFFERS)[0];
const offer = { offer_id: OFFER_ID };

const purposeIn = (text) => ({
  purpose: /insurance|cover/i.test(text) ? 'insurance_needs' : /sales|soundbox/i.test(text) ? 'merchant_credit' : /expert|case/i.test(text) ? 'rm_handoff' : 'loan_eligibility',
});

const TERMS = [
  ['apr', /\bapr\b|annual percentage|real yearly cost/i], ['emi', /\bemi\b|\binstal+ment\b/i], ['kfs', /\bkfs\b|key facts? statement/i],
  ['cooling_off', /cooling[- ]?off/i], ['free_look', /free[- ]?look/i], ['waiting_period', /waiting period/i],
  ['processing_fee', /processing fee/i], ['foreclosure', /foreclos\w*|pre-?closure/i], ['sum_insured', /sum insured/i],
  ['deductible', /deductible/i], ['premium', /\bpremium\b/i],
];
const termIn = (text) => ({ term: TERMS.find(([, re]) => re.test(text))?.[0] || 'apr' });
const TERM_WORDS = TERMS.map(([, re]) => re.source).join('|');

const SCAM_CONTEXT = /\b(man|person|caller|someone|somebody|stranger|agent|link|otp|pin|upi|scam\w*|fraud\w*|cheat\w*|message|fake)\b/i;

// Checked in order. Both the English translation and the original words are searched.
const SAFETY = [
  // People in trouble come first: a loan explanation is the wrong answer here.
  [(t) => /\b(already|just)\s+(paid|sent|transferred|gave)\b|\b(money|amount|rupees|paisa)\b.{0,30}\b(gone|debited|stolen|lost)\b|\b(i|we) (was|were|got|have been|am) (cheated|scammed|duped|fooled)\b/i.test(t) && SCAM_CONTEXT.test(t), 'fraud_emergency', {}],
  [/\b(lost|losing) (my |our )?(job|work|income)\b|\b(can'?t|cannot|can not|unable to|not able to|won'?t be able to)\b.{0,12}\b(pay|repay|afford)\b|\b(laid off|no money left|medical emergency)\b/i, 'handoff_to_human', { reason: 'hardship' }],
  [/\b(talk|speak|connect|put|transfer|call|get)\b.{0,30}\b(person|human|man|agent|advisor|adviser|expert|rm|someone|somebody|anyone|manager|representative|senior|real)\b|\b(real person|human please|insaan se|aadmi se|machine se)\b|\bis this a (recording|robot|machine)\b/i, 'handoff_to_human', { reason: 'asked' }],
  [/\b(surrender)\b.{0,30}\b(policy|plan)\b/i, 'handoff_to_human', { reason: 'irreversible' }],
  [/\b(claim)\b.{0,50}\b(rejected|denied|refused)\b|\b(rejected|denied|refused)\b.{0,50}\b(claim)\b/i, 'handoff_to_human', { reason: 'dispute' }],

  // Only when asked for. A scam can mention a game too: "pay ₹500 for this online game".
  [(t) => /\bas a game\b|\b(play|show me|teach me|start|open)\b.{0,20}\bgame\b|\blearn by playing\b/i.test(t) && !/\b(pay|paid|fee|money|earn|win|won|prize|otp|pin|deposit)\b/i.test(t), 'learn_by_playing', {}],
  [/upi:\/\/(pay|mandate)\?/i, 'check_payment_request', {}],

  // Small conversational turns that keep a call human.
  [/\b(say (that|it) again|repeat|once more|come again|didn'?t (hear|catch)|phir se|dobara|marubadiyum)\b/i, 'repeat_last', {}],
  [(t) => new RegExp(`\\b(what|whats|what's|meaning|mean|means|define)\\b.{0,30}(${TERM_WORDS})`, 'i').test(t) && !/\d|\b(lakh|lac|crore|thousand|my|this|on|for|charges?|penalty|cost)\b/i.test(t), 'explain_term', termIn],
  // Only when that is the whole message. With a topic in it, the topic is the question.
  [(t) => t.split('\n')[0].trim().split(/\s+/).length <= 7 && /\b(did not|do not|did ?n'?t|do ?n'?t|cannot|can'?t|not able to) (understand|follow|get it)\b|\b(too (confusing|complicated)|simpler|samajh nahi|puriyala)\b|\b(say|tell|explain)\b.{0,12}\b(it|that)\b.{0,12}\bsimpl\w*/i.test(t), 'say_simpler', {}],

  [/\b(withdraw|revoke|take back)\b.{0,30}\b(consent|permission|income|data|sales|details|information|info)\b|\b(don'?t|do not|stop|never) (use|using|keep|keeping)\b.{0,30}\b(income|salary|money|details|information|info|data)\b|\b(delete|remove|erase)\b.{0,30}\b(my )?(income|salary|details|information|info|data|consent)\b/i, 'revoke_consent', purposeIn],
  [/\b(what|which)\b.{0,30}\b(have i shared|did i share|you know about me|consent|permission)\b|\bwhat have i\b/i, 'show_consents', {}],
  [/\b(that('?s| is) all|thank you|thanks|nothing else|bye|goodbye|dhanyavad|nandri)\b/i, 'close_journey', {}],

  // Scam checks sit above loan rules: "loan approved, pay the fee" is a scam, not a loan question.
  [/\b(is|are) (this|these|the|that) (message|sms|offer|call|link|request)\b.{0,20}\b(true|real|genuine|safe|correct|fake)\b|\b(scam|fraud|collect request|upi pin|enter (my |your |the )?pin|otp|cvv|whatsapp|forward(ed)?|kyc|lottery|digital arrest|anydesk|you (have )?won|refund of|prize)\b|\bpay\b.{0,50}\b(processing|registration|file|advance|token)\b.{0,12}\b(fee|charge)\b|\bloan\b.{0,40}\bapproved\b.{0,80}\b(pay|fee|instal\w*|deposit)\b/i, 'check_payment_request', {}],

];

const TOPICS = [
  [/\bhow much\b.{0,20}\b(did i|have i) (sell|sold|collect|collected)\b|\bhow (are|is) my (sales|business)\b|\bmy sales\b.{0,20}\b(this|last|so far|today)\b/i, 'merchant_sales_summary', {}],
  [/\b(fake|genuine|is (this|it) (real|safe))\b/i, 'check_payment_request', {}],
  [(t) => /\b(shop|store|soundbox|dukan|dukaan|kadai|merchant|stock|working capital|business loan|small business)\b/i.test(t) && !/\b(close|repay\w*|foreclos\w*|share market|shares?)\b/i.test(t), 'merchant_eligibility', {}],
  [/\b(send|share)\b.{0,30}\b(lender|application|brief)\b/i, 'send_lender_brief', {}],

  // Cancelling comes before "signed": "I just signed, can I cancel?" is a question.
  [/\bcooling[- ]?(off|period)\b|\b(cancel\w*|exit|back out|get out of|change my mind|changed my mind)\b.{0,40}\b(loan|agreement)\b|\b(loan|agreement)\b.{0,50}\b(cancel\w*|back out)\b|\bsigned\b.{0,90}\b(can i|cancel\w*|stop|back out|don'?t want|changed? my mind|roll back|undo|saying no)\b/i, 'cooling_off_status', offer],
  [(t) => /\b(i('?ve| have)? signed|signed (the|my) (loan|agreement))\b/i.test(t) && !/\?|\b(can|how|what|why)\b/i.test(t), 'mark_loan_signed', offer],
  [/\b(prepay|pre-pay|part[- ]?pay\w*)\b|\b(invest\w*|sip|mutual funds?|fd|fixed deposit|gold)\b.{0,60}\b(loan|emi)\b|\b(loan|emi)\b.{0,60}\b(invest\w*|sip|mutual funds?|fd|fixed deposit|gold)\b/i, 'prepay_vs_invest', offer],
  [/\b(close|closing|closed|finish|foreclos\w*|settle|pay off|paying off|paid off|repay\w*)\b.{0,40}\b(early|penalty|fine|charges?|before|advance|ahead|first)\b|\b(penalty|fine|charges?)\b.{0,50}\b(early|close|closing|closed|foreclos\w*|prepay\w*|pre-?closure|repay\w*|repaid|in advance|ahead of)\b|\bearly\b.{0,30}\b(close|closure|repay\w*|repaid|settle\w*)\b|\bforeclos\w*|\bpre-?closure\b/i, 'foreclosure_question', offer],
  [/\b(i('?ll| will| want to)? (take|accept)|go ahead|proceed)\b.{0,30}\b(loan|offer)\b/i, 'record_loan_decision', { choice: 'take' }],
  [/\b(i don'?t want|won'?t take|walk away|not taking|decline)\b.{0,30}\b(loan|offer)\b/i, 'record_loan_decision', { choice: 'decline' }],

  [/\b(free[- ]?look|return (a|the|my) policy|cancel (a|the|my) (policy|insurance))\b|\b(bought|purchased|took|taken)\b.{0,30}\b(floater|policy|plan|insurance)\b|\b(policy|insurance)\b.{0,50}\b(refund|money back|give (it )?back|return|don'?t want)\b/i, 'free_look_status', {}],
  [/\b(explain|compare|which|what|types?|kinds?|difference)\b.{0,30}\b(plans?|polic(y|ies))\b|\b(term plan|floater|top[- ]?up)\b|\bdifference\b.{0,30}\b(term|health|insurance)\b/i, 'explain_plans', {}],
  [/\b(how much|enough|right amount|need|gap)\b.{0,40}\b(insurance|cover|coverage|protection)\b|\b(insurance|cover|protected|protection)\b.{0,30}\b(enough|sufficient|do i need|is needed|gap)\b|\bam i (protected|covered|insured)\b/i, 'protection_gap', {}],

  [/\b(draft|write|raise|file|make)\b.{0,30}\b(grievance|complaint)\b|\b(complain|ombudsman)\b/i, 'draft_grievance', {}],
  [/\b(deduct\w*|cut|reduced|less|short|paid only|only paid)\b.{0,50}\b(claim|bill|hospital|settlement)\b|\b(claim|bill|settlement)\b.{0,50}\b(deduct\w*|cut|reduced|less|short)\b/i, 'explain_claim_deductions', {}],
  [/\b(i have|i've got|i got)\b.{0,40}\b(discharge|bills?|receipts?|reports?)\b/i, 'mark_claim_documents', {}],
  [/\b(file|start|raise|make|submit|lodge)\b.{0,30}\bclaim\b|\bclaim\b.{0,30}\b(documents?|papers?|how|process|file)\b|\b(documents?|papers?)\b.{0,30}\bclaim\b|\b(admitted|discharged|hospitali[sz]ed)\b/i, 'claim_checklist', {}],

  [(t) => /\b(loan|emi)\b/i.test(t) && /\d|\b(lakh|lac|crore|thousand)\b/i.test(t), 'explain_loan_offer', offer],
  [/\b(really cost|real cost|actual cost|true cost|exact cost|hidden charges?|key facts?|what does this loan)\b|\b(loan|offer)\b.{0,40}\b(charges?|interest|cost)\b|\b(charges?|interest|cost)\b.{0,40}\b(loan|offer)\b/i, 'explain_loan_offer', offer],

  [(t) => /^(hi|hello|hey|namaste|namaskar|vanakkam|good (morning|evening|afternoon))\b/i.test(t) && t.trim().split(/\s+/).length <= 3, 'whats_possible', {}],
  [/\bwhat can you do\b/i, 'whats_possible', {}],
];

// Used only when no model can be asked.
const BROAD = [
  [/\b(loan|emi|kfs|apr|interest|lon|karz|kadan)\b/i, 'explain_loan_offer', offer],
  [/\b(insurance|policy|cover|bima)\b/i, 'protection_gap', {}],
  [/\bclaim\b/i, 'claim_checklist', {}],
  [/^(hi|hello|hey|namaste|namaskar|vanakkam)\b|\bhelp me\b/i, 'whats_possible', {}],
];

const match = (rules, textEn, original) => {
  const haystack = original && original !== textEn ? `${textEn}\n${original}` : textEn;
  for (const [pattern, name, args] of rules) {
    const hit = typeof pattern === 'function' ? pattern(haystack) : pattern.test(haystack);
    if (hit) return { name, arguments: typeof args === 'function' ? args(haystack) : args };
  }
  return null;
};

export const routeSafety = (textEn, original = '') => match(SAFETY, textEn, original);
export const routeByRules = (textEn, original = '') => match(SAFETY, textEn, original) || match(TOPICS, textEn, original);
export const routeBroad = (textEn, original = '') => match(BROAD, textEn, original);

export const ROUTER_SYSTEM_PROMPT = `You route one customer turn for MITRA, an AI guide for Indian financial journeys. Call exactly one tool.
You never answer the customer. You never state or supply an amount, rate or date. Engines compute every figure.
How to choose:
- A loan they describe with an amount, rate or tenure, or a loan they want and ask about: explain_loan_offer.
- Asking for a game, or to learn by playing: learn_by_playing.
- A shopkeeper asking how much their shop sold or collected: merchant_sales_summary. A person asking for a loan is never this.
- Cancelling a loan they took or just signed, or how many days they have: cooling_off_status.
- Spare money, bonus or savings: repay the loan, or put it in SIP, FD, gold or a fund: prepay_vs_invest.
- Returning a policy they bought, or wanting a refund on it: free_look_status.
- Paid less than the bill, or the amount is less than expected: explain_claim_deductions.
- Unhappy with service or a settlement, or a delay: handoff_to_human with reason dispute.
- Do not use, or remove, what they shared: revoke_consent.
- A message or caller asking for money, OTP or PIN: check_payment_request.
- Shares, stock tips, crypto, or anything else unrelated to loans, insurance, claims or payment safety: clarify_request.
- Job loss, cannot pay, or anxious about money: handoff_to_human with reason hardship.
Offer ids available: ${Object.keys(LOAN_OFFERS).join(', ')}. Consent purposes: ${Object.keys(PURPOSES).join(', ')}.`;

// The model reads Indian languages itself, and machine translation of colloquial
// speech can be badly wrong, so it sees the customer's own words as well.
export const modelInput = (textEn, original = '') => (original && original !== textEn
  ? `Customer said: ${original}\nMachine translation, which may be wrong: ${textEn}`
  : textEn);

// `complete` calls whichever model is configured and returns { name, arguments }.
export async function routeWithModel(text, { complete, signal }) {
  const call = await complete({
    messages: [{ role: 'system', content: ROUTER_SYSTEM_PROMPT }, { role: 'user', content: text }],
    tools: toolsForModel(),
    signal,
  });
  const checked = validateToolCall(call);
  if (!checked.ok) throw new Error(checked.error);
  return checked.value;
}
