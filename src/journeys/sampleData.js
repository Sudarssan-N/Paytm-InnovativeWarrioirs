// Synthetic demo data. Nothing here is a real person, lender, insurer or quote.
// In a pilot each block comes from a partner: KFS and policy wordings from the
// lender or insurer, sales summaries through consented data sharing.

export const CUSTOMERS = Object.freeze({
  ramesh: Object.freeze({
    id: 'ramesh', kind: 'customer', name: 'Ramesh K.', preferredChannel: 'phone call',
    profile: Object.freeze({ city: 'Chennai', age: 34 }),
    // What MITRA can ask for. Nothing is pre-loaded: the customer shares it once.
    answers: Object.freeze({ income: 45000, dependants: 3, existingLife: 1000000, existingHealth: 300000 }),
  }),
  lakshmi: Object.freeze({
    id: 'lakshmi', kind: 'merchant', name: 'Lakshmi Stores', preferredChannel: 'AI Soundbox',
    profile: Object.freeze({ city: 'Madurai', age: 41 }),
    answers: Object.freeze({}),
  }),
});

export const LOAN_OFFERS = Object.freeze({
  'KFS-v3-0412': Object.freeze({
    id: 'KFS-v3-0412', version: 'v3', lender: 'a partner lender', product: 'Personal loan',
    principal: 200000, ratePct: 14, rateType: 'fixed', months: 24,
    processingFee: 6000, gstOnFee: 1080, otherCharges: 0,
    coolingOffDays: 3, foreclosure: null, // the lender's KFS is silent on this
    issuedOn: '2026-10-28',
  }),
});

export const INSURANCE_PLANS = Object.freeze([
  Object.freeze({
    id: 'term-a', type: 'Term life', name: 'Sample Term Plan A', cover: 7500000, premiumYear: 7900,
    pays: 'A fixed amount to your family if you die during the term.',
    watch: 'Nothing is paid if you outlive the term. That is why it is cheap.',
    waitingMonths: 0, roomLimit: null,
  }),
  Object.freeze({
    id: 'floater-b', type: 'Family health', name: 'Sample Family Floater B', cover: 1000000, premiumYear: 18400,
    pays: 'Hospital bills for the whole family, from one shared cover.',
    watch: 'Illnesses you already have are covered only after a 36 month wait.',
    waitingMonths: 36, roomLimit: 'Single private room',
  }),
  Object.freeze({
    id: 'topup-c', type: 'Super top-up', name: 'Sample Super Top-up C', cover: 1000000, premiumYear: 4300, deductible: 300000,
    pays: 'Bills above ₹3,00,000 in a year, on top of your employer cover.',
    watch: 'It pays nothing until the year’s bills cross ₹3,00,000.',
    waitingMonths: 24, roomLimit: 'Single private room',
  }),
]);

export const ISSUED_POLICY = Object.freeze({
  id: 'POL-77-1042', name: 'Sample Family Floater B', receivedOn: '2026-10-12', premium: 18400, cover: 1000000,
});

// Every clause the claim explainer can cite, as the sample policy words it.
export const POLICY_WORDING = Object.freeze({
  id: 'SFF-B wording 2026', sumInsured: 500000,
  roomRentPerDay: 5000,
  clauses: Object.freeze({
    roomRent: 'Clause 4.2: room rent is payable up to 1% of the sum insured per day.',
    proportionate: 'Clause 4.3: if a costlier room is chosen, associated medical expenses are paid in the same proportion as the room rent.',
    nonPayable: 'Annexure II: items such as toiletries and attendant charges are not payable.',
    intimation: 'Clause 6.1: tell the insurer within 24 hours of an emergency admission.',
    documents: 'Clause 6.2: send reimbursement documents within 15 days of discharge.',
  }),
  intimationHours: 24,
  documentDays: 15,
});

export const CLAIM = Object.freeze({
  id: 'CLM-26-88120', policyId: 'POL-77-1042', patient: 'Ramesh K.', hospital: 'Sample City Hospital, Chennai',
  type: 'reimbursement', admittedOn: '2026-10-08', dischargedOn: '2026-10-12', days: 4, roomPerDay: 8000,
  bill: Object.freeze([
    Object.freeze({ id: 'room', head: 'Room rent', billed: 32000, kind: 'room' }),
    Object.freeze({ id: 'doctor', head: 'Doctor, surgeon and nursing', billed: 80000, kind: 'associated' }),
    Object.freeze({ id: 'pharmacy', head: 'Pharmacy and consumables', billed: 24000, kind: 'exempt', exemptAs: 'pharmacy' }),
    Object.freeze({ id: 'diagnostics', head: 'Diagnostics', billed: 14000, kind: 'exempt', exemptAs: 'diagnostics' }),
    Object.freeze({ id: 'nonpayable', head: 'Attendant and toiletries', billed: 2400, kind: 'nonpayable' }),
  ]),
  // What the insurer's settlement letter paid against each head.
  insurerPaid: Object.freeze({ room: 20000, doctor: 50000, pharmacy: 15000, diagnostics: 8750, nonpayable: 0 }),
  settledOn: '2026-10-26',
});

// A fresh hospital stay, for the "file a claim" journey. Dates sit ahead of the
// finale so the deadline is still open when this is shown.
export const NEW_CLAIM = Object.freeze({
  id: 'CLM-26-90455', policyId: 'POL-77-1042', patient: 'Ramesh K.', hospital: 'Sample City Hospital, Chennai',
  type: 'reimbursement', admittedOn: '2026-10-24', dischargedOn: '2026-10-28',
});

export const MERCHANT_SALES = Object.freeze({
  merchantId: 'lakshmi', name: 'Lakshmi Stores', source: 'Soundbox settlement summary',
  months: Object.freeze([
    Object.freeze({ month: 'May 2026', sales: 285400 }),
    Object.freeze({ month: 'Jun 2026', sales: 302150 }),
    Object.freeze({ month: 'Jul 2026', sales: 276900 }),
    Object.freeze({ month: 'Aug 2026', sales: 318600 }),
    Object.freeze({ month: 'Sep 2026', sales: 341250 }),
    Object.freeze({ month: 'Oct 2026', sales: 329800 }),
  ]),
});

export const MERCHANT_OFFER = Object.freeze({
  id: 'KFS-M-2207', version: 'v1', lender: 'a partner lender', product: 'Merchant working capital',
  principal: 100000, days: 180, dailyRepayment: 590, processingFeePct: 2, gstOnFeePct: 18,
  coolingOffDays: 3, foreclosure: null, issuedOn: '2026-10-28',
});

// Forwards a customer might read out. Used by the demo's "caller" prompts.
export const SAMPLE_MESSAGES = Object.freeze({
  loanScam: 'Your PM Loan of ₹5,00,000 is approved. Pay ₹2,999 processing fee to pmloan.help@ybl within 2 hours to release it.',
  collect: 'Paytm refund of ₹4,500 is waiting. Approve the collect request and enter your UPI PIN to receive it.',
  genuine: 'Your electricity bill of ₹1,240 is due on 5 Nov. Pay in the app from the saved biller.',
});
