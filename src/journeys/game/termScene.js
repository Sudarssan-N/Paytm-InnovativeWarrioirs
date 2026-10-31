// Kal Ka Ghar: the numbers and the check behind the game. They come from the same
// protection gap as the call. The plan is the sample in the catalogue. Nothing here
// is a quote, and nothing is signed.
import { protectionGap } from '../engines/insurance.js';
import { inr } from '../money.js';
import { INSURANCE_PLANS } from '../sampleData.js';

export const SCENE_RULES = Object.freeze({
  // Share of monthly income the household still needs once the earning person is gone.
  keepPct: 70,
  childAge: 8,
  billSplit: Object.freeze([
    Object.freeze({ id: 'house', label: 'Rent', pct: 40 }),
    Object.freeze({ id: 'school', label: 'School', pct: 22 }),
    Object.freeze({ id: 'food', label: 'Food', pct: 28 }),
    Object.freeze({ id: 'medicine', label: 'Medicine', pct: 10 }),
  ]),
});

export const DEFAULT_SCENE = Object.freeze({
  income: 45000, dependants: 3, existingLife: 1000000, loans: 0, city: 'Chennai', sample: true,
});

export const TERM_UI = Object.freeze({
  title: 'Kal Ka Ghar',
  tag: 'Keep the house going until Anu is 22',
  intro: 'Earn as Ramesh. Choose your shields. Then the storm comes, and your choice decides what happens.',
  start: 'Play',
  preparing: 'Getting the game ready in your language…',
  how: 'Arrow keys or A / D to run, Space to jump. On a phone, tap where to go.',
  sample: 'Sample plans, not quotes',
  voiceOn: 'Voice on',
  voiceOff: 'Voice off',
  wallet: 'In hand',
  gold: 'Gold you have',
  years: 'years of bills',
  anuAge: 'Anu is',
  goal: 'Goal: 22',
  ramesh: 'Ramesh',
  meena: 'Meena',
  anu: 'Anu',
  amma: 'Amma',
  cousin: 'Cousin',
  hospital: 'Hospital',
  house: 'Rent',
  school: 'School',
  food: 'Food',
  medicine: 'Medicine',
  termName: 'Term plan',
  termDoes: 'Pays your family one big amount if you die',
  healthName: 'Health plan',
  healthDoes: 'Pays hospital bills',
  perMonth: 'a month',
  taken: 'Taken',
  shopGo: 'Walk on with these',
  loseTitle: 'The gold is gone',
  loseDebt: 'Debts took the house',
  loseAge: 'Anu was only',
  rewind: 'Rewind time, choose again',
  winTitle: 'The house stood',
  winAge: 'Anu is 22, and can earn now.',
  leftover: 'Gold still left',
  chose: 'You chose',
  chosenNone: 'No shields',
  learned: 'What this means',
  continueOn: 'Continue',
  skipToEnd: 'Show me what this means',
  codaTitle: 'And if Ramesh lives?',
  codaLine: 'Most people do. The plan ends, and no money comes back. It is like a helmet: you do not get your money back for not having an accident. For all those years, the family was safe.',
  summaryTitle: 'The same bills, with real numbers',
  summaryToday: 'Only today’s cover',
  summaryPlan: 'With the term plan',
  summaryLasts: 'The bills are paid for',
  summaryPays: 'The family gets',
  summaryCost: 'Ramesh pays',
  summaryNone: 'Nothing',
  aYear: 'a year',
  madeUp: 'The hospital and cousin losses are made up for the game.',
  quizTitle: 'Was that clear?',
  quizLead: 'Four quick questions. They go on your receipt. Nothing is blocked if one is wrong.',
  check: 'Check what I understood',
  again: 'Play again',
  ask: 'How much insurance do I need?',
  sealed: 'Sealed on your Journey Passport',
});

const termPlan = () => INSURANCE_PLANS.find((plan) => plan.type === 'Term life');

// Whole lakhs read and sound better than ₹75,00,000 when the story is heard, not studied.
export function lakhs(amount) {
  const safe = Math.max(0, Math.round(amount));
  if (safe < 100000) return inr(safe);
  const value = Math.round(safe / 10000) / 10;
  return `₹${value} lakh`;
}

export function spanLabel(months) {
  const safe = Math.max(0, Math.floor(months));
  const years = Math.floor(safe / 12);
  const rest = safe % 12;
  if (!years) return `${rest} months`;
  if (!rest) return years === 1 ? '1 year' : `${years} years`;
  return `${years} ${years === 1 ? 'year' : 'years'} ${rest} months`;
}

function splitBills(monthlyNeed) {
  let used = 0;
  return SCENE_RULES.billSplit.map((bill, index) => {
    const amount = index === SCENE_RULES.billSplit.length - 1
      ? monthlyNeed - used
      : Math.round(monthlyNeed * bill.pct / 100);
    used += amount;
    return { id: bill.id, label: bill.label, amount };
  });
}

