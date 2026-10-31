// Kal Ka Ghar, played. The rules only: no drawing and no sound, so a test can play it.
// Earn as Ramesh, choose your shields, then keep the house going as Meena until Anu is
// 22. One gold block is one year of the family's bills, worked out from the real cover.
import { defaultScene, lakhs, SCENE_RULES, spanLabel } from './termScene.js';
import { inr } from '../money.js';

export const GAME = Object.freeze({
  cols: 30,
  doorLeft: 9,
  pileLeft: 20,
  pileRight: 25,
  shopTerm: 20.5,
  shopHealth: 24.5,
  shopExit: 29,
  earnMonths: 2,
  goalAge: 22,
  walk: 7.5,
  jump: 9.2,
  gravity: 26,
  reach: 1.8,
  hearts: 3,
  stormSeconds: 7,
  // Game numbers, said so on screen. In years of bills.
  hospitalCost: 2,
  cousinCost: 3,
  cousinYear: 2,
  hospitalYears: Object.freeze([5, 10]),
});

const BILLS = ['house', 'school', 'food', 'medicine'];
const ORE_SPOTS = [[[14, 0], [20, 2], [26, 0]], [[27, 2], [21, 0], [15, 2]]];

export const yearsOfBills = (pot, monthlyNeed) => (monthlyNeed > 0 ? Math.max(pot, 0) / (monthlyNeed * 12) : 0);

function oresFor(month) {
  return ORE_SPOTS[(month - 1) % ORE_SPOTS.length].map(([x, h], at) => ({ id: `${month}-${at}`, x, h }));
}

export function createGame(scene = defaultScene(), { term = false, health = false, attempt = 1 } = {}) {
  return {
    scene, stage: 'earn', attempt, x: 19, y: 0, vy: 0, facing: 1, moving: false, tx: null, wantJump: false,
    who: 'ramesh', month: 1, wallet: 0, ores: oresFor(1), mobs: [], nextId: 1,
    term, health, onPad: null,
    blocks: 0, year: 0, age: SCENE_RULES.childAge, hearts: GAME.hearts, clock: 0, stormT: 0, paidOut: false,
    cousinStopped: false, outcome: null, time: 0, shake: 0,
  };
}

// Back to the shop, keeping nothing but the memory of what happened.
export function rewindGame(game) {
  return { ...createGame(game.scene, { term: game.term, health: game.health, attempt: game.attempt + 1 }), stage: 'shop', x: 17, ores: [], month: GAME.earnMonths + 1, wallet: (game.scene.income - game.scene.monthlyNeed) * GAME.earnMonths };
}

export function walkTo(game, x) {
  game.tx = Math.max(0.6, Math.min(GAME.cols - 0.6, x));
}

export function toggleShield(game, id, events = []) {
  if (game.stage !== 'shop') return events;
  game[id] = !game[id];
  events.push({ type: game[id] ? 'buy' : 'unbuy', id });
  return events;
}

export function leaveShop(game, events = []) {
  if (game.stage !== 'shop') return events;
  game.stage = 'storm';
  game.stormT = 0;
  game.tx = null;
  game.who = 'meena';
  game.blocks = yearsOfBills(game.scene.without.pot, game.scene.monthlyNeed);
  events.push({ type: 'storm' });
  return events;
}

export function skipStorm(game, events = []) {
  if (game.stage === 'storm') game.stormT = GAME.stormSeconds;
  return events;
}

function spawn(game, kind, fields) {
  game.mobs.push({ id: game.nextId, kind, ...fields });
  game.nextId += 1;
}

function spawnBill(game, year) {
  const fromLeft = year % 2 === 0;
  // Bills get a little faster as the years go on.
  const speed = Math.min(3.2 + year * 0.08, 4.2);
  spawn(game, 'bill', fromLeft
    ? { x: GAME.doorLeft - speed * 3.6, dir: 1, goal: GAME.doorLeft, speed, year, label: BILLS[year % BILLS.length] }
    : { x: GAME.pileRight + 0.6 + speed * 3.6, dir: -1, goal: GAME.pileRight + 0.6, speed, year, label: BILLS[year % BILLS.length] });
}

function lose(game, reason, events, year = game.year) {
  game.stage = 'over';
  game.outcome = { won: false, reason, age: SCENE_RULES.childAge + Math.max(year - 1, 0), term: game.term, health: game.health };
  game.age = game.outcome.age;
  game.mobs = [];
  game.tx = null;
  events.push({ type: 'lose', reason });
}

function payBill(game, mob, late, events) {
  game.mobs = game.mobs.filter((item) => item !== mob);
  if (game.blocks < 1) { game.blocks = 0; lose(game, 'empty', events, mob.year); return; }
  game.blocks -= 1;
  if (late) {
    game.hearts -= 1;
    game.shake = 0.35;
    events.push({ type: 'late', hearts: game.hearts });
    if (game.hearts <= 0) lose(game, 'debt', events, mob.year);
  } else events.push({ type: 'paid', x: mob.x });
}

