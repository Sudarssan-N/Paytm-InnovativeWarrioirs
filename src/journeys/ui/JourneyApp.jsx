import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LANGUAGE_LABELS, STAGES, STAGE_LABELS } from '../orchestrator.js';
import { AGENTS } from '../tools.js';
import { SAMPLE_MESSAGES } from '../sampleData.js';
import { ResultCard } from './cards.jsx';
import TrustPanel from './TrustPanel.jsx';
import { postRomanise, useJourney } from './useJourney.js';
import { sampleFiles } from './auth.js';
import { setAiStatus } from '../../engine/aiTransport.js';
import { loadAiStatus } from '../../engine/api.js';
import './journeys.css';

const TalkingHeadAvatar = lazy(() => import('../../components/TalkingHeadAvatar.jsx'));
const Arcade = lazy(() => import('./Arcade.jsx'));
const SoundboxSim = lazy(() => import('./SoundboxSim.jsx'));

const params = new URLSearchParams(window.location.search);

const clock = (secs) => `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

const STATUS_LINE = {
  idle: '', ended: 'Call ended', opening: 'Connecting…', watching: 'Live on the phone line. This screen follows the call.', preparing: 'Preparing voice…', speaking: 'MITRA is speaking', listening: 'Listening to you',
  transcribing: 'Understanding your words…', thinking: 'Working it out…', 'your-turn': 'Your turn. Speak, tap or type.',
};

const SCENES = {
  ramesh: [
    { label: 'Loan', prompts: ['இந்த லோனுக்கு உண்மையான செலவு எவ்வளவு?', 'What does this loan really cost?', 'என் மாத வருமானம் 45,000 ரூபாய்', 'முன்கூட்டியே கடனை அடைத்தால் அபராதம் உண்டா?'] },
    { label: 'Loan Clarity', prompts: ['I deliver food and have no salary slip. How much can I borrow?', 'मेरी कमाई हर महीने बदलती है, क्या मैं यह लोन ले सकता हूँ?', 'Can I afford this loan?', 'What if I take it for 36 months?', 'என் EMI-ஐ குறைக்க முடியுமா?', 'What if I borrow 1.5 lakh for 24 months?'] },
    { label: 'Insurance', prompts: ['मुझे कितना बीमा चाहिए?', 'How much insurance do I need?', 'My wife and two kids', '₹10 lakh', '₹3 lakh from my employer', 'Explain the plans in simple words'] },
    { label: 'Claim', prompts: ['My claim was cut, why?', 'Draft the grievance', 'How do I file a claim?'] },
    { label: 'Scam', prompts: [SAMPLE_MESSAGES.loanScam, SAMPLE_MESSAGES.collect, 'Someone is on the phone telling me to share the OTP right now, I am scared'] },
  ],
  lakshmi: [
    { label: 'Working capital', prompts: ['என் கடைக்கு சரக்கு வாங்க பணம் வேண்டும்', 'I need money for stock for my shop', 'Yes, go ahead', 'Yes, send it to the lender'] },
    { label: 'Loan Clarity', prompts: ['How much can I safely borrow?', 'What if I take it for 36 months?', 'What does this loan really cost?'] },
    { label: 'Scam', prompts: [SAMPLE_MESSAGES.collect] },
  ],
};


// The browser's own QR reader. Nothing leaves the device until the link is read.
async function readQr(file) {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const codes = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(bitmap);
    return codes[0]?.rawValue || null;
  } catch { return null; }
}

function Logo() {
  return <span className="j-logo"><span className="j-logo-mark" aria-hidden="true" />MITRA</span>;
}

// For people who speak a language but read its script slowly.
function RomanLine({ text, lang }) {
  const [roman, setRoman] = useState('');
  useEffect(() => {
    let live = true;
    postRomanise(text.slice(0, 1000), lang).then((out) => { if (live) setRoman(out.roman); }).catch(() => {});
    return () => { live = false; };
  }, [text, lang]);
  return roman ? <p className="j-roman">{roman}</p> : null;
}

function Wave({ active, level }) {
  const bars = [0.45, 0.75, 1, 0.65, 0.9, 0.55, 0.8];
  return (
    <div className={`j-orb ${active ? 'is-active' : ''}`} aria-hidden="true">
      <div className="j-wave">
        {bars.map((value, index) => <i key={index} style={{ height: `${10 + value * (active ? 22 + level * 26 : 8)}px`, animationDelay: `${index * 90}ms` }} />)}
      </div>
    </div>
  );
}

// Shown only when the server has a telephony account. MITRA rings a real phone.
function CallBack({ onRing }) {
  const [to, setTo] = useState('+91');
  const [note, setNote] = useState('');
  const ring = async (event) => {
    event.preventDefault();
    setNote('Ringing…');
    try {
      const res = await fetch('/api/phone/call-back', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.title);
      onRing();
    } catch (error) { setNote(error.message); }
  };
  return (
    <form className="j-callback" onSubmit={ring}>
      <label htmlFor="j-callback-number">Ring a real phone</label>
      <div><input id="j-callback-number" inputMode="tel" value={to} onChange={(event) => setTo(event.target.value)} /><button type="submit">Call</button></div>
      {note && <p role="status">{note}</p>}
    </form>
  );
}


const Icon = {
  phone: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" /></svg>,
  play: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>,
  sliders: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>,
  plus: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>,
  close: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  mic: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>,
  send: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  income: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M8 13h8M8 17h5" /></svg>,
  kfs: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6zM9 12h6M9 16h6M9 8h3" /></svg>,
  qr: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2" /></svg>,
  call: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h2l2-6 3 12 3-9 2 5 2-2h4" /></svg>,
  loan: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z" /></svg>,
  shield: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" /></svg>,
  cover: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-7-4.5-7-11a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 6.5-7 11-7 11z" /></svg>,
  claim: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4h6M8 4H5v17h14V4h-3M8 11h8M8 15h5" /></svg>,
  shop: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6" /></svg>,
};


// Where to begin, before a word is said. Each starts the call with that question.
const JOURNEYS = {
  ramesh: [
    { icon: Icon.loan, title: 'Loan Clarity', blurb: 'What you can safely borrow, from your own papers', prompt: 'Can I afford this loan?' },
    { icon: Icon.kfs, title: 'The real cost of a loan', blurb: 'APR, fees and charges, before you sign', prompt: 'What does this loan really cost?' },
    { icon: Icon.cover, title: 'Buy the right cover', blurb: 'How much insurance you need, in plain words', prompt: 'How much insurance do I need?' },
    { icon: Icon.claim, title: 'A claim that was cut', blurb: 'Every deduction checked against the policy', prompt: 'My claim was cut, why?' },
    { icon: Icon.shield, title: 'Catch a scam before the PIN', blurb: 'Offer X-Ray on any message or QR', prompt: SAMPLE_MESSAGES.loanScam },
  ],
  lakshmi: [
    { icon: Icon.shop, title: 'Money for stock', blurb: 'Working capital from Soundbox sales, no form', prompt: 'I need money for stock for my shop' },
    { icon: Icon.loan, title: 'Loan Clarity', blurb: 'What the shop can safely borrow', prompt: 'How much can I safely borrow?' },
    { icon: Icon.shield, title: 'Catch a scam before the PIN', blurb: 'Offer X-Ray on a collect request', prompt: SAMPLE_MESSAGES.collect },
  ],
};

// Closes on a click outside or Escape, so a menu never traps the presenter.
function useDismiss(open, close) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (ref.current && !ref.current.contains(event.target)) close(); };
    const escape = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open, close]);
  return ref;
}

// The presenter's switches, out of the caller's way.
function DemoControls({ handsFree, setHandsFree, modelOff, setModelOff, chaos, setChaos }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const items = [
    ['Hands-free', 'Listen again after each answer', handsFree, setHandsFree, false],
    ['Model outage', 'Engines and receipts keep working', modelOff, setModelOff, true],
    ['Corrupt next translation', 'Watch the figures fence catch it', chaos, setChaos, true],
  ];
  return (
    <div className="j-pop" ref={ref}>
      <button type="button" className="j-btn-ghost" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {Icon.sliders}Demo controls{(modelOff || chaos) && <i className="j-alert-dot" aria-label="A fault is on" />}
      </button>
      {open && (
        <div className="j-pop-menu" role="group" aria-label="Demo controls">
          <p>For the presenter. Callers never see these.</p>
          {items.map(([label, hint, on, set, warn]) => (
            <button key={label} type="button" role="switch" aria-checked={on} className={`j-switch-row ${warn ? 'is-warn' : ''}`} onClick={() => set(!on)}>
              <span><b>{label}</b><small>{hint}</small></span>
              <i className="j-switch" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Who is signed in, and the way out.
function AccountMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const line = user.demo ? 'Demo account' : [user.workLabel?.split(':')[0], user.city].filter(Boolean).join(', ') || 'Signed in';
  return (
    <div className="j-pop" ref={ref}>
      <button type="button" className="j-account" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <i className={`is-${user.customerId === 'lakshmi' ? 'lakshmi' : 'ramesh'}`} aria-hidden="true">{initials}</i>
        <span><b>{user.name}</b><small>{line}</small></span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="j-pop-menu" role="group" aria-label="Your account">
          <div className="j-account-card">
            <b>{user.name}</b>
            {user.phone && <span>{user.phone}</span>}
            {user.workLabel && <span>{user.workLabel}{user.city ? `, ${user.city}` : ''}</span>}
            {user.income
              ? <p className="j-account-income">Income papers on file: <b>₹{user.income.counted.toLocaleString('en-IN')}</b> a month counted, under consent until {user.consent?.expiresOn}.</p>
              : !user.demo && <p className="j-account-income">No income papers yet. Share them on a call with the + button.</p>}
          </div>
          <button type="button" className="j-switch-row" onClick={onSignOut}><span><b>Sign out</b><small>{user.demo ? 'Back to the sign-in screen' : 'Your account and papers stay saved'}</small></span></button>
        </div>
      )}
    </div>
  );
}

// Everything the caller can hand to MITRA, in one sheet instead of a row of buttons.
function ShareSheet({ journey, customerId, sampleSet, onClose, onNote }) {
  const { status, send } = journey;
  const busy = status === 'thinking';
  const done = (action) => async (...args) => { onClose(); await action(...args); };
  const pick = (handler, multiple = false) => (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (files.length) done(handler)(multiple ? files : files[0]);
  };
  const sample = (path, type) => async () => new File([await (await fetch(`/samples/${path}`)).blob()], path, { type });
  const tiles = [
    { icon: Icon.income, title: 'Income papers', what: 'Bank statements, UPI receipts, ITR or GST', accept: 'application/pdf,image/jpeg,image/png', multiple: true, onFiles: journey.readIncome, onSample: async () => journey.readIncome(await sampleFiles(sampleSet)) },
    ...(customerId === 'ramesh' ? [
      { icon: Icon.kfs, title: 'Loan papers', what: 'A Key Fact Statement, read back to you', accept: 'application/pdf,image/jpeg,image/png', onFiles: journey.readDocument, onSample: async () => journey.readDocument(await sample('sample-kfs.pdf', 'application/pdf')()) },
      {
        icon: Icon.qr, title: 'Payment QR', what: 'Who really gets the money', accept: 'image/*',
        onFiles: async (file) => { const link = await readQr(file); if (link) send(link); else onNote('I could not read a QR code in that picture. You can paste the UPI link in the box instead.'); },
      },
      { icon: Icon.call, title: 'A sales call', what: 'What the agent promised, against the papers', accept: 'audio/*', onFiles: journey.checkCall, onSample: async () => journey.checkCall(await sample('sample-agent-call.mp3', 'audio/mpeg')()) },
    ] : []),
  ];
  return (
    <div className="j-sheet-scrim" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="j-sheet" role="dialog" aria-label="Share with MITRA">
        <header>
          <h3>Share with MITRA</h3>
          <button type="button" className="j-icon-btn" aria-label="Close" onClick={onClose}>{Icon.close}</button>
        </header>
        <div className="j-sheet-grid">
          {tiles.map((tile, index) => (
            <div key={tile.title} className="j-share-tile" style={{ animationDelay: `${60 + index * 50}ms` }}>
              <label className="j-share-main">
                <i>{tile.icon}</i>
                <b>{tile.title}</b>
                <span>{tile.what}</span>
                <input type="file" accept={tile.accept} multiple={tile.multiple} disabled={busy} onChange={pick(tile.onFiles, tile.multiple)} />
              </label>
              {tile.onSample && <button type="button" className="j-link-btn" disabled={busy} onClick={done(tile.onSample)}>Use a sample</button>}
            </div>
          ))}
        </div>
        <p className="j-sheet-note">Files are read, then dropped. Only fingerprints and the figures you confirm go on your receipt.</p>
      </div>
    </div>
  );
}

function Phone({ journey, customerId, sampleSet, onStart, avatar, onAvatar, faces, phoneReady, onNote }) {
  const { status, state, messages, secs, level, voiceOn, chips, send, micPress, toggleVoice, end } = journey;
  const [typed, setTyped] = useState('');
  const [captions, setCaptions] = useState(true);
  const [roman, setRoman] = useState(false);
  const [sharing, setSharing] = useState(false);
  const scroller = useRef(null);
  const merchant = customerId === 'lakshmi';
  const inCall = !['idle', 'ended'].includes(status);
  const speaking = status === 'speaking', listening = status === 'listening';

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [messages.length, status]);
  useEffect(() => { if (!inCall) setSharing(false); }, [inCall]);

  const langLine = useMemo(() => {
    const spoken = [...messages].reverse().find((item) => item.from === 'customer' && item.lang);
    if (!spoken) return 'Just talk, there is no language menu';
    const label = LANGUAGE_LABELS[spoken.lang] || spoken.lang;
    return spoken.confidence != null ? `${label}, detected (${Number(spoken.confidence).toFixed(2)})` : `${label}, detected automatically`;
  }, [messages]);

  const submit = (event) => {
    event.preventDefault();
    if (!typed.trim()) return;
    send(typed);
    setTyped('');
  };

  if (!inCall) {
    return (
      <section className={`j-phone ${merchant ? 'is-soundbox' : ''}`} aria-label="Customer's phone">
        <div className="j-phone-start">
          <div className="j-orb-big" aria-hidden="true"><span /><span /><i /></div>
          {status === 'ended'
            ? <><p className="j-phone-big">Call ended</p><p>The record of this call is sealed and yours to keep.</p></>
            : <><p className="j-phone-big">{merchant ? 'Ask out loud, while you serve.' : 'Talk in your own language.'}</p><p>{merchant ? `${state?.customer?.name || 'Lakshmi Stores'}: MITRA lives on your Soundbox.` : 'MITRA is an AI assistant, not a person. It explains every rupee and never signs or pays for you.'}</p></>}
          <button type="button" className="j-call-btn" onClick={onStart} autoFocus>
            {Icon.phone}{status === 'ended' ? 'Call again' : merchant ? 'Talk to MITRA' : 'Start the call'}
          </button>
          {phoneReady && !merchant && <CallBack onRing={journey.watchPhone} />}
          <p className="j-phone-note">Or pick where to begin, on the right.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`j-phone ${merchant ? 'is-soundbox' : ''}`} aria-label="Live call with MITRA">
      <header className="j-phone-head">
        <div className={`j-orb-mini ${speaking || listening ? 'is-live' : ''}`} aria-hidden="true"><span /><span /><i /></div>
        <div className="j-phone-who">
          <h2>{state?.customer?.name || (merchant ? 'Lakshmi Stores' : 'Ramesh K.')}</h2>
          <p>{merchant ? 'AI Soundbox' : status === 'watching' ? 'Phone line' : 'Live call'} · <span className="j-tabular">{clock(secs)}</span> · AI assistant</p>
        </div>
        <div className="j-phone-tools">
          <button type="button" className={captions ? 'is-on' : ''} aria-label={captions ? 'Hide English captions' : 'Show English captions'} aria-pressed={captions} onClick={() => setCaptions((value) => !value)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 12h4M13 12h4M7 16h8" /></svg>
          </button>
          <button type="button" className={roman ? 'is-on' : ''} aria-label={roman ? 'Hide Roman letters' : 'Show in Roman letters'} aria-pressed={roman} onClick={() => setRoman((value) => !value)}>Aa</button>
          <button type="button" className={voiceOn ? 'is-on' : ''} aria-label={voiceOn ? 'Mute MITRA' : 'Unmute MITRA'} aria-pressed={voiceOn} onClick={toggleVoice}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" />{voiceOn ? <path d="M17 9a4 4 0 0 1 0 6" /> : <path d="M17 9l4 6M21 9l-4 6" />}</svg>
          </button>
          <button type="button" className="j-hangup" aria-label="End call" onClick={end}>{Icon.phone}</button>
        </div>
      </header>

      <div className="j-stage">
        {merchant ? <Suspense fallback={null}><SoundboxSim journey={journey} /></Suspense> : avatar === 'orb' ? <Wave active={speaking || listening} level={level} /> : (
          <Suspense fallback={<Wave active={speaking || listening} level={level} />}>
            <TalkingHeadAvatar size={150} speaking={speaking} mood={status === 'thinking' ? 'thinking' : 'happy'} gesture={listening ? 'listen' : speaking ? 'explain' : 'idle'} />
          </Suspense>
        )}
        {faces && !merchant && (
          <div className="j-avatar-switch" role="radiogroup" aria-label="Avatar">
            {[['orb', 'Voice'], ['2d', '2D'], ['3d', '3D']].map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={avatar === id} className={avatar === id ? 'is-active' : ''} onClick={() => onAvatar(id)}>{label}</button>)}
          </div>
        )}
        <p className="j-lang"><i aria-hidden="true" />{langLine}</p>
      </div>

      <div className="j-transcript" ref={scroller} aria-live="polite">
        {messages.map((message) => (
          <article key={message.id} className={`j-bubble is-${message.from}`}>
            <p lang={message.lang || undefined}>{message.followUp && <b>Update from the expert: </b>}{message.native}</p>
            {roman && message.from === 'mitra' && message.lang && message.lang !== 'en' && <RomanLine text={message.native} lang={message.lang} />}
            {captions && message.english && message.english !== message.native && <p className="j-gloss">{message.english}</p>}
            {message.rejected > 0 && <p className="j-rejected">{message.rejected} {message.rejected === 1 ? 'sentence' : 'sentences'} kept in English: a figure changed in translation.</p>}
          </article>
        ))}
        {status === 'thinking' && <p className="j-working" role="status"><i /><i /><i />{STATUS_LINE.thinking}</p>}
      </div>

      <p className={`j-status is-${status}`} role="status">{STATUS_LINE[status]}</p>

      {chips.length > 0 && (
        <div className="j-chips" aria-label="Quick replies">
          {chips.map((chip, index) => <button type="button" key={chip} style={{ animationDelay: `${index * 45}ms` }} disabled={status === 'thinking'} onClick={() => send(chip, { tapped: true })}>{chip}</button>)}
        </div>
      )}

      <form className="j-composer" onSubmit={submit}>
        <button type="button" className="j-composer-add" aria-label="Share papers, a QR or a call" aria-expanded={sharing} onClick={() => setSharing((value) => !value)}>{Icon.plus}</button>
        <input aria-label="Type in any language" placeholder="Type in any language" value={typed} onChange={(event) => setTyped(event.target.value)} />
        {typed.trim()
          ? <button type="submit" className="j-composer-mic" aria-label="Send">{Icon.send}</button>
          : <button type="button" className={`j-composer-mic ${listening ? 'is-on' : ''}`} aria-label={listening ? 'Finish speaking' : 'Speak'} disabled={status === 'thinking' || status === 'transcribing'} onClick={micPress}>{Icon.mic}</button>}
      </form>

      {sharing && <ShareSheet journey={journey} customerId={customerId} sampleSet={sampleSet} onClose={() => setSharing(false)} onNote={onNote} />}
    </section>
  );
}

function JourneyMap({ state, reminders }) {
  const reached = state?.stagesReached || [];
  const current = state?.stage;
  const at = Math.max(STAGES.indexOf(current), 0);
  return (
    <nav className="j-map" aria-label="Journey stages">
      <ol className="j-rail" style={{ '--fill': at / (STAGES.length - 1) }}>
        {STAGES.map((stage, index) => {
          const done = reached.includes(stage) && stage !== current;
          return (
            <li key={stage} className={`${done ? 'is-reached' : ''} ${current === stage ? 'is-current' : ''}`} aria-current={current === stage ? 'step' : undefined}>
              <span className="j-rail-dot">{done ? '✓' : index + 1}</span>
              <span className="j-rail-label">{STAGE_LABELS[stage]}</span>
            </li>
          );
        })}
      </ol>
      {(state?.metrics?.turns > 0 || reminders > 0) && (
        <div className="j-map-side">
          {state?.metrics?.turns > 0 && (
            <span className="j-map-metrics" aria-label="This call so far">
              {state.metrics.questionsAsked} {state.metrics.questionsAsked === 1 ? 'question' : 'questions'} asked · {state.metrics.reused} reused · 0 forms
            </span>
          )}
          {reminders > 0 && <span className="j-map-reminder">{reminders} {reminders === 1 ? 'reminder' : 'reminders'} tracked</span>}
        </div>
      )}
    </nav>
  );
}

const CARD_TITLES = {
  loan: 'Loan cost', gap: 'Cover gap', plans: 'Plans', window: 'Free-look', cooling: 'Cooling-off', checklist: 'Checklist', claim: 'Claim', grievance: 'Grievance',
  risk: 'Offer X-Ray', merchant: 'Working capital', lenderBrief: 'Lender brief', application: 'Application', handoff: 'Handoff', consents: 'Consents', ask: 'Question',
  note: 'Answer', prepay: 'Prepay', closed: 'Closed', menu: 'Menu', arcade: 'Game', promises: 'Promise Check', document: 'Loan papers',
  incomeRead: 'Income papers', affordability: 'Afford', simulator: 'Try terms',
};

export default function JourneyApp({ user, onSignOut }) {
  const customerId = user.customerId;
  // The demo's sample lines and journeys come in two flavours: a person, or a Soundbox shop.
  const persona = user.kind === 'merchant' ? 'lakshmi' : 'ramesh';
  const [modelOff, setModelOff] = useState(false);
  const [chaos, setChaos] = useState(false);
  const [handsFree, setHandsFree] = useState(params.get('handsfree') !== '0');
  const [voiceNote, setVoiceNote] = useState('');
  const [tab, setTab] = useState('trace');
  const [cardIndex, setCardIndex] = useState(null);
  const [avatar, setAvatar] = useState(() => params.get('avatar') || 'orb');
  const [scene, setScene] = useState(0);
  const [tryOpen, setTryOpen] = useState(false);
  const faces = params.get('faces') !== '0';
  const [phoneReady, setPhoneReady] = useState(false);
  const [arcade, setArcade] = useState(() => params.get('play') || null);
  const [arcadeCard, setArcadeCard] = useState(null);
  useEffect(() => { if (params.get('paytm')) setTab('paytm'); }, []);
  useEffect(() => {
    fetch('/api/phone/status').then((res) => res.json()).then((data) => setPhoneReady(Boolean(data.configured))).catch(() => {});
  }, []);

  const journey = useJourney({ modelOff, chaos, consumeChaos: useCallback(() => setChaos(false), []), handsFree, setVoiceNote });
  const { status, state, cards, trace, error, send, start, setState } = journey;

  const shown = cardIndex != null && cardIndex < cards.length ? cards[cardIndex] : cards.at(-1);
  const shownIndex = cardIndex ?? cards.length - 1;
  useEffect(() => { setCardIndex(null); }, [cards.length]);

  useEffect(() => {
    if (avatar === 'orb') return;
    window.localStorage?.setItem('mitra_avatar_mode', avatar);
    window.dispatchEvent(new CustomEvent('mitra-avatar-mode', { detail: avatar }));
  }, [avatar]);

  // A new handoff brings the expert's view forward. Any other new answer brings the
  // pipeline back into view, unless the presenter has opened something else.
  const handoffs = state?.handoffs?.length || 0;
  const lastHandoffs = useRef(0);
  useEffect(() => {
    if (handoffs > lastHandoffs.current) setTab('desk');
    else if (cards.length) setTab((current) => (current === 'desk' ? 'trace' : current));
    lastHandoffs.current = handoffs;
  }, [cards.length, handoffs]);

  // A simulated outage also takes the neural voice away: the device voice takes over.
  useEffect(() => {
    if (modelOff) setAiStatus({ llm: false, sarvam: false });
    else loadAiStatus();
  }, [modelOff]);

  // Asking for a game on the call opens it.
  const lastCardKey = useRef(null);
  useEffect(() => {
    const latest = cards.at(-1);
    if (!latest || latest.key === lastCardKey.current) return;
    lastCardKey.current = latest.key;
    if (latest.type === 'arcade') setTimeout(() => setArcade(latest.data.game), 1800);
  }, [cards]);
  const loanCard = useMemo(() => [...cards].reverse().find((item) => item.type === 'loan')?.data || null, [cards]);
  const openGame = useCallback((game, data = null) => { setArcadeCard(data); setArcade(game); }, []);

  const inCall = !['idle', 'ended'].includes(status);
  const begin = () => { setVoiceNote(''); setTab('trace'); setScene(0); return start({ customerId, channel: persona === 'lakshmi' ? 'soundbox' : 'call' }); };
  const beginWith = async (prompt) => { if (!inCall) await begin(); send(prompt); };
  const signOut = () => { journey.end(); onSignOut(); };

  const sceneList = SCENES[persona];
  const agentLabel = shown?.agent ? AGENTS[shown.agent]?.label : null;
  const recent = cards.map((card, index) => ({ card, index })).slice(-5);

  return (
    <div className="j-app">
      <header className="j-top">
        <div className="j-top-left">
          <Logo />
          <span className="j-proto">Prototype, synthetic data</span>
        </div>
        <div className="j-top-right">
          <DemoControls handsFree={handsFree} setHandsFree={setHandsFree} modelOff={modelOff} setModelOff={setModelOff} chaos={chaos} setChaos={setChaos} />
          <button type="button" className="j-btn-soft" onClick={() => openGame(true)}>{Icon.play}Learn by playing</button>
          {inCall
            ? <button type="button" className="j-btn-danger" onClick={journey.end}>{Icon.phone}End call</button>
            : <button type="button" className="j-btn-primary" onClick={begin}>{Icon.phone}{status === 'ended' ? 'Call again' : 'Start the call'}</button>}
          <AccountMenu user={user} onSignOut={signOut} />
        </div>
      </header>

      <JourneyMap state={state} reminders={state?.reminders?.length || 0} />

      {(error || voiceNote || modelOff) && (
        <div className={`j-notice ${error ? 'is-error' : ''}`} role="status">
          {error || (modelOff ? 'Model outage simulated: no speech, translation or routing model. Engines and receipts keep working, with guided options in English and Hindi.' : voiceNote)}
        </div>
      )}

      <main className="j-main">
        <div className="j-col-phone">
          <Phone journey={journey} customerId={persona} sampleSet={user.sample} onStart={begin} avatar={avatar} onAvatar={setAvatar} faces={faces} phoneReady={phoneReady} onNote={setVoiceNote} />
        </div>

        <section className="j-col-card" aria-label="What MITRA is showing">
          {shown ? (
            <>
              <div className="j-card-head">
                {agentLabel && <span className="j-agent-tag"><i aria-hidden="true" />{agentLabel}</span>}
                {cards.length > 1 && (
                  <div className="j-card-tabs" role="tablist" aria-label="Answers on this call">
                    {cards.length > recent.length && <span className="j-card-more">+{cards.length - recent.length}</span>}
                    {recent.map(({ card, index }) => (
                      <button key={card.key} type="button" role="tab" aria-selected={index === shownIndex} className={index === shownIndex ? 'is-active' : ''} onClick={() => setCardIndex(index === cards.length - 1 ? null : index)}>
                        {CARD_TITLES[card.type] || 'Answer'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <ResultCard card={shown} onAsk={(prompt, options) => send(prompt, options)} onPlay={openGame} onDocument={journey.confirmDocument} onIncome={journey.confirmIncome} />
            </>
          ) : (
            <div className="j-welcome">
              <p className="j-welcome-kicker">Namaste, {user.name.split(' ')[0]}</p>
              <h1>One AI agent for every financial journey.</h1>
              <p>Ask in your own language. MITRA answers aloud in eleven Indian languages. The model listens, translates and picks a tool. It never produces a figure.</p>
              {user.income && (
                <p className="j-welcome-papers"><b>Your papers are on file.</b> MITRA counts ₹{user.income.counted.toLocaleString('en-IN')} a month and a comfortable EMI of ₹{user.income.comfortableEmi.toLocaleString('en-IN')}. It will not ask again.</p>
              )}
              <div className="j-journeys">
                {JOURNEYS[persona].map((item, index) => (
                  <button key={item.title} type="button" style={{ animationDelay: `${80 + index * 60}ms` }} disabled={status === 'opening' || status === 'thinking'} onClick={() => beginWith(item.prompt)}>
                    <i>{item.icon}</i>
                    <span><b>{item.title}</b><small>{item.blurb}</small></span>
                  </button>
                ))}
              </div>
              <ul className="j-promises-row">
                <li><b>Real numbers</b> from deterministic engines</li>
                <li><b>Asked once</b>, reused under consent</li>
                <li><b>A signed receipt</b> for every answer</li>
                <li><b>A person</b> whenever it matters</li>
              </ul>
            </div>
          )}
          {inCall && (
            <div className={`j-scenes ${tryOpen ? 'is-open' : ''}`}>
              <button type="button" className="j-scenes-toggle" aria-expanded={tryOpen} onClick={() => setTryOpen((value) => !value)}>
                <span>Try saying</span>
                <small>Sample lines a caller could say, in several languages</small>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
              </button>
              {tryOpen && (
                <div className="j-scenes-body">
                  <div className="j-scene-tabs" role="tablist" aria-label="Topics">
                    {sceneList.map((item, index) => <button key={item.label} type="button" role="tab" aria-selected={index === scene} className={index === scene ? 'is-active' : ''} onClick={() => setScene(index)}>{item.label}</button>)}
                  </div>
                  <div className="j-scene-lines" key={scene}>
                    {(sceneList[scene] || sceneList[0]).prompts.map((prompt, index) => <button type="button" key={prompt} style={{ animationDelay: `${index * 35}ms` }} disabled={status === 'thinking'} onClick={() => send(prompt)}>{prompt}</button>)}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <div className="j-col-trust">
          <TrustPanel trace={trace} state={state} onSend={send} onResolved={setState} onErased={(out) => { journey.end(); setState(null); setTab('trace'); setVoiceNote(`Erased. ${out.receipts} receipts and everything said on this call were removed.`); }} tab={tab} onTab={setTab} />
        </div>
      </main>

      {arcade && (
        <Suspense fallback={null}>
          <Arcade
            open={arcade === 'true' ? true : arcade}
            card={arcadeCard || loanCard}
            sessionId={state?.sessionId}
            lang={params.get('lang') || state?.lang || 'en'}
            auto={params.get('auto') === '1'}
            level={params.get('level')}
            onClose={() => setArcade(null)}
            onSealed={(out) => { if (out.state?.sessionId === state?.sessionId) setState(out.state); }}
            onAsk={(prompt) => { if (inCall) send(prompt); }}
          />
        </Suspense>
      )}
    </div>
  );
}
