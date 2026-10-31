import React, { useEffect, useState } from 'react';
import { inr } from '../money.js';
import { speakLine, stopLine, translateLines } from './arcadeShared.js';

// The shopkeeper never looks up from the counter: a chime, a voice, one button.
// A simulation of the device, to show the journey. Paytm's firmware is not touched.
const PAYMENTS = [250, 40, 1200, 85, 560, 20, 340];

export default function SoundboxSim({ journey }) {
  const { status, state, micPress, send, messages } = journey;
  const [today, setToday] = useState(18450);
  const [screen, setScreen] = useState({ big: inr(18450), small: 'Today, on this Soundbox' });
  const [turn, setTurn] = useState(0);
  const [loud, setLoud] = useState(false);
  const lang = state?.lang || 'en';
  const listening = status === 'listening';
  const speaking = status === 'speaking';

  const last = [...messages].reverse().find((item) => item.from === 'mitra');
  useEffect(() => {
    if (last && !['idle', 'ended'].includes(status) && speaking) setScreen({ big: 'MITRA', small: String(last.native).slice(0, 58) });
  }, [last, speaking, status]);

  const pay = async () => {
    const amount = PAYMENTS[turn % PAYMENTS.length];
    setTurn((value) => value + 1);
    const next = today + amount;
    setToday(next);
    setScreen({ big: `+${inr(amount)}`, small: `Today: ${inr(next)}` });
    const line = (await translateLines(lang, { line: `${inr(amount)} received.` })).line;
    setLoud(true);
    speakLine(line, lang, { onEnd: () => setLoud(false) });
  };
  useEffect(() => () => stopLine(), []);

  return (
    <div className={`sb ${loud || speaking ? 'is-loud' : ''}`} aria-label="Soundbox simulator">
      <div className="sb-grille" aria-hidden="true" />
      <div className="sb-screen" role="status"><b>{screen.big}</b>{screen.small}</div>
      <button type="button" className={`sb-talk ${listening ? 'is-on' : ''}`} aria-label={listening ? 'Finish speaking' : 'Press and ask'} disabled={status === 'thinking' || status === 'transcribing'} onClick={micPress}>{listening ? 'Done' : 'Press & ask'}</button>
      <div className="sb-row">
        <button type="button" onClick={pay}>A customer pays</button>
        <button type="button" disabled={status === 'thinking'} onClick={() => send('How much did I collect?', { tapped: true })}>My sales</button>
      </div>
      <span className="sb-tag">Simulated device</span>
    </div>
  );
}
