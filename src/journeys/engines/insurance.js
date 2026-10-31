// Insurance engine: how much cover the family needs, what each plan type does,
// and how long the customer can still return a policy.
import { PACKS, packStamp } from '../policyPacks.js';
import { addDays, daysBetween, fmtDate, inr } from '../money.js';

export function protectionGap({ income, dependants, existingLife = 0, existingHealth = 0, loans = 0, city = '' }) {
  const pack = PACKS.insurance;
  const { lifeCoverMultipleByDependants: multiples, healthCoverMetro, healthCoverOther, metroCities } = pack.assumptions;
  const annual = income * 12;
  const multiple = multiples[Math.min(Math.max(dependants, 0), multiples.length - 1)];
  const lifeTarget = annual * multiple + loans;
  const lifeGap = Math.max(lifeTarget - existingLife, 0);
  const metro = metroCities.includes(String(city).trim().toLowerCase());
  const healthTarget = metro ? healthCoverMetro : healthCoverOther;
  const healthGap = Math.max(healthTarget - existingHealth, 0);
  return {
    annualIncome: annual, multiple, dependants, loans, metro, city,
    life: { target: lifeTarget, existing: existingLife, gap: lifeGap },
    health: { target: healthTarget, existing: existingHealth, gap: healthGap },
    formula: `Life cover target = ${multiple} × yearly income ${annual}${loans ? ` + loans ${loans}` : ''}; gap = target − existing ${existingLife}`,
    assumption: `The ${multiple}× multiple and the ${inr(healthTarget)} health target are MITRA defaults for ${dependants} dependants in ${city || 'this city'}, not a regulatory rule.`,
    pack: packStamp(pack),
  };
}

export function explainPlans(plans, gap) {
  const covers = (plan) => {
    if (plan.type === 'Term life') return gap ? plan.cover >= gap.life.gap : null;
    return gap ? plan.cover >= gap.health.gap : null;
  };
  return {
    plans: plans.map((plan) => ({ ...plan, closesGap: covers(plan) })),
    note: 'Sample plans and premiums for this demo, not quotes.',
    formula: 'Each plan compared with the gap it is meant to close',
    pack: packStamp(PACKS.insurance),
  };
}

export function freeLookStatus(policy, { today }) {
  const pack = PACKS.insurance;
  const days = pack.rules.freeLookDays;
  const endsOn = addDays(policy.receivedOn, days);
  const remindOn = addDays(endsOn, -3);
  const daysLeft = Math.max(daysBetween(today, endsOn), 0);
  return {
    policyId: policy.id, policyName: policy.name, receivedOn: policy.receivedOn, days, endsOn, remindOn, daysLeft,
    open: daysLeft > 0, endsLabel: fmtDate(endsOn), remindLabel: fmtDate(remindOn), premium: policy.premium,
    refundNote: 'The refund is the premium, less a small charge for the days you were covered, plus any medical and stamp duty costs.',
    formula: `Free-look ends = ${policy.receivedOn} + ${days} days`,
    pack: packStamp(pack),
  };
}
