// Claims engine: the checklist, the deadlines, and every deduction explained
// against the policy wording. Where the insurer's letter pays less than the
// wording and the regulator's rule support, it says so, and shows the rupees.
import { PACKS, packStamp } from '../policyPacks.js';
import { addDays, daysBetween, fmtDate, inr } from '../money.js';

const REIMBURSEMENT_DOCS = [
  ['claim_form', 'Claim form, signed'],
  ['discharge', 'Discharge summary'],
  ['bills', 'Final hospital bill, with the break-up'],
  ['receipts', 'Payment receipts'],
  ['reports', 'Test reports and prescriptions'],
  ['id', 'Photo ID and policy copy'],
  ['bank', 'Cancelled cheque for the payout'],
];

export function claimChecklist({ claim, wording, have = [], today }) {
  const pack = PACKS.claims;
  const documentsBy = addDays(claim.dischargedOn, wording.documentDays);
  const daysLeft = daysBetween(today, documentsBy);
  const docs = REIMBURSEMENT_DOCS.map(([id, label]) => ({ id, label, have: have.includes(id) }));
  const missing = docs.filter((doc) => !doc.have);
  return {
    claimId: claim.id, type: claim.type, docs, missing: missing.length, total: docs.length,
    dischargedOn: claim.dischargedOn, documentsBy, documentsByLabel: fmtDate(documentsBy), daysLeft: Math.max(daysLeft, 0), late: daysLeft < 0,
    intimation: {
      policyNumber: claim.policyId, patient: claim.patient, hospital: claim.hospital,
      admittedOn: claim.admittedOn, dischargedOn: claim.dischargedOn, status: 'Draft, not submitted',
    },
    clauses: [wording.clauses.intimation, wording.clauses.documents],
    decisionDays: pack.rules.decisionDaysAfterLastDocument,
    formula: `Documents due = discharge ${claim.dischargedOn} + ${wording.documentDays} days`,
    pack: packStamp(pack),
  };
}

// Room-rent proportion applies only to associated medical expenses. Pharmacy,
// consumables, implants, devices and diagnostics are outside it, per the circular.
export function explainDeductions({ claim, wording }) {
  const pack = PACKS.claims;
  const ratio = Math.min(wording.roomRentPerDay / claim.roomPerDay, 1);
  const lines = claim.bill.map((line) => {
    const paid = claim.insurerPaid[line.id];
    let allowed, why, clause;
    if (line.kind === 'room') {
      allowed = Math.min(wording.roomRentPerDay * claim.days, line.billed);
      why = `The policy pays ${inr(wording.roomRentPerDay)} a day. Your room cost ${inr(claim.roomPerDay)} a day for ${claim.days} days.`;
      clause = wording.clauses.roomRent;
    } else if (line.kind === 'associated') {
      allowed = Math.round(line.billed * ratio);
      why = `Because the room cost more than the limit, these are paid in the same proportion, ${Math.round(ratio * 1000) / 10}%.`;
      clause = wording.clauses.proportionate;
    } else if (line.kind === 'nonpayable') {
      allowed = 0;
      why = 'These items are listed as not payable.';
      clause = wording.clauses.nonPayable;
    } else {
      allowed = line.billed;
      why = `${line.exemptAs === 'pharmacy' ? 'Pharmacy and consumables are' : 'Diagnostics are'} not associated expenses, so the room-rent proportion should not apply.`;
      clause = `IRDAI rule: no proportionate deduction on ${pack.rules.notProportionate.join(', ')}.`;
    }
    const deducted = line.billed - paid;
    const shortBy = Math.max(allowed - paid, 0);
    return { id: line.id, head: line.head, billed: line.billed, paid, deducted, allowed, shortBy, status: shortBy > 0 ? 'looks-wrong' : 'as-per-policy', why, clause };
  });
  const sum = (key) => lines.reduce((total, line) => total + line[key], 0);
  const flagged = lines.filter((line) => line.status === 'looks-wrong');
  return {
    claimId: claim.id, policyId: claim.policyId, settledOn: claim.settledOn, ratioPct: Math.round(ratio * 1000) / 10,
    lines, flagged: flagged.map((line) => line.id),
    billed: sum('billed'), paid: sum('paid'), deducted: sum('deducted'), allowed: sum('allowed'), shortBy: sum('shortBy'),
    formula: `Allowed = room capped at ${wording.roomRentPerDay} × ${claim.days} days; associated × ${wording.roomRentPerDay}/${claim.roomPerDay}; pharmacy and diagnostics in full`,
    evidence: [
      { field: 'Policy wording', value: wording.id, source: claim.policyId, asOf: claim.settledOn },
      { field: 'Settlement letter', value: `${inr(sum('paid'))} paid on ${inr(sum('billed'))} billed`, source: claim.id, asOf: claim.settledOn },
    ],
    pack: packStamp(pack),
  };
}

export function draftGrievance({ claim, analysis, customerName, today }) {
  const pack = PACKS.grievance;
  const flagged = analysis.lines.filter((line) => line.status === 'looks-wrong');
  const respondBy = addDays(today, pack.rules.firstComplaintDays);
  const body = [
    `To the Grievance Officer,`,
    `Re: claim ${claim.id}, policy ${claim.policyId}, settled on ${fmtDate(claim.settledOn)}.`,
    `I ask you to review the amount settled. The following were reduced in proportion to room rent:`,
    ...flagged.map((line) => `${line.head}: billed ${inr(line.billed)}, paid ${inr(line.paid)}, short by ${inr(line.shortBy)}.`),
    `The IRDAI Master Circular of 29 May 2024 does not allow a proportionate deduction on these heads. I request the balance of ${inr(analysis.shortBy)}.`,
    `Please reply within ${pack.rules.firstComplaintDays} days. If this is not resolved, I will approach the Insurance Ombudsman.`,
    customerName,
  ];
  return {
    claimId: claim.id, shortBy: analysis.shortBy, flaggedCount: flagged.length, body, status: 'Draft, not sent',
    respondBy, respondByLabel: fmtDate(respondBy), route: pack.rules.insurance, firstComplaintDays: pack.rules.firstComplaintDays,
    formula: `Balance requested = sum of amounts short by on ${flagged.length} heads`,
    pack: packStamp(pack),
  };
}
