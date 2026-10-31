import React, { useEffect, useMemo, useState } from 'react';
import { gradeCard, SCAM_DECK } from '../game/scamDeck.js';
import { beep, sealUnderstanding, speakLine, stopLine, useLines } from './arcadeShared.js';

const LABELS = {
  lead: 'Ten requests. Block the trap, or pay the real one. One wrong tap can cost you everything, so read each one.',
  block: 'Block it', pay: 'It is safe', right: 'Right.', wrong: 'Careful.', next: 'Next', trap: 'This was a trap', real: 'This one was real', again: 'Play again', done: 'Your Fraud IQ', sealed: 'Sealed on your Journey Passport',
  ask: 'Check a real message with MITRA',
};

export default function ScamShield({ lang = 'en', sessionId = null, onExit, onSealed, onAsk }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [shown, setShown] = useState(null);
  const [sealed, setSealed] = useState(null);
  const [slide, setSlide] = useState('');
  const labels = useLines(lang, LABELS);
  const lines = useLines(lang, useMemo(() => Object.fromEntries(SCAM_DECK.map((card) => [card.id, card.text])), []));
  const whyLines = useLines(lang, useMemo(() => Object.fromEntries(SCAM_DECK.map((card) => [card.id, gradeCard(card, card.scam).why])), []));

  const card = SCAM_DECK[index];
  const done = index >= SCAM_DECK.length;
  const score = answers.filter((answer, at) => answer === SCAM_DECK[at].scam).length;
  const lives = 3 - answers.filter((answer, at) => answer !== SCAM_DECK[at].scam).length;

  const choose = (blocked) => {
    if (shown || !card) return;
    const graded = gradeCard(card, blocked);
    setAnswers((list) => [...list, blocked]);
    setSlide(blocked ? 'is-left' : 'is-right');
    setShown(graded);
    beep(graded.correct ? 880 : 150, graded.correct ? 0.1 : 0.3, graded.correct ? 'sine' : 'sawtooth', 0.04);
    speakLine(whyLines[card.id], lang, { muted: new URLSearchParams(window.location.search).get('gamemute') === '1' });
  };

  const next = () => {
    stopLine();
    setShown(null);
    setSlide('');
    setIndex((value) => value + 1);
  };

  useEffect(() => {
    const onKey = (event) => {
      if (done) return;
      if (shown && [' ', 'Enter', 'ArrowRight', 'ArrowLeft'].includes(event.key)) { event.preventDefault(); next(); }
      else if (!shown && event.key === 'ArrowLeft') choose(true);
      else if (!shown && event.key === 'ArrowRight') choose(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!done || sealed) return undefined;
    let live = true;
    sealUnderstanding(sessionId, { game: 'scam', answers }).then((out) => { if (live) { setSealed(out); onSealed?.(out); } }).catch(() => {});
    return () => { live = false; };
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopLine(), []);

  if (done) {
    return (
      <div className="kg-panel kg-result">
        <p className="kg-eyebrow">{labels.done}</p>
        <p className="ss-score">{score}<small> / {SCAM_DECK.length}</small></p>
        {sealed?.passport && <section className="kg-receipt"><p className="kg-receipt-head">{labels.sealed}</p><p><code>{sealed.passport.id}</code></p></section>}
        <div className="kg-actions">
          <button type="button" className="kg-go" onClick={() => { setIndex(0); setAnswers([]); setSealed(null); }}>{labels.again}</button>
          {onAsk && <button type="button" onClick={() => onAsk('Is this message a scam?')}>{labels.ask}</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="kg-panel ss">
      <header className="ss-head">
        <h2>Scam Shield</h2>
        <div className="ss-meta">
          <span aria-label={`${Math.max(lives, 0)} of 3 shields left`}>{[0, 1, 2].map((i) => <i key={i} className={i < lives ? 'is-on' : ''}>🛡</i>)}</span>
          <b>{index + 1} / {SCAM_DECK.length}</b>
        </div>
      </header>
      {index === 0 && !shown && <p className="kg-lead">{labels.lead}</p>}
      <article className={`ss-card ${slide}`}>
        <p className="ss-from">{card.from}</p>
        <p className="ss-text" lang={lang}>{lines[card.id]}</p>
        {lines[card.id] !== card.text && <p className="ss-gloss">{card.text}</p>}
      </article>
      {shown ? (
        <section className={`ss-verdict ${shown.correct ? 'is-good' : 'is-bad'}`} role="status">
          <b>{shown.correct ? labels.right : labels.wrong} {shown.scam ? labels.trap : labels.real}</b>
          <p lang={lang}>{whyLines[card.id]}</p>
          {shown.flags.length > 0 && <ul>{shown.flags.slice(0, 3).map((flag) => <li key={flag}>{flag}</li>)}</ul>}
          <button type="button" className="kg-go" onClick={next} autoFocus>{labels.next}</button>
        </section>
      ) : (
        <div className="ss-buttons">
          <button type="button" className="is-block" onClick={() => choose(true)}>✋ {labels.block}</button>
          <button type="button" className="is-pay" onClick={() => choose(false)}>✓ {labels.pay}</button>
        </div>
      )}
    </div>
  );
}
