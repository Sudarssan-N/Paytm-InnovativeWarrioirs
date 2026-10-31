import React, { Suspense, lazy, useEffect, useState } from 'react';
import { GAME_LANGUAGES, stopLine } from './arcadeShared.js';
import './arcade.css';

const LoanGame = lazy(() => import('./LoanGame.jsx'));
const ScamShield = lazy(() => import('./ScamShield.jsx'));
const ClaimDetective = lazy(() => import('./ClaimDetective.jsx'));
const TermScene = lazy(() => import('./TermScene.jsx'));

const GAMES = [
  { id: 'karz', name: 'Karz Yatra', what: 'Drive your own loan', teaches: 'APR, EMI split, prepaying, bounces, insurance', art: '🛺' },
  { id: 'term', name: 'Kal Ka Ghar', what: 'What a term plan really does', teaches: 'A block-world story: who gets paid, how long the money lasts, and what comes back', art: '🧱' },
  { id: 'scam', name: 'Scam Shield', what: 'Block the trap, pay the real one', teaches: 'Collect requests, fake KYC, digital arrest, task scams', art: '🛡' },
  { id: 'claim', name: 'Claim Detective', what: 'Find the unfair cut on a hospital bill', teaches: 'Room rent limits, proportionate deductions', art: '🔍' },
];

export default function Arcade({ open, card, household = null, sessionId, lang, onClose, onSealed, onAsk, auto = false, level = null }) {
  const [gameLang, setGameLang] = useState(GAME_LANGUAGES.some(([code]) => code === lang) ? lang : 'en');
  const [game, setGame] = useState(open === true ? null : open);

  useEffect(() => { setGame(open === true ? null : open); }, [open]);
  useEffect(() => { if (GAME_LANGUAGES.some(([code]) => code === lang)) setGameLang(lang); }, [lang]);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const close = () => { stopLine(); onClose(); };
  const ask = (prompt) => { stopLine(); onClose(); onAsk(prompt); };
  const shared = { lang: gameLang, sessionId, onSealed, onAsk: ask };
  if (!open) return null;

  return (
    <div className="kg-overlay" role="dialog" aria-modal="true" aria-label="MITRA Arcade">
      <div className="kg-frame">
        <header className="kg-top">
          {game ? <button type="button" onClick={() => { stopLine(); setGame(null); }}>‹ Games</button> : <b>Learn by playing</b>}
          <button type="button" className="kg-close" aria-label="Close and go back to the call" onClick={close}>✕</button>
        </header>
        <Suspense fallback={<p className="kg-loading">Loading…</p>}>
          {!game && (
            <div className="kg-panel kg-hub">
              <h2>The hard parts of money, played instead of explained</h2>
              <p className="kg-lead">Each game uses the same engines as the call, speaks your language, and seals what you understood on your Journey Passport.</p>
              <div className="kg-field">
                <label htmlFor="kg-hub-lang">Language</label>
                <select id="kg-hub-lang" value={gameLang} onChange={(event) => setGameLang(event.target.value)}>
                  {GAME_LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              </div>
              <div className="kg-games">
                {GAMES.map((item) => (
                  <button type="button" key={item.id} onClick={() => setGame(item.id)}>
                    <i aria-hidden="true">{item.art}</i>
                    <b>{item.name}</b>
                    <span>{item.what}</span>
                    <small>{item.teaches}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          {game === 'karz' && <LoanGame {...shared} card={card} auto={auto} startLevel={level} initialLang={gameLang} />}
          {game === 'term' && <TermScene {...shared} card={card?.life ? card : household} />}
          {game === 'scam' && <ScamShield {...shared} />}
          {game === 'claim' && <ClaimDetective {...shared} />}
        </Suspense>
      </div>
    </div>
  );
}