function touching(game, mob) {
  return Math.abs(game.x - mob.x) < 1 && game.y < GAME.reach;
}

function earnStep(game, events) {
  for (const ore of game.ores) {
    const reachable = ore.h === 0 ? game.y < GAME.reach : game.y + GAME.reach >= ore.h;
    if (Math.abs(game.x - ore.x) < 0.9 && reachable) {
      ore.taken = true;
      game.wallet += Math.round(game.scene.income / 3);
      events.push({ type: 'ore', x: ore.x, h: ore.h });
    }
  }
  game.ores = game.ores.filter((ore) => !ore.taken);
  if (!game.ores.length && !game.mobs.length) {
    game.wallet = game.scene.income * game.month - game.scene.monthlyNeed * (game.month - 1);
    spawnBill(game, game.month);
    events.push({ type: 'billDue' });
  }
  for (const mob of [...game.mobs]) {
    const arrived = mob.dir > 0 ? mob.x >= mob.goal : mob.x <= mob.goal;
    if (touching(game, mob) || arrived) {
      game.mobs = game.mobs.filter((item) => item !== mob);
      game.wallet -= game.scene.monthlyNeed;
      events.push({ type: 'paid', x: mob.x, first: game.month === 1 });
      game.month += 1;
      if (game.month > GAME.earnMonths) {
        game.stage = 'shop';
        game.tx = null;
        events.push({ type: 'shop' });
      } else game.ores = oresFor(game.month);
    }
  }
}

function shopStep(game, events) {
  const pad = Math.abs(game.x - GAME.shopTerm) < 0.8 ? 'term' : Math.abs(game.x - GAME.shopHealth) < 0.8 ? 'health' : null;
  if (pad && pad !== game.onPad) toggleShield(game, pad, events);
  game.onPad = pad;
  if (game.x >= GAME.shopExit) leaveShop(game, events);
}

function stormStep(game, dt, events) {
  game.stormT += dt;
  if (!game.paidOut && game.stormT >= GAME.stormSeconds * 0.5) {
    game.paidOut = true;
    if (game.term) game.blocks = yearsOfBills(game.scene.with.pot, game.scene.monthlyNeed);
    events.push({ type: game.term ? 'payout' : 'noPayout' });
  }
  if (game.stormT >= GAME.stormSeconds) {
    if (!game.paidOut) { game.paidOut = true; if (game.term) game.blocks = yearsOfBills(game.scene.with.pot, game.scene.monthlyNeed); }
    game.stage = 'hold';
    game.x = 15;
    game.clock = 0;
    events.push({ type: 'hold' });
  }
}

function holdStep(game, dt, events) {
  game.clock -= dt;
  const target = GAME.goalAge - SCENE_RULES.childAge;
  if (game.clock <= 0 && game.year < target) {
    game.year += 1;
    game.age = SCENE_RULES.childAge + game.year;
    game.clock = Math.max(3 - game.year * 0.06, 2.3);
    spawnBill(game, game.year);
    events.push({ type: 'year', year: game.year, age: game.age });
    if (game.year === GAME.cousinYear) {
      spawn(game, 'cousin', { x: -1.5, dir: 1, goal: GAME.pileLeft, speed: 2.9 });
      events.push({ type: 'cousin' });
    }
    if (GAME.hospitalYears.includes(game.year)) {
      spawn(game, 'hospital', { x: 32, dir: -1, goal: GAME.pileRight + 0.6, speed: 5.5 });
      events.push({ type: 'hospitalDue' });
    }
  }
  for (const mob of [...game.mobs]) {
    if (game.stage !== 'hold') break;
    const arrived = mob.dir > 0 ? mob.x >= mob.goal : mob.x <= mob.goal;
    if (mob.kind === 'bill') {
      if (touching(game, mob)) payBill(game, mob, false, events);
      else if (arrived) payBill(game, mob, true, events);
    } else if (mob.kind === 'cousin') {
      if (touching(game, mob)) {
        game.mobs = game.mobs.filter((item) => item !== mob);
        game.cousinStopped = true;
        events.push({ type: 'cousinStopped', x: mob.x });
      } else if (arrived) {
        game.mobs = game.mobs.filter((item) => item !== mob);
        game.blocks = Math.max(game.blocks - GAME.cousinCost, 0);
        game.shake = 0.5;
        events.push({ type: 'cousinTook' });
      }
    } else if (mob.kind === 'hospital' && arrived) {
      game.mobs = game.mobs.filter((item) => item !== mob);
      if (game.health) events.push({ type: 'hospitalCovered', x: mob.x });
      else {
        game.blocks = Math.max(game.blocks - GAME.hospitalCost, 0);
        game.shake = 0.5;
        events.push({ type: 'hospitalPaid', hadTerm: game.term });
      }
    }
  }
  if (game.stage === 'hold' && game.year >= target && !game.mobs.some((mob) => mob.kind === 'bill')) {
    game.stage = 'over';
    game.outcome = { won: true, age: GAME.goalAge, blocks: game.blocks, hearts: game.hearts, cousinStopped: game.cousinStopped, term: game.term, health: game.health };
    game.mobs = [];
    events.push({ type: 'win' });
  }
}

