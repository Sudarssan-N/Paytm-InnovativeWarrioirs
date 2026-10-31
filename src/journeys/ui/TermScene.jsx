import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createGame, GAME, leaveShop, rewindGame, skipStorm, stepGame, toggleShield, voiceLines, walkTo, yearsOfBills } from '../game/termGame.js';
import { defaultScene, lakhs, quizFor, sceneFromGap, spanLabel, TERM_UI } from '../game/termScene.js';
import { inr } from '../money.js';
import { drawGhar, tapToWorld, viewFor, WORLD } from './gharPaint.js';
import { beep, GAME_LANGUAGES, preloadLine, sealUnderstanding, speakLine, stopLine, translateLines, useLines } from './arcadeShared.js';

const startsMuted = () => new URLSearchParams(window.location.search).get('gamemute') === '1';
// Lines that must be heard. Anything else gives way to a line already being spoken.
const MUST_SAY = new Set(['start', 'shop', 'storm', 'payout', 'noPayout', 'cousin', 'loseEmpty', 'loseDebt', 'win', 'coda']);

function sceneFor(card) {
  if (card?.life?.target != null && card.annualIncome != null) return sceneFromGap(card);
  return defaultScene();
}

// English shows until the whole set has landed, so one line never speaks in the wrong language.
function useVoiceLines(lang, lines) {
  const signature = JSON.stringify(lines);
  const [state, setState] = useState({ lines, ready: lang === 'en', lang });
  useEffect(() => {
    let live = true;
    if (lang === 'en') { setState({ lines, ready: true, lang }); return undefined; }
    setState({ lines, ready: false, lang });
    translateLines(lang, lines).then((out) => { if (live) setState({ lines: out, ready: true, lang }); });
    return () => { live = false; };
  }, [lang, signature]); // eslint-disable-line react-hooks/exhaustive-deps
  return state.lang === lang ? state : { lines, ready: lang === 'en', lang };
}

