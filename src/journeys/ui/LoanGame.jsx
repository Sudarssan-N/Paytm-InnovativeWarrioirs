import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildLevel, collect, createRun, gatesLeft, LABELS, lessonLine, levelFromCard, levelIds, payGate, quizFor, scheduleRows, spawnPlan, summary } from '../game/loanGame.js';
import { inr, pct } from '../money.js';
import { beep, GAME_LANGUAGES, sealUnderstanding, speakLine, stopLine, translateLines, useLatest, useLines } from './arcadeShared.js';
import { drawAuto, drawFloats, drawGate, drawHills, drawLamps, drawMountain, drawParticles, drawPickup, drawSack, drawSky, drawSnowball, drawStreet, drawTown, layout } from './karzPaint.js';

const GATE_GAP = 560;
const PAGE = new URLSearchParams(window.location.search);
const SPEED = 290 * (Number(PAGE.get('speed')) || 1);
const QUIET = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const money = (value) => inr(Math.max(0, value));
const shortMoney = (value) => {
  const n = Math.abs(value);
  if (n >= 100000) return `₹${(n / 100000).toFixed(n >= 1000000 ? 1 : 2).replace(/\.?0+$/, '')}L`;
  return inr(n);
};

function newWorld(level, seed) {
  const plan = spawnPlan(level, seed);
  const world = { x: 0, lane: 1, laneY: null, tilt: 0, time: 0, gates: [], items: [], floats: [], parts: [], shake: 0, flash: 0, flashColor: '#d3362a', mountain: 1, sack: 0, ended: false, shown: new Set() };
  world.gates.push({ x: 420, fee: level.fees });
  plan.forEach((items, index) => {
    const start = 420 + index * GATE_GAP;
    world.gates.push({ x: start + GATE_GAP, index, total: plan.length });
    for (const item of items) world.items.push({ ...item, x: start + item.offset * GATE_GAP, taken: false });
  });
  return world;
}

function syncRoad(world, run) {
  const paid = world.gates.filter((gate) => gate.index != null && gate.passed).length;
  const want = paid + gatesLeft(run);
  const gates = world.gates.filter((gate) => gate.index != null);
  const fee = world.gates[0];
  const kept = gates.filter((gate) => gate.index < want);
  while (kept.length < want) {
    const last = kept.at(-1);
    kept.push({ x: (last?.x ?? fee.x) + GATE_GAP, index: kept.length });
  }
  kept.forEach((gate) => { gate.total = want; gate.finish = false; });
  if (kept.length) kept.at(-1).finish = true;
  const end = kept.at(-1)?.x ?? fee.x;
  world.items = world.items.filter((item) => item.x < end - 40);
  world.gates = [fee, ...kept];
}

const burst = (world, x, y, color, count = 14, { speed = 190, square = false } = {}) => {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const power = speed * (0.35 + Math.random() * 0.65);
    world.parts.push({ x, y, vx: Math.cos(angle) * power, vy: Math.sin(angle) * power, life: 0.7 + Math.random() * 0.4, size: 2 + Math.random() * 3, color, square, gravity: 280 });
  }
};
const flyTo = (world, x, y, tx, ty, color, count) => {
  for (let i = 0; i < count; i++) world.parts.push({ x: x + Math.random() * 20 - 10, y: y + Math.random() * 20 - 10, tx, ty, life: 0.9 + i * 0.03, delay: i * 0.03, size: 4, color, seek: true });
};
const floatText = (world, text, x, y, color = '#fff', size = 16) => world.floats.push({ text, x, y, color, size, life: 1.5 });

function Hud({ run, labels, level, tick }) {
  const due = Math.min(level.payment * level.stride, run.balance ? Infinity : 0);
  return (
    <div className="kg-hud" data-tick={tick}>
      <div className={run.wallet < 0 ? 'is-bad' : ''}><span>{labels.wallet}</span><b>{inr(Math.round(run.wallet))}</b></div>
      <div><span>{labels.nextDue}</span><b>{inr(due === Infinity ? 0 : due)}</b></div>
      <div className="kg-credit"><span>{labels.credit}</span><b>{run.credit}</b><i style={{ width: `${((run.credit - 300) / 550) * 100}%` }} /></div>
      {run.shield && <div className="kg-covered">🛡</div>}
    </div>
  );
}