// One frame. `input` is { dir: -1 | 0 | 1, jump: boolean }. Returns what just happened.
export function stepGame(game, dt, input = {}) {
  const events = [];
  game.time += dt;
  game.shake = Math.max(game.shake - dt, 0);
  const free = game.stage === 'earn' || game.stage === 'shop' || game.stage === 'hold';
  const dir = free ? (input.dir || 0) : 0;
  game.moving = false;
  if (dir) {
    game.tx = null;
    game.facing = dir;
    game.x += dir * GAME.walk * dt;
    game.moving = true;
  } else if (free && game.tx != null) {
    const gap = game.tx - game.x;
    if (Math.abs(gap) <= Math.max(GAME.walk * dt, 0.05)) {
      game.x = game.tx;
      game.tx = null;
      // Tapped something high: jump for it when you get there.
      if (game.wantJump && game.y <= 0) game.vy = GAME.jump;
      game.wantJump = false;
    } else {
      game.facing = gap > 0 ? 1 : -1;
      game.x += Math.sign(gap) * GAME.walk * dt;
      game.moving = true;
    }
  }
  game.x = Math.max(0.6, Math.min(GAME.cols - 0.6, game.x));
  if (free && input.jump && game.y <= 0) game.vy = GAME.jump;
  if (game.y > 0 || game.vy > 0) {
    game.y += game.vy * dt;
    game.vy -= GAME.gravity * dt;
    if (game.y <= 0) { game.y = 0; game.vy = 0; }
  }
  for (const mob of game.mobs) mob.x += mob.dir * mob.speed * dt;
  if (game.stage === 'earn') earnStep(game, events);
  else if (game.stage === 'shop') shopStep(game, events);
  else if (game.stage === 'storm') stormStep(game, dt, events);
  else if (game.stage === 'hold') holdStep(game, dt, events);
  return events;
}

// What MITRA says, by event. Short, and only about what the player just did.
export function voiceLines(scene = defaultScene()) {
  const need = inr(scene.monthlyNeed);
  return {
    start: `You are Ramesh. Your family lives on your salary of ${inr(scene.income)}. Run and jump to grab the gold.`,
    billDue: `Here come the bills: ${need} a month. Run into them to pay.`,
    shop: `Now choose. A term plan pays your family one big amount if you die, for about ${inr(scene.plan.premiumMonth)} a month. A health plan pays hospital bills. Walk onto what you want, then walk on to the right.`,
    term: `Term plan taken. ${lakhs(scene.plan.cover)} for your family, if you die during the plan.`,
    health: 'Health plan taken. Hospital bills are covered.',
    storm: 'One day, Ramesh does not come home. The salary stops. You are Meena now.',
    payout: `The term plan pays the family ${lakhs(scene.plan.cover)}. Each gold block is one year of bills. Keep the house going until Anu is ${GAME.goalAge}.`,
    noPayout: `No term plan. All the family has is ${lakhs(scene.without.pot)}. Each gold block is one year of bills. Keep the house going until Anu is ${GAME.goalAge}.`,
    hold: 'Bills come from both sides. Run into them before they reach the house.',
    late: 'Too late. A missed bill turns into debt. You lost a heart.',
    cousin: 'Your cousin wants the gold for his shop, and says he will double it. Stop him!',
    cousinStopped: 'Good. This gold is for the bills, not for a promise.',
    cousinTook: 'He took three years of bills, and the shop failed.',
    hospitalCovered: 'Amma needed the hospital. The health plan paid.',
    hospitalPaid: 'Amma needed the hospital. There is no health plan, so the gold paid for it.',
    hospitalPaidTerm: 'Amma needed the hospital. A term plan does not pay hospital bills, so the gold paid for it.',
    loseEmpty: 'The gold is gone, and the bills keep coming. Meena must borrow, or Anu may have to leave school.',
    loseDebt: 'The debts grew too big. The family lost the house.',
    win: `Anu is ${GAME.goalAge}, and can earn now. That is what the plan buys: time.`,
    coda: 'And if Ramesh lives? Most people do. The plan ends, and no money comes back. It is like a helmet: you do not get your money back for not having an accident.',
    today: `With the same bills, today's cover lasts ${spanLabel(scene.without.months)}. With the term plan, ${spanLabel(scene.with.months)}.`,
  };
}