function runway(pot, monthlyNeed) {
  if (monthlyNeed <= 0) return { months: 0, remainder: Math.max(pot, 0) };
  const months = Math.floor(Math.max(pot, 0) / monthlyNeed);
  return { months, remainder: Math.max(pot, 0) - months * monthlyNeed };
}

// What one house can spend on bills after clearing the loans in the illustration.
function forBills(cover, loans) {
  const cleared = Math.min(Math.max(cover, 0), Math.max(loans, 0));
  return { cover: Math.max(cover, 0), cleared, pot: Math.max(cover, 0) - cleared };
}

export function buildScene({
  income = DEFAULT_SCENE.income,
  dependants = DEFAULT_SCENE.dependants,
  existingLife = DEFAULT_SCENE.existingLife,
  loans = 0,
  city = '',
  sample = false,
} = {}) {
  const safeIncome = Math.max(0, Math.round(income));
  const gap = protectionGap({ income: safeIncome, dependants, existingLife, loans, city });
  const plan = termPlan();
  const health = INSURANCE_PLANS.find((item) => item.type === 'Family health');
  const monthlyNeed = Math.round(safeIncome * SCENE_RULES.keepPct / 100);
  const without = forBills(existingLife, loans);
  const withCover = forBills(existingLife + plan.cover, loans);
  const stillShort = Math.max(gap.life.target - (existingLife + plan.cover), 0);
  return {
    city, sample, income: safeIncome, dependants, loans,
    gap, monthlyNeed, bills: splitBills(monthlyNeed),
    plan: {
      id: plan.id, name: plan.name, cover: plan.cover, premiumYear: plan.premiumYear,
      premiumMonth: Math.round(plan.premiumYear / 12), pays: plan.pays, watch: plan.watch,
    },
    health: { id: health.id, name: health.name, cover: health.cover, premiumYear: health.premiumYear, premiumMonth: Math.round(health.premiumYear / 12) },
    without: { ...without, ...runway(without.pot, monthlyNeed) },
    with: { ...withCover, ...runway(withCover.pot, monthlyNeed) },
    stillShort,
    closesGap: stillShort === 0 && plan.cover > 0,
    assumption: `We assume the family needs ${SCENE_RULES.keepPct}% of the income for the same bills. Prices and interest stay out of this picture. ${plan.name} and ${health.name} are samples, not quotes. The insurer pays only if the claim is accepted.`,
  };
}

export function sceneFromGap(gap) {
  return buildScene({
    income: Math.round(gap.annualIncome / 12),
    dependants: gap.dependants,
    existingLife: gap.life.existing,
    loans: gap.loans || 0,
    city: gap.city || '',
    sample: false,
  });
}

export function defaultScene() {
  return buildScene(DEFAULT_SCENE);
}

export function quizFor(scene) {
  const today = spanLabel(scene.without.months);
  const held = spanLabel(scene.with.months);
  return [
    {
      id: 'pays',
      q: 'If the person who earns dies during the plan, what does the sample plan pay, and to whom?',
      options: ['A salary every month, for life', `One amount of ${lakhs(scene.plan.cover)}, to the family`, 'The hospital bills'],
      answer: 1,
    },
    {
      id: 'survive',
      q: 'If he lives through the whole plan, what comes back?',
      options: ['Every premium, with interest', 'A pension', 'Nothing. That is why it is cheap.'],
      answer: 2,
    },
    {
      id: 'runway',
      q: 'How long were the same bills paid?',
      options: [`${today} with today’s cover, ${held} with the plan`, `${held} either way`, `${today} either way`],
      answer: 0,
    },
    {
      id: 'premium',
      q: `What does the ${inr(scene.plan.premiumYear)} a year pay for?`,
      options: ['A guaranteed return', 'A hospital room', 'Keeping the term cover running'],
      answer: 2,
    },
  ];
}

export function gradeScene(scene, answers) {
  const questions = quizFor(scene);
  const rows = questions.map((question, index) => ({
    id: question.id,
    question: question.q,
    chosen: question.options[answers?.[index]] ?? null,
    right: question.options[question.answer],
    correct: answers?.[index] === question.answer,
  }));
  return { rows, correct: rows.filter((row) => row.correct).length, total: rows.length, missed: rows.filter((row) => !row.correct).map((row) => row.id) };
}

export function gameFromAsk(text) {
  const asked = String(text || '');
  if (/\b(scams?|fraud|otp|collect)\b/i.test(asked)) return 'scam';
  if (/\b(claims?|hospital|deduct)\b/i.test(asked) && !/\bterm\b/i.test(asked)) return 'claim';
  if (/\b(term|life cover|life insurance|if i die|if i am not here|if i am not there|if i'm not here|if i'm not there|kal ka ghar|family scenario)\b/i.test(asked)) return 'term';
  if (/\binsurance\b/i.test(asked)) return 'term';
  if (/\b(scenario|simulation)\b/i.test(asked) && !/\b(loan|emi)\b/i.test(asked)) return 'term';
  return 'karz';
}

export function sceneLines(scene = defaultScene()) {
  const lines = [scene.assumption];
  for (const question of quizFor(scene)) lines.push(question.q, ...question.options);
  return lines;
}