export default function TermScene({ card = null, lang = 'en', sessionId = null, onSealed, onAsk }) {
  const scene = useMemo(() => sceneFor(card), [card]);
  const quiz = useMemo(() => quizFor(scene), [scene]);
  const [storyLang, setStoryLang] = useState(lang);
  useEffect(() => setStoryLang(lang), [lang]);

  const labels = useLines(storyLang, TERM_UI);
  const barks = useVoiceLines(storyLang, useMemo(() => voiceLines(scene), [scene]));
  const quizLines = useLines(storyLang, useMemo(() => {
    const map = { assumption: scene.assumption, spanToday: spanLabel(scene.without.months), spanPlan: spanLabel(scene.with.months) };
    quiz.forEach((question, q) => {
      map[`q${q}`] = question.q;
      question.options.forEach((option, o) => { map[`q${q}o${o}`] = option; });
    });
    return map;
  }, [quiz, scene]));

  // title → play → coda → quiz. The game's own stages live in the rules.
  const [phase, setPhase] = useState('title');
  const [hud, setHud] = useState(null);
  const [caption, setCaption] = useState('');
  const [voiceOn, setVoiceOn] = useState(() => !startsMuted());
  const [answers, setAnswers] = useState({});
  const [sealed, setSealed] = useState(null);

  const canvasRef = useRef(null);
  const gameRef = useRef(createGame(scene));
  const viewRef = useRef(null);
  const keys = useRef({ left: false, right: false, jump: false });
  const bits = useRef([]);
  const shown = useRef(0);
  const speaking = useRef(false);
  const waiting = useRef(null);
  const live = useRef({});
  live.current = { phase, labels, barks: barks.lines, storyLang, voiceOn, scene };

  // One line of voice, with the same words on screen. Without a voice, the words still show.
  const say = useCallback(function say(key, text) {
    const { barks: lines, storyLang: code, voiceOn: on } = live.current;
    const line = text || lines[key];
    if (!line) return;
    // A smaller line waits for the one being spoken, and only the newest one waits.
    if (speaking.current && !MUST_SAY.has(key)) { waiting.current = { key, line, at: performance.now() }; return; }
    waiting.current = null;
    setCaption(line);
    if (!on) { stopLine(); return; }
    speaking.current = true;
    speakLine(line, code, {
      onEnd: () => {
        speaking.current = false;
        const held = waiting.current;
        waiting.current = null;
        if (held && performance.now() - held.at < 4000) say(held.key, held.line);
      },
    });
  }, []);

  useEffect(() => () => stopLine(), []);

  const float = (x, y, text, color) => bits.current.push({ x, y, vy: -0.9, life: 1.5, delay: 0, text, color });
  const burst = (x, y, gx, gy, img, count) => {
    for (let at = 0; at < count; at += 1) bits.current.push({ x, y, gx: gx + at * 0.2, gy, img, delay: at * 0.04, life: 0.9 });
  };

  // What the rules just decided becomes sound, words and sparks here.
  const react = useCallback((event, g) => {
    const L = live.current.labels;
    const money = live.current.scene;
    switch (event.type) {
      case 'ore':
        beep(880, 0.08, 'square', 0.03);
        burst(event.x, WORLD.ground - event.h - 1, event.x, WORLD.ground - event.h - 3, 'gold', 4);
        float(event.x, WORLD.ground - event.h - 1.8, `+${inr(Math.round(money.income / 3))}`, '#ffe680');
        break;
      case 'billDue': beep(240, 0.14, 'sawtooth', 0.03); say('billDue'); break;
      case 'paid':
        beep(520, 0.07, 'square', 0.03);
        burst(event.x, WORLD.ground - 1, event.x, WORLD.ground - 3, 'gold', 3);
        if (g.stage === 'hold') float(event.x, WORLD.ground - 2.4, `-${inr(money.monthlyNeed * 12)}`, '#ffb4ad');
        break;
      case 'shop': say('shop'); break;
      case 'buy': beep(990, 0.14, 'sine', 0.05); say(event.id); break;
      case 'unbuy': beep(300, 0.1, 'triangle', 0.04); break;
      case 'storm': beep(70, 0.9, 'sawtooth', 0.07); say('storm'); break;
      case 'payout':
        beep(1040, 0.5, 'sine', 0.06);
        for (let at = 0; at < 30; at += 1) bits.current.push({ x: 20 + (at % 5), y: -1, gx: 20 + (at % 5), gy: 11, img: 'emerald', delay: at * 0.05, life: 1.2 });
        say('payout');
        break;
      case 'noPayout': beep(150, 0.5, 'triangle', 0.06); say('noPayout'); break;
      case 'hold': say('hold'); break;
      case 'late': beep(130, 0.3, 'sawtooth', 0.06); say('late'); break;
      case 'cousin': beep(420, 0.2, 'square', 0.05); say('cousin'); break;
      case 'cousinStopped': beep(880, 0.16, 'sine', 0.05); float(event.x, WORLD.ground - 2.6, '✓', '#8ff2b4'); say('cousinStopped'); break;
      case 'cousinTook': beep(110, 0.4, 'sawtooth', 0.06); say('cousinTook'); break;
      case 'hospitalCovered': beep(880, 0.16, 'sine', 0.05); float(event.x, WORLD.ground - 2.6, '✓', '#8ff2b4'); say('hospitalCovered'); break;
      case 'hospitalPaid': beep(110, 0.4, 'sawtooth', 0.06); say(event.hadTerm ? 'hospitalPaidTerm' : 'hospitalPaid'); break;
      case 'lose': beep(90, 0.8, 'sawtooth', 0.07); say(event.reason === 'debt' ? 'loseDebt' : 'loseEmpty'); break;
      case 'win': beep(990, 0.5, 'sine', 0.06); say('win'); break;
      default:
    }
  }, [say]);

  const start = () => {
    beep(660, 0.1, 'sine', 0.05);
    gameRef.current = createGame(scene);
    bits.current = [];
    setSealed(null);
    setAnswers({});
    setPhase('play');
    say('start');
    preloadLine(barks.lines.billDue, storyLang);
    preloadLine(barks.lines.shop, storyLang);
    preloadLine(barks.lines.storm, storyLang);
  };

  const rewind = () => {
    stopLine();
    speaking.current = false;
    waiting.current = null;
    gameRef.current = rewindGame(gameRef.current);
    bits.current = [];
    shown.current = 0;
    setCaption('');
    say('shop');
  };

  const toCoda = () => {
    stopLine();
    speaking.current = false;
    waiting.current = null;
    setPhase('coda');
    say('coda');
  };

  const toQuiz = () => { stopLine(); speaking.current = false; waiting.current = null; setCaption(''); setPhase('quiz'); };

  const again = () => {
    stopLine();
    speaking.current = false;
    waiting.current = null;
    gameRef.current = createGame(scene);
    bits.current = [];
    setCaption('');
    setAnswers({});
    setSealed(null);
    setPhase('title');
  };

  const shieldClick = (id) => toggleShield(gameRef.current, id).forEach((event) => react(event, gameRef.current));
  const goOn = () => leaveShop(gameRef.current).forEach((event) => react(event, gameRef.current));

  const onPointerDown = (event) => {
    const g = gameRef.current;
    const view = viewRef.current;
    if (phase !== 'play' || !view) return;
    if (g.stage === 'storm') { skipStorm(g); return; }
    const box = event.currentTarget.getBoundingClientRect();
    const at = tapToWorld(view, event.clientX - box.left, event.clientY - box.top);
    walkTo(g, at.x);
    g.wantJump = at.y < WORLD.ground - 1.6;
  };

  useEffect(() => {
    const set = (event, on) => {
      if (live.current.phase !== 'play') return;
      const key = event.key;
      if (key === 'ArrowLeft' || key === 'a' || key === 'A') keys.current.left = on;
      else if (key === 'ArrowRight' || key === 'd' || key === 'D') keys.current.right = on;
      else if (key === ' ' || key === 'ArrowUp' || key === 'w' || key === 'W') {
        event.preventDefault();
        keys.current.jump = on;
      }
    };
    const down = (event) => set(event, true);
    const up = (event) => set(event, false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const reactRef = useRef(react);
  reactRef.current = react;

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return undefined;
    const ctx = el.getContext('2d');
    let frame = 0;
    let last = performance.now();
    let hudKey = '';

    const resize = () => {
      const box = el.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.round(box.width * ratio);
      el.height = Math.round(box.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      viewRef.current = viewFor(box.width, box.height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    const loop = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const g = gameRef.current;
      if (live.current.phase === 'play') {
        const dir = (keys.current.right ? 1 : 0) - (keys.current.left ? 1 : 0);
        const events = stepGame(g, dt, { dir, jump: keys.current.jump });
        for (const event of events) reactRef.current(event, g);
      } else g.time += dt;

      for (const bit of bits.current) {
        if (bit.delay > 0) { bit.delay -= dt; continue; }
        if (bit.gx != null) { bit.x += (bit.gx - bit.x) * Math.min(1, dt * 6); bit.y += (bit.gy - bit.y) * Math.min(1, dt * 6); }
        if (bit.vy) bit.y += bit.vy * dt;
        bit.life -= dt;
      }
      bits.current = bits.current.filter((bit) => bit.life > 0);
      g.bits = bits.current;
      shown.current += (g.blocks - shown.current) * Math.min(1, dt * 5);

      const { labels: L, scene: money } = live.current;
      const view = viewRef.current;
      if (view) {
        drawGhar(ctx, view, g, {
          shownBlocks: shown.current,
          todayBlocks: yearsOfBills(money.without.pot, money.monthlyNeed),
          labels: L,
        });
      }

      // The React side only hears when something on the HUD really changed.
      const key = [g.stage, g.wallet, Math.round(g.blocks * 10), g.age, g.hearts, g.term, g.health, g.month, g.attempt].join('|');
      if (key !== hudKey) {
        hudKey = key;
        setHud({ stage: g.stage, wallet: g.wallet, blocks: g.blocks, age: g.age, hearts: g.hearts, term: g.term, health: g.health, outcome: g.outcome, attempt: g.attempt });
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);

  const submit = async () => {
    const list = quiz.map((_, at) => answers[at] ?? null);
    const perfect = list.every((answer, at) => answer === quiz[at].answer);
    beep(perfect ? 880 : 300, 0.2, perfect ? 'sine' : 'triangle', 0.04);
    try {
      const out = await sealUnderstanding(sessionId, { game: 'term', answers: list });
      setSealed(out);
      onSealed?.(out);
    } catch { /* the game still stands without a receipt */ }
  };

  const stage = hud?.stage;
  const outcome = hud?.outcome;
  const playing = phase === 'play';

  return (
    <div className={`kg-panel ts mb${phase === 'quiz' ? ' is-quiz' : ''}`}>
      <div className="mb-stage">
        <canvas ref={canvasRef} aria-hidden="true" onPointerDown={onPointerDown} />

        {playing && (
          <div className="mb-hud">
            {(stage === 'earn' || stage === 'shop') && <div><span>{labels.wallet}</span><b>{inr(hud.wallet)}</b></div>}
            {(stage === 'hold' || stage === 'storm') && (
              <>
                <div className="is-gold"><span>{labels.gold}</span><b>{hud.blocks.toFixed(1)}</b><small>{labels.years}</small></div>
                <div><span>{labels.anuAge}</span><b>{hud.age}</b><small>{labels.goal}</small></div>
                <div className="mb-hearts" aria-label={`${hud.hearts} of ${GAME.hearts}`}>{'♥'.repeat(Math.max(hud.hearts, 0))}<i>{'♥'.repeat(Math.max(GAME.hearts - hud.hearts, 0))}</i></div>
              </>
            )}
            <div className="mb-shields">
              <i className={hud?.term ? 'is-term' : ''} title={labels.termName}>T</i>
              <i className={hud?.health ? 'is-health' : ''} title={labels.healthName}>H</i>
            </div>
          </div>
        )}
        {playing && (
          <button type="button" className="mb-sound" aria-pressed={voiceOn} aria-label={voiceOn ? labels.voiceOn : labels.voiceOff} onClick={() => { if (voiceOn) { stopLine(); speaking.current = false; } setVoiceOn(!voiceOn); }}>{voiceOn ? '🔊' : '🔇'}</button>
        )}

        {playing && caption && stage !== 'over' && <p className="mb-caption" role="status" lang={storyLang}>{caption}</p>}

        {playing && stage === 'shop' && (
          <div className="mb-shop">
            <button type="button" className={`mb-btn${hud.term ? ' is-on' : ''}`} aria-pressed={hud.term} onClick={() => shieldClick('term')}>
              <span><b>{labels.termName}{hud.term ? ` ✓ ${labels.taken}` : ''}</b><small>{inr(scene.plan.premiumMonth)} {labels.perMonth}. {labels.termDoes}</small></span>
            </button>
            <button type="button" className={`mb-btn${hud.health ? ' is-on' : ''}`} aria-pressed={hud.health} onClick={() => shieldClick('health')}>
              <span><b>{labels.healthName}{hud.health ? ` ✓ ${labels.taken}` : ''}</b><small>{inr(scene.health.premiumMonth)} {labels.perMonth}. {labels.healthDoes}</small></span>
            </button>
            <button type="button" className="mb-btn is-go" onClick={goOn}>{labels.shopGo} ▶</button>
          </div>
        )}

        {playing && stage === 'over' && outcome && (
          <div className={`mb-end${outcome.won ? ' is-won' : ''}`}>
            <h2>{outcome.won ? labels.winTitle : outcome.reason === 'debt' ? labels.loseDebt : labels.loseTitle}</h2>
            <p>{outcome.won ? labels.winAge : `${labels.loseAge} ${outcome.age}.`}</p>
            <p className="mb-chose">{labels.chose}: {[outcome.term && labels.termName, outcome.health && labels.healthName].filter(Boolean).join(' + ') || labels.chosenNone}</p>
            {outcome.won && <p className="mb-stars" aria-label={`${[true, outcome.hearts === GAME.hearts, outcome.cousinStopped].filter(Boolean).length} of 3`}>{[true, outcome.hearts === GAME.hearts, outcome.cousinStopped].map((on, at) => <i key={at} className={on ? 'is-on' : ''}>★</i>)}</p>}
            {outcome.won && <p>{labels.leftover}: {outcome.blocks.toFixed(1)} {labels.years}</p>}
            <div>
              {!outcome.won && <button type="button" className="mb-btn is-go" onClick={rewind}>⏪ {labels.rewind}</button>}
              <button type="button" className={`mb-btn${outcome.won ? ' is-go' : ''}`} onClick={toCoda}>{outcome.won ? `${labels.continueOn} ▶` : labels.skipToEnd}</button>
            </div>
          </div>
        )}

        {phase === 'coda' && (
          <div className="mb-end is-won">
            <h2>{labels.codaTitle}</h2>
            <p>{labels.codaLine}</p>
            <div><button type="button" className="mb-btn is-go" onClick={toQuiz}>{labels.continueOn} ▶</button></div>
          </div>
        )}

        {phase === 'title' && (
          <div className="mb-title">
            <h2>{labels.title}</h2>
            <p className="mb-tag">{labels.tag}</p>
            <p>{labels.intro}</p>
            <div className="mb-title-row">
              <label htmlFor="mb-lang">🌐</label>
              <select id="mb-lang" value={storyLang} onChange={(event) => setStoryLang(event.target.value)}>
                {GAME_LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
              <button type="button" aria-pressed={voiceOn} className="mb-btn" onClick={() => setVoiceOn((value) => !value)}>{voiceOn ? `🔊 ${labels.voiceOn}` : `🔇 ${labels.voiceOff}`}</button>
            </div>
            <button type="button" className="mb-btn is-go" disabled={!barks.ready} onClick={start}>{barks.ready ? `▶ ${labels.start}` : labels.preparing}</button>
            <small>{labels.how}</small>
            <small>{labels.sample}</small>
          </div>
        )}
      </div>

      {phase === 'quiz' && (
        <>
          <section className="mb-summary">
            <h3>{labels.summaryTitle}</h3>
            <div className="mb-summary-cards">
              <div>
                <b>{labels.summaryToday}</b>
                <dl>
                  <dt>{labels.summaryPays}</dt><dd>{lakhs(scene.without.pot)}</dd>
                  <dt>{labels.summaryLasts}</dt><dd>{quizLines.spanToday}</dd>
                  <dt>{labels.summaryCost}</dt><dd>{labels.summaryNone}</dd>
                </dl>
              </div>
              <div className="is-plan">
                <b>{labels.summaryPlan}</b>
                <dl>
                  <dt>{labels.summaryPays}</dt><dd>{lakhs(scene.with.pot)}</dd>
                  <dt>{labels.summaryLasts}</dt><dd>{quizLines.spanPlan}</dd>
                  <dt>{labels.summaryCost}</dt><dd>{inr(scene.plan.premiumYear)} {labels.aYear}</dd>
                </dl>
              </div>
            </div>
            <p className="kg-note">{quizLines.assumption || scene.assumption} {labels.madeUp}</p>
          </section>

          <section className="kg-quiz">
            <h2>{labels.quizTitle}</h2>
            <p className="kg-lead">{labels.quizLead}</p>
            <ol>
              {quiz.map((question, q) => (
                <li key={question.id}>
                  <p lang={storyLang}>{quizLines[`q${q}`] || question.q}</p>
                  <div>
                    {question.options.map((option, o) => (
                      <button key={option} type="button" role="radio" aria-checked={answers[q] === o} className={answers[q] === o ? 'is-active' : ''} onClick={() => setAnswers((value) => ({ ...value, [q]: o }))}>{quizLines[`q${q}o${o}`] || option}</button>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {sealed?.passport && (
            <section className="kg-receipt">
              <p className="kg-receipt-head">{labels.sealed}</p>
              <p><code>{sealed.passport.id}</code> · {sealed.grade.correct} of {sealed.grade.total}</p>
            </section>
          )}

          <div className="kg-actions">
            {!sealed && <button type="button" className="kg-go" disabled={quiz.some((_, q) => answers[q] == null)} onClick={submit}>{labels.check}</button>}
            <button type="button" onClick={again}>{labels.again}</button>
            {onAsk && <button type="button" onClick={() => onAsk('How much insurance do I need?')}>{labels.ask}</button>}
          </div>
        </>
      )}
    </div>
  );
}