function Stars({ count }) {
  return <p className="kg-stars" role="img" aria-label={`${count} of 3 stars`}>{[1, 2, 3].map((star) => <span key={star} className={star <= count ? 'is-on' : ''}>★</span>)}</p>;
}

export default function LoanGame({ card = null, startLevel = null, lang: initialLang = 'en', sessionId = null, onExit, onSealed, onAsk, auto = false }) {
  const [lang, setLang] = useState(GAME_LANGUAGES.some(([code]) => code === initialLang) ? initialLang : 'en');
  const [levelId, setLevelId] = useState(startLevel || 'personal');
  const [phase, setPhase] = useState(startLevel || auto ? 'loading' : 'menu');
  const [teach, setTeach] = useState(null);
  const [tick, setTick] = useState(0);
  const [muted, setMuted] = useState(PAGE.get('gamemute') === '1');
  const [result, setResult] = useState(null);
  const [answers, setAnswers] = useState({});
  const [sealed, setSealed] = useState(null);
  const [sealError, setSealError] = useState('');
  const [showTable, setShowTable] = useState(false);

  const labels = useLines(lang, LABELS);
  const words = useMemo(() => ({ gate: 'EMI' }), []);
  const level = useMemo(() => (levelId === 'personal' && card ? levelFromCard(card) : buildLevel(levelId)), [card, levelId]);
  const quiz = useMemo(() => quizFor(level), [level]);
  const canvas = useRef(null);
  const world = useRef(null);
  const run = useRef(null);
  const translated = useRef({});
  const teachRef = useLatest(teach);
  const mutedRef = useLatest(muted);
  const langRef = useLatest(lang);
  const dismissTimer = useRef(null);
  const activeLesson = useRef(null);
  const quizLines = useLines(lang, useMemo(() => Object.fromEntries(quiz.flatMap((question, q) => [[`q${q}`, question.q], ...question.options.map((option, o) => [`q${q}o${o}`, option])])), [quiz]));

  const dismiss = useCallback(() => {
    clearTimeout(dismissTimer.current);
    stopLine();
    activeLesson.current = null;
    teachRef.current = null;
    setTeach(null);
  }, [teachRef]);

  // A lesson slows the road and speaks once. English is on screen at once, and is
  // replaced if the translation lands in time.
  const lesson = useCallback(async (id, data = {}) => {
    const w = world.current;
    if (!w || w.shown.has(id)) return false;
    w.shown.add(id);
    const english = lessonLine(id, run.current.level, data);
    const tone = ['scam', 'bounce', 'bill'].includes(id) ? 'bad' : ['prepay', 'shield_used', 'shield_buy'].includes(id) ? 'good' : 'plain';
    activeLesson.current = id;
    teachRef.current = { id };
    setTeach({ id, english, native: english, tone });
    let native = english;
    if (langRef.current !== 'en') {
      native = translated.current[english] || (await translateLines(langRef.current, { line: english })).line;
      translated.current[english] = native;
    }
    if (world.current !== w || activeLesson.current !== id) return true;
    setTeach({ id, english, native, tone });
    const fallback = Math.max(3200, native.length * 62);
    clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(dismiss, auto ? 2600 : 12000);
    speakLine(native, langRef.current, {
      muted: mutedRef.current,
      onEnd: (spoke) => {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = setTimeout(dismiss, spoke ? 500 : auto ? 2000 : fallback);
      },
    });
    return true;
  }, [auto, dismiss, langRef, mutedRef, teachRef]);

  const begin = useCallback(() => {
    setResult(null);
    setAnswers({});
    setSealed(null);
    setSealError('');
    run.current = createRun(level);
    world.current = newWorld(level, 7 + Math.floor(Math.random() * 1000) * (auto ? 0 : 1));
    syncRoad(world.current, run.current);
    world.current.laneY = null;
    setPhase('play');
    translateLines(lang, Object.fromEntries(['fee', 'apr'].map((id) => [id, lessonLine(id, level)]))).then((out) => {
      translated.current[lessonLine('fee', level)] = out.fee;
      translated.current[lessonLine('apr', level)] = out.apr;
    });
  }, [auto, lang, level]);

  useEffect(() => { if (phase === 'loading') begin(); }, [phase, begin]);
  useEffect(() => () => { clearTimeout(dismissTimer.current); stopLine(); }, []);

  const steer = useCallback((step) => {
    const w = world.current;
    if (!w) return;
    const next = Math.max(0, Math.min(2, w.lane + step));
    if (next !== w.lane) { w.lane = next; w.tilt = step * 0.09; beep(420 + next * 80, 0.03, 'triangle', 0.02); }
  }, []);

  useEffect(() => {
    if (phase !== 'play') return undefined;
    const onKey = (event) => {
      if (['ArrowUp', 'w', 'W'].includes(event.key)) { event.preventDefault(); if (!teachRef.current) steer(-1); }
      else if (['ArrowDown', 's', 'S'].includes(event.key)) { event.preventDefault(); if (!teachRef.current) steer(1); }
      else if ([' ', 'Enter'].includes(event.key) && teachRef.current) { event.preventDefault(); dismiss(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss, phase, steer, teachRef]);

  useEffect(() => {
    if (phase !== 'play') return undefined;
    const el = canvas.current;
    const ctx = el.getContext('2d');
    let frame, last = performance.now(), hudClock = 0, geometry = null;

    const resize = () => {
      const box = el.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.round(box.width * ratio);
      el.height = Math.round(box.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      geometry = layout(box.width, box.height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    const finish = async () => {
      const w = world.current;
      w.ended = true;
      burst(w, geometry.playerX + 60, geometry.roadTop, '#ffd24d', 70, { speed: 330, square: true });
      burst(w, geometry.playerX + 60, geometry.roadTop, '#35c47d', 50, { speed: 330, square: true });
      beep(660, 0.12);
      setTimeout(() => beep(880, 0.2), 120);
      await lesson('apr');
      const wait = () => (teachRef.current ? setTimeout(wait, 200) : (setResult(summary(run.current)), setPhase('quiz')));
      setTimeout(wait, 900);
    };

    const passGate = (gate, g) => {
      const w = world.current, r = run.current;
      gate.passed = true;
      if (gate.fee != null && gate.index == null) {
        if (gate.fee) {
          floatText(w, `−${money(gate.fee)}`, g.playerX + 24, g.roadTop - 20, '#ffb4ae', 20);
          beep(180, 0.15, 'sawtooth', 0.03);
          lesson('fee');
        }
        return;
      }
      const out = payGate(r);
      if (out.bounced) {
        w.shake = 12;
        w.flash = 0.5;
        w.flashColor = '#d3362a';
        floatText(w, `−${money(out.charge)}`, g.playerX + 40, w.laneY - 44, '#ffb4ae', 20);
        beep(130, 0.3, 'sawtooth', 0.05);
        lesson('bounce', out);
      } else {
        const interestPart = Math.round(out.interest), loanPart = Math.round(out.principal);
        floatText(w, `−${money(interestPart)}`, g.playerX + 16, w.laneY - 52, '#ff9c94', 16);
        floatText(w, `−${money(loanPart)}`, g.playerX + 96, w.laneY - 52, '#8ff0bd', 18);
        flyTo(w, g.playerX, w.laneY, 68, 70, '#e8483c', Math.min(14, 2 + Math.round(out.interestShare * 16)));
        flyTo(w, g.playerX, w.laneY, g.width - 80, 70, '#35c47d', Math.min(14, 2 + Math.round((1 - out.interestShare) * 16)));
        beep(520, 0.06);
        if (r.gate === 1) lesson('first_emi', out);
        else if (out.gatesLeft === 1) lesson('last_emi', out);
      }
      syncRoad(w, r);
      if (r.finished) finish();
    };

    const hit = (item, g) => {
      const w = world.current, r = run.current;
      const y = w.laneY;
      if (item.kind === 'prepay' && r.wallet < item.amount) {
        floatText(w, money(item.amount), g.playerX, y - 44, '#ffe27a', 15);
        lesson('prepay_short', { need: item.amount });
        return;
      }
      item.taken = true;
      const out = collect(r, item);
      switch (item.kind) {
        case 'coin':
          floatText(w, `+${money(out.amount)}`, g.playerX + 10, y - 38, '#ffe27a', 15);
          burst(w, g.playerX + 16, y, '#ffd24d', 7, { speed: 120 });
          beep(990, 0.05, 'triangle', 0.03);
          break;
        case 'bill':
          if (out.covered) {
            floatText(w, `🛡 ${money(out.amount)}`, g.playerX + 20, y - 44, '#a9ecff', 20);
            burst(w, g.playerX, y, '#00baf2', 26);
            w.flash = 0.35;
            w.flashColor = '#00baf2';
            beep(740, 0.18);
            lesson('shield_used', out);
          } else {
            floatText(w, `−${money(out.amount)}`, g.playerX + 20, y - 44, '#ffb4ae', 22);
            w.shake = 14;
            w.flash = 0.45;
            w.flashColor = '#d3362a';
            burst(w, g.playerX, y, '#e8483c', 22);
            beep(140, 0.28, 'square', 0.04);
            lesson(item.medical ? 'bill' : 'repair', out);
          }
          break;
        case 'shield':
          if (out.bought) {
            floatText(w, `−${money(out.amount)} 🛡`, g.playerX + 20, y - 44, '#a9ecff', 16);
            beep(660, 0.1);
            lesson('shield_buy', out);
          }
          break;
        case 'scam':
          floatText(w, `−${money(out.amount)}`, g.playerX + 20, y - 44, '#ffb0dc', 22);
          w.shake = 10;
          w.flash = 0.45;
          w.flashColor = '#ff4fa8';
          burst(w, g.playerX, y, '#ff4fa8', 26);
          beep(200, 0.35, 'sawtooth', 0.04);
          lesson('scam', out);
          break;
        case 'prepay':
          if (out.paid) {
            floatText(w, `−${out.periodsSaved} ${r.level.unit === 'day' ? labels.day : labels.month}!`, g.playerX + 40, y - 54, '#ffe27a', 22);
            burst(w, g.playerX, y, '#ffd24d', 34, { speed: 260, square: true });
            w.flash = 0.3;
            w.flashColor = '#ffd24d';
            flyTo(w, g.playerX, y, g.width - 80, 70, '#35c47d', 14);
            beep(880, 0.16);
            syncRoad(w, r);
            lesson('prepay', out);
            if (r.finished) finish();
          }
          break;
        default:
      }
    };

    const autopilot = (g) => {
      const w = world.current, r = run.current;
      const ahead = w.items.filter((item) => !item.taken && item.x > w.x + g.playerX + 30 && item.x < w.x + g.playerX + 300);
      const bad = (item) => item.kind === 'scam' || (item.kind === 'bill' && !(item.medical && r.shield)) || (item.kind === 'prepay' && r.wallet < item.amount + r.level.payment * r.level.stride) || (item.kind === 'shield' && r.shield);
      const score = [0, 1, 2].map((lane) => ahead.filter((item) => item.lane === lane).reduce((sum, item) => sum + (bad(item) ? -5 : 2) * (300 - (item.x - w.x - g.playerX)), 0) - Math.abs(lane - w.lane) * 8);
      const best = score.indexOf(Math.max(...score));
      if (best !== w.lane && !w.steerCooldown) { steer(best > w.lane ? 1 : -1); w.steerCooldown = 0.2; }
    };

    const loop = (now) => {
      const real = Math.min((now - last) / 1000, 0.05);
      last = now;
      const w = world.current, r = run.current, g = geometry;
      const slow = teachRef.current ? 0.05 : w.ended ? 0.35 : 1;
      const dt = real * slow;
      w.time += real;
      w.steerCooldown = Math.max(0, (w.steerCooldown || 0) - real);
      w.x += SPEED * dt;
      const targetY = g.laneY(w.lane);
      w.laneY = w.laneY == null ? targetY : w.laneY + (targetY - w.laneY) * Math.min(1, real * 11);
      w.tilt *= 1 - Math.min(1, real * 8);
      w.shake = Math.max(0, w.shake - real * 30);
      w.flash = Math.max(0, w.flash - real * 1.2);
      const owed = r.balance / r.level.principal;
      w.mountain += (owed - w.mountain) * Math.min(1, real * 4);
      const interestGoal = Math.max(r.level.totalRepay - r.level.principal, 1);
      w.sack += (r.interestPaid / interestGoal - w.sack) * Math.min(1, real * 4);

      if (auto && !teachRef.current) autopilot(g);

      const playerWorld = w.x + g.playerX;
      if (!teachRef.current && !w.ended) {
        for (const item of w.items) {
          if (item.taken || Math.abs(item.x - playerWorld) > 36) continue;
          if (Math.abs(w.laneY - g.laneY(item.lane)) < g.laneHeight * 0.46) hit(item, g);
        }
        for (const gate of w.gates) if (!gate.passed && playerWorld >= gate.x) passGate(gate, g);
      }

      w.floats.forEach((item) => { item.y -= 34 * real; item.life -= real * 0.72; });
      w.floats = w.floats.filter((item) => item.life > 0);
      for (const p of w.parts) {
        if (p.delay > 0) { p.delay -= real; continue; }
        if (p.seek) { p.x += (p.tx - p.x) * Math.min(1, real * 6); p.y += (p.ty - p.y) * Math.min(1, real * 6); }
        else { p.x += p.vx * real; p.y += p.vy * real; p.vy += p.gravity * real; }
        p.life -= real;
      }
      w.parts = w.parts.filter((p) => p.life > 0);

      const totalGates = w.gates.at(-1)?.total || 1;
      const progress = Math.min(1, r.gate / totalGates);

      ctx.save();
      if (w.shake && !QUIET) ctx.translate((Math.random() - 0.5) * w.shake, (Math.random() - 0.5) * w.shake);
      drawSky(ctx, g, progress);
      drawHills(ctx, g, w.x);
      drawTown(ctx, g, w.x);
      drawStreet(ctx, g, w.x);
      drawLamps(ctx, g, w.x);

      const nextShare = r.balance > 0 ? Math.min(1, (r.balance * r.level.periodRate) / r.level.payment) : 0;
      for (const gate of w.gates) {
        const x = gate.x - w.x;
        if (x < -120 || x > g.width + 120) continue;
        const firstUnpaid = !gate.passed && gate.index != null;
        drawGate(ctx, g, x, { ...gate, share: firstUnpaid ? nextShare : 0 }, shortMoney, words);
      }
      for (const item of w.items) {
        if (item.taken) continue;
        const x = item.x - w.x;
        if (x < -80 || x > g.width + 80) continue;
        drawPickup(ctx, item, x, g.laneY(item.lane), w.time, shortMoney);
      }
      if (r.bounces) drawSnowball(ctx, g.playerX - 76 - Math.sin(w.time * 2) * 6, w.laneY, r.bounces, w.time);
      drawAuto(ctx, g.playerX, w.laneY, { tilt: w.tilt, wheel: w.x * 0.05, shield: r.shield, time: w.time });
      drawSack(ctx, w.sack, shortMoney(r.interestPaid), labels.interest);
      drawMountain(ctx, g, Math.max(0, Math.min(1.1, w.mountain)), shortMoney(r.balance), labels.loanLeft);
      drawParticles(ctx, w.parts);
      drawFloats(ctx, w.floats);
      if (w.flash) {
        ctx.globalAlpha = w.flash * 0.45;
        ctx.fillStyle = w.flashColor;
        ctx.fillRect(0, 0, g.width, g.height);
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      hudClock += real;
      if (hudClock > 0.12) { hudClock = 0; setTick((value) => (value + 1) % 1000); }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    window.__karz = { run: run.current, world: world.current, steer };
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [auto, labels, lesson, phase, steer, teachRef, words]);

  const pointer = useRef(null);
  const onPointerDown = (event) => { pointer.current = { y: event.clientY, x: event.clientX, at: Date.now() }; };
  const onPointerUp = (event) => {
    if (teach) { dismiss(); return; }
    const start = pointer.current;
    if (!start) return;
    const box = event.currentTarget.getBoundingClientRect();
    const swipe = event.clientY - start.y;
    if (Math.abs(swipe) > 24) steer(swipe < 0 ? -1 : 1);
    else steer(event.clientY - box.top < box.height * 0.74 ? -1 : 1);
  };

  const submitQuiz = async () => {
    const list = quiz.map((_, index) => answers[index] ?? null);
    try {
      const out = await sealUnderstanding(sessionId, { game: 'karz', level: level.id, answers: list, run: result });
      setSealed(out);
      onSealed?.(out);
    } catch (error) { setSealError(error.message); }
    setPhase('result');
  };

  useEffect(() => {
    if (phase !== 'quiz' || !auto) return;
    const timer = setTimeout(() => {
      setAnswers(Object.fromEntries(quiz.map((question, index) => [index, question.answer])));
    }, 500);
    return () => clearTimeout(timer);
  }, [auto, phase, quiz]);
  useEffect(() => {
    if (phase === 'quiz' && auto && Object.keys(answers).length === quiz.length) {
      const timer = setTimeout(submitQuiz, 800);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [answers, auto, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'menu') {
    return (
      <div className="kg-panel kg-menu">
        <header>
          <h2>{labels.title}</h2>
          <p>{labels.tag}</p>
        </header>
        <div className="kg-field">
          <label htmlFor="kg-lang">Language</label>
          <select id="kg-lang" value={lang} onChange={(event) => setLang(event.target.value)}>
            {GAME_LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </div>
        <h3>{labels.choose}</h3>
        <div className="kg-levels" role="radiogroup" aria-label={labels.choose}>
          {levelIds().map((id) => {
            const option = id === 'personal' && card ? levelFromCard(card) : buildLevel(id);
            return (
              <button key={id} type="button" role="radio" aria-checked={levelId === id} className={levelId === id ? 'is-active' : ''} onClick={() => setLevelId(id)}>
                <b>{option.title}</b>
                <small>{option.blurb}</small>
                <span>{inr(option.principal)} · {option.ratePct != null ? `${pct(option.ratePct)} shown · ` : ''}{pct(option.aprPct)} real cost</span>
              </button>
            );
          })}
        </div>
        <ul className="kg-how">
          <li><i className="is-coin">₹</i>{labels.howGold}</li>
          <li><i className="is-gate">⛩</i>{labels.howGate}</li>
          <li><i className="is-trap">🎁</i>{labels.howTrap}</li>
          <li><i className="is-bill">✚</i>{labels.howBill}</li>
          <li><i className="is-shield">🛡</i>{labels.howShield}</li>
          <li><i className="is-gold">∩</i>{labels.howExtra}</li>
        </ul>
        <div className="kg-actions">
          <button type="button" className="kg-go" onClick={begin} autoFocus>{labels.start}</button>
          <button type="button" aria-expanded={showTable} onClick={() => setShowTable((value) => !value)}>{showTable ? 'Hide the table' : 'Show it as a table instead'}</button>
        </div>
        {showTable && (
          <div className="kg-table-wrap">
            <table className="kg-table">
              <caption>{level.title}: where each payment goes</caption>
              <thead><tr><th scope="col">{level.unit === 'day' ? 'Day' : 'Month'}</th><th scope="col">You pay</th><th scope="col">Interest</th><th scope="col">Off the loan</th><th scope="col">Still owed</th></tr></thead>
              <tbody>{scheduleRows(level).map((row) => <tr key={row.at}><td>{row.at}</td><td>{inr(row.paid)}</td><td>{inr(row.interest)}</td><td>{inr(row.loan)}</td><td>{inr(row.left)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        <p className="kg-note">The figures come from the same engines as the call. The wallet, the bills and the bounce charge are examples, so your own KFS decides the real charges.</p>
      </div>
    );
  }

  if (phase === 'quiz' && result) {
    const done = quiz.every((_, index) => answers[index] != null);
    return (
      <div className="kg-panel kg-quiz">
        <h2>{labels.quizTitle}</h2>
        <p className="kg-lead">{labels.quizLead}</p>
        <ol>
          {quiz.map((question, q) => (
            <li key={question.id}>
              <p>{quizLines[`q${q}`] || question.q}</p>
              <div role="radiogroup" aria-label={question.q}>
                {question.options.map((option, o) => <button key={option} type="button" role="radio" aria-checked={answers[q] === o} className={answers[q] === o ? 'is-active' : ''} onClick={() => setAnswers((value) => ({ ...value, [q]: o }))}>{quizLines[`q${q}o${o}`] || option}</button>)}
              </div>
            </li>
          ))}
        </ol>
        <button type="button" className="kg-go" disabled={!done} onClick={submitQuiz}>{labels.check}</button>
      </div>
    );
  }

  if (phase === 'result' && result) {
    const grade = sealed?.grade;
    return (
      <div className="kg-panel kg-result">
        <Stars count={result.stars} />
        <div className="kg-compare">
          <div><span>{level.ratePct != null ? 'Rate shown' : 'Rate shown'}</span><s>{level.ratePct != null ? pct(level.ratePct) : 'None'}</s></div>
          <div><span>Real yearly cost</span><b>{pct(level.aprPct)}</b></div>
        </div>
        <dl className="kg-stats">
          <div><dt>{labels.reached}</dt><dd>{inr(result.received)}</dd></div>
          <div><dt>{labels.totalPaid}</dt><dd>{inr(result.paid)}</dd></div>
          <div><dt>{labels.interestAll}</dt><dd>{inr(result.interestPaid)}</dd></div>
          <div><dt>{labels.charges}</dt><dd>{inr(result.charges)}</dd></div>
          {result.mistakesCost > 0
            ? <div><dt>{labels.mistakes}</dt><dd className="is-bad">{inr(result.mistakesCost)}</dd></div>
            : <div><dt>{labels.saved}</dt><dd className="is-good">{inr(result.interestSaved)}</dd></div>}
          <div><dt>{labels.finishedIn}</dt><dd>{result.periodsTaken} {result.unit === 'day' ? labels.day : labels.month}</dd></div>
        </dl>
        {result.firstInterestShare != null && <p className="kg-insight">Your first payment was <b>{result.firstInterestShare}% interest</b>. Your last was <b>{result.lastInterestShare}%</b>.</p>}
        {grade && (
          <section className="kg-receipt">
            <p className="kg-receipt-head">{labels.sealed}</p>
            <p>You understood <b>{grade.correct} of {grade.total}</b>{sealed.passport ? <> · <code>{sealed.passport.id}</code></> : null}</p>
            {grade.rows.filter((row) => !row.correct).map((row) => <p key={row.id} className="kg-missed">{row.question} <b>{row.right}</b></p>)}
          </section>
        )}
        {sealError && <p className="kg-note">The receipt could not be sealed: {sealError}</p>}
        <div className="kg-actions">
          <button type="button" className="kg-go" onClick={begin}>{labels.again}</button>
          <button type="button" onClick={() => setPhase('menu')}>{labels.another}</button>
          {onAsk && <button type="button" onClick={() => onAsk('Should I prepay or invest ₹50,000?')}>{labels.ask}</button>}
        </div>
      </div>
    );
  }

  const r = run.current;
  return (
    <div className="kg-play">
      {r && <Hud run={r} labels={labels} level={r.level} tick={tick} />}
      <canvas ref={canvas} className="kg-canvas" onPointerDown={onPointerDown} onPointerUp={onPointerUp} aria-label={`${labels.title}. ${r ? `${labels.loanLeft} ${inr(Math.round(r.balance))}` : ''}`} />
      <div className="kg-steer" aria-hidden={Boolean(teach)}>
        <button type="button" aria-label={labels.up} onClick={() => steer(-1)}>▲</button>
        <button type="button" aria-label={labels.down} onClick={() => steer(1)}>▼</button>
      </div>
      <button type="button" className="kg-mute" aria-pressed={muted} aria-label={muted ? 'Unmute MITRA' : 'Mute MITRA'} onClick={() => { setMuted((value) => !value); stopLine(); }}>{muted ? '🔇' : '🔊'}</button>
      {teach && (
        <button type="button" className={`kg-teach is-${teach.tone}`} onClick={dismiss} lang={lang}>
          <span className="kg-teach-who">MITRA</span>
          <span className="kg-teach-text">{teach.native}</span>
          {teach.native !== teach.english && <small>{teach.english}</small>}
          <em>{labels.tap}</em>
        </button>
      )}
    </div>
  );
}
