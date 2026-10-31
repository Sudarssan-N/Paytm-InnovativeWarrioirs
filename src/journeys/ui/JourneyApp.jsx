import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LANGUAGE_LABELS, STAGES, STAGE_LABELS } from '../orchestrator.js';
import { AGENTS } from '../tools.js';
import { SAMPLE_MESSAGES } from '../sampleData.js';
import { ResultCard } from './cards.jsx';
import TrustPanel from './TrustPanel.jsx';
import { postRomanise, useJourney } from './useJourney.js';
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
    { label: 'Insurance', prompts: ['मुझे कितना बीमा चाहिए?', 'How much insurance do I need?', 'My wife and two kids', '₹10 lakh', '₹3 lakh from my employer', 'Explain the plans in simple words'] },
    { label: 'Claim', prompts: ['My claim was cut, why?', 'Draft the grievance', 'How do I file a claim?'] },
    { label: 'Scam', prompts: [SAMPLE_MESSAGES.loanScam, SAMPLE_MESSAGES.collect, 'Someone is on the phone telling me to share the OTP right now, I am scared'] },
  ],
  lakshmi: [
    { label: 'Working capital', prompts: ['என் கடைக்கு சரக்கு வாங்க பணம் வேண்டும்', 'I need money for stock for my shop', 'Yes, go ahead', 'Yes, send it to the lender'] },
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

function Phone({ journey, customerId, onStart, avatar, onAvatar, faces, phoneReady }) {
  const { status, state, messages, secs, level, voiceOn, chips, send, micPress, toggleVoice, end } = journey;
  const [typed, setTyped] = useState('');
  const [captions, setCaptions] = useState(true);
  const [roman, setRoman] = useState(false);
  const scroller = useRef(null);
  const merchant = customerId === 'lakshmi';
  const inCall = !['idle', 'ended'].includes(status);
  const speaking = status === 'speaking', listening = status === 'listening';

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [messages.length, status]);

  const langLine = useMemo(() => {
    const spoken = [...messages].reverse().find((item) => item.from === 'customer' && item.lang);
    if (!spoken) return 'Language: just talk, there is no menu';
    const label = LANGUAGE_LABELS[spoken.lang] || spoken.lang;
    return spoken.confidence != null ? `${label}, detected automatically (${Number(spoken.confidence).toFixed(2)})` : `${label}, detected automatically`;
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
          <Logo />
          {status === 'ended'
            ? <><p className="j-phone-big">Call ended</p><p>The record of this call is sealed.</p></>
            : <><p className="j-phone-big">{merchant ? 'On your Soundbox' : 'Speak. Understand. Trust.'}</p><p>{merchant ? `${state?.customer?.name || 'Lakshmi Stores'}: ask out loud, while you serve customers.` : 'Insurance, loans and payments, explained on a call in your own language.'}</p></>}
          {phoneReady && !merchant && <CallBack onRing={journey.watchPhone} />}
          <button type="button" className="j-call-btn" onClick={onStart} autoFocus>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z" /></svg>
            {status === 'ended' ? 'Call again' : merchant ? 'Talk to MITRA' : 'Call MITRA'}
          </button>
          <p className="j-phone-note">Synthetic customer and offers. MITRA explains, it never signs or pays.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`j-phone ${merchant ? 'is-soundbox' : ''}`} aria-label="Live call with MITRA">
      <header className="j-phone-head">
        <h2>MITRA</h2>
        <p>{merchant ? 'AI Soundbox' : status === 'watching' ? 'Phone line' : 'Live call'} {clock(secs)}</p>
        <span className="j-pill">You’re talking to an AI assistant</span>
      </header>

      <div className="j-stage">
        {merchant ? <Suspense fallback={null}><SoundboxSim journey={journey} /></Suspense> : avatar === 'orb' ? <Wave active={speaking || listening} level={level} /> : (
          <Suspense fallback={<Wave active={speaking || listening} level={level} />}>
            <TalkingHeadAvatar size={168} speaking={speaking} mood={status === 'thinking' ? 'thinking' : 'happy'} gesture={listening ? 'listen' : speaking ? 'explain' : 'idle'} />
          </Suspense>
        )}
        {faces && !merchant && (
          <div className="j-avatar-switch" role="radiogroup" aria-label="Avatar">
            {[['orb', 'Voice'], ['2d', '2D'], ['3d', '3D']].map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={avatar === id} className={avatar === id ? 'is-active' : ''} onClick={() => onAvatar(id)}>{label}</button>)}
          </div>
        )}
      </div>

      <p className="j-lang"><i aria-hidden="true" />{langLine}</p>

      <div className="j-transcript" ref={scroller} aria-live="polite">
        {messages.map((message) => (
          <article key={message.id} className={`j-bubble is-${message.from}`}>
            <p lang={message.lang || undefined}>{message.followUp && <b>Update from the expert: </b>}{message.native}</p>
            {roman && message.from === 'mitra' && message.lang && message.lang !== 'en' && <RomanLine text={message.native} lang={message.lang} />}
            {captions && message.english && message.english !== message.native && <p className="j-gloss">{message.english}</p>}
            {message.rejected > 0 && <p className="j-rejected">{message.rejected} {message.rejected === 1 ? 'sentence' : 'sentences'} kept in English: a figure changed in translation.</p>}
          </article>
        ))}
        {status === 'thinking' && <p className="j-working" role="status">{STATUS_LINE.thinking}</p>}
      </div>

      <p className="j-status" role="status">{STATUS_LINE[status]}</p>

      {chips.length > 0 && (
        <div className="j-chips">
          {chips.map((chip) => <button type="button" key={chip} disabled={status === 'thinking'} onClick={() => send(chip, { tapped: true })}>{chip}</button>)}
        </div>
      )}

      <form className="j-type" onSubmit={submit}>
        <input aria-label="Type in any language" placeholder="Or type in any language" value={typed} onChange={(event) => setTyped(event.target.value)} />
      </form>

      <footer className="j-controls">
        <button type="button" className={listening ? 'is-on' : ''} aria-label={listening ? 'Finish speaking' : 'Speak'} disabled={status === 'thinking' || status === 'transcribing'} onClick={micPress}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        </button>
        <button type="button" className={captions ? 'is-on' : ''} aria-label={captions ? 'Hide English captions' : 'Show English captions'} aria-pressed={captions} onClick={() => setCaptions((value) => !value)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 12h4M13 12h4M7 16h8" /></svg>
        </button>
        <button type="button" className={roman ? 'is-on' : ''} aria-label={roman ? 'Hide Roman letters' : 'Show in Roman letters'} aria-pressed={roman} onClick={() => setRoman((value) => !value)}>Aa</button>
        <button type="button" className={voiceOn ? 'is-on' : ''} aria-label={voiceOn ? 'Mute MITRA' : 'Unmute MITRA'} aria-pressed={voiceOn} onClick={toggleVoice}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" />{voiceOn ? <path d="M17 9a4 4 0 0 1 0 6" /> : <path d="M17 9l4 6M21 9l-4 6" />}</svg>
        </button>
        <button type="button" className="j-hangup" aria-label="End call" onClick={end}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 9c-1.6 0-3.1.3-4.5.7v3c0 .4-.2.7-.6.9-1 .5-1.8 1.1-2.6 1.8-.2.2-.4.3-.7.3s-.5-.1-.7-.3L.3 13.3a1 1 0 0 1 0-1.4C3.3 9.100 7.400 7.500 12 7.500s8.700 1.600 11.700 4.400a1 1 0 0 1 0 1.400l-2.500 2.500c-.2.2-.4.3-.7.3s-.5-.1-.7-.3c-.8-.7-1.600-1.300-2.600-1.800a1 1 0 0 1-.6-.9v-3C15.100 9.300 13.600 9 12 9z" /></svg>
        </button>
      </footer>
    </section>
  );
}

function JourneyMap({ state, reminders }) {
  const reached = state?.stagesReached || [];
  const current = state?.stage;
  return (
    <nav className="j-map" aria-label="Journey stages">
      {STAGES.map((stage, index) => (
        <div key={stage} className={`j-map-step ${reached.includes(stage) ? 'is-reached' : ''} ${current === stage ? 'is-current' : ''}`} aria-current={current === stage ? 'step' : undefined}>
          <span>{index + 1}</span>{STAGE_LABELS[stage]}
        </div>
      ))}
      {state?.metrics?.turns > 0 && (
        <div className="j-map-metrics" aria-label="This call so far">
          {state.metrics.questionsAsked} {state.metrics.questionsAsked === 1 ? 'question' : 'questions'} asked · {state.metrics.reused} reused · 0 forms
        </div>
      )}
      {reminders > 0 && <div className="j-map-reminder">{reminders} {reminders === 1 ? 'reminder' : 'reminders'} tracked</div>}
    </nav>
  );
}

export default function JourneyApp() {
  const [customerId, setCustomerId] = useState(params.get('customer') === 'lakshmi' ? 'lakshmi' : 'ramesh');
  const [modelOff, setModelOff] = useState(false);
  const [chaos, setChaos] = useState(false);
  const [handsFree, setHandsFree] = useState(params.get('handsfree') !== '0');
  const [voiceNote, setVoiceNote] = useState('');
  const [tab, setTab] = useState('trace');
  const [cardIndex, setCardIndex] = useState(null);
  const [avatar, setAvatar] = useState(() => params.get('avatar') || 'orb');
  const [scene, setScene] = useState(0);
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
  const begin = () => { setVoiceNote(''); setTab('trace'); setScene(0); start({ customerId, channel: customerId === 'lakshmi' ? 'soundbox' : 'call' }); };
  const switchCustomer = (id) => { if (id !== customerId) { journey.end(); setCustomerId(id); setScene(0); } };

  const sceneList = SCENES[customerId];
  const agentLabel = shown?.agent ? AGENTS[shown.agent]?.label : null;

  return (
    <div className="j-app">
      <header className="j-top">
        <div className="j-top-left">
          <Logo />
          <span className="j-divider" aria-hidden="true" />
          <span className="j-track">AI-Powered Financial Journeys</span>
          <span className="j-proto">Hackathon prototype, synthetic data</span>
        </div>
        <div className="j-top-right">
          <button type="button" className="j-top-play" onClick={() => openGame(true)}>🛺 Learn by playing</button>
          <div className="j-segment" role="radiogroup" aria-label="Who is calling">
            <button type="button" role="radio" aria-checked={customerId === 'ramesh'} className={customerId === 'ramesh' ? 'is-active' : ''} onClick={() => switchCustomer('ramesh')}>Ramesh K.</button>
            <button type="button" role="radio" aria-checked={customerId === 'lakshmi'} className={customerId === 'lakshmi' ? 'is-active' : ''} onClick={() => switchCustomer('lakshmi')}>Lakshmi Stores</button>
          </div>
          <label className="j-toggle"><input type="checkbox" checked={handsFree} onChange={(event) => setHandsFree(event.target.checked)} /><span>Hands-free</span></label>
          <label className={`j-toggle ${modelOff ? 'is-warn' : ''}`}><input type="checkbox" checked={modelOff} onChange={(event) => setModelOff(event.target.checked)} /><span>Model outage</span></label>
          <label className={`j-toggle ${chaos ? 'is-warn' : ''}`}><input type="checkbox" checked={chaos} onChange={(event) => setChaos(event.target.checked)} /><span>Corrupt next translation</span></label>
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
          <Phone journey={journey} customerId={customerId} onStart={begin} avatar={avatar} onAvatar={setAvatar} faces={faces} phoneReady={phoneReady} />
        </div>

        <section className="j-col-card" aria-label="What MITRA is showing">
          {shown ? (
            <>
              <div className="j-card-head">
                {agentLabel && <span className="j-agent-tag">{agentLabel}</span>}
                {cards.length > 1 && (
                  <div className="j-card-nav" aria-label="Earlier answers">
                    <button type="button" aria-label="Previous answer" disabled={(cardIndex ?? cards.length - 1) === 0} onClick={() => setCardIndex((value) => (value ?? cards.length - 1) - 1)}>‹</button>
                    <span>{(cardIndex ?? cards.length - 1) + 1} of {cards.length}</span>
                    <button type="button" aria-label="Next answer" disabled={(cardIndex ?? cards.length - 1) >= cards.length - 1} onClick={() => setCardIndex((value) => (value ?? cards.length - 1) + 1)}>›</button>
                  </div>
                )}
              </div>
              <ResultCard card={shown} onAsk={(prompt) => send(prompt)} onPlay={openGame} onDocument={journey.confirmDocument} />
            </>
          ) : (
            <div className="j-welcome">
              <h1>One AI agent for every financial journey.</h1>
              <p>Start the call and ask in your own language. MITRA answers aloud in eleven Indian languages, and on screen in more. The model listens, translates and picks a tool. It never produces a figure.</p>
              <ul>
                <li><b>Real numbers</b>, computed by deterministic engines</li>
                <li><b>Asked once</b>, reused across agents under consent</li>
                <li><b>A signed receipt</b> for every explanation</li>
                <li><b>A person</b> whenever it matters, with the whole story</li>
              </ul>
            </div>
          )}
          {inCall && customerId === 'ramesh' && (
            <div className="j-doc-bar">
              <label className="j-doc-upload">📄 Read my loan papers<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) journey.readDocument(file); }} /></label>
              <button type="button" disabled={status === 'thinking'} onClick={async () => { const res = await fetch('/samples/sample-kfs.pdf'); const blob = await res.blob(); journey.readDocument(new File([blob], 'sample-kfs.pdf', { type: 'application/pdf' })); }}>Use a sample KFS</button>
              <label className="j-doc-upload">📷 Check a payment QR<input type="file" accept="image/*" onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; const link = await readQr(file); if (link) send(link); else setVoiceNote('I could not read a QR code in that picture. You can paste the UPI link in the box instead.'); }} /></label>
              <label className="j-doc-upload">🎙 Check what the agent promised<input type="file" accept="audio/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) journey.checkCall(file); }} /></label>
              <button type="button" disabled={status === 'thinking'} onClick={async () => { const res = await fetch('/samples/sample-agent-call.mp3'); const blob = await res.blob(); journey.checkCall(new File([blob], 'sample-agent-call.mp3', { type: 'audio/mpeg' })); }}>Use a sample sales call</button>
            </div>
          )}
          {inCall && (
            <div className="j-scenes">
              <div className="j-scene-tabs" role="tablist" aria-label="Sample lines the caller could say">
                <span>The caller could say</span>
                {sceneList.map((item, index) => <button key={item.label} type="button" role="tab" aria-selected={index === scene} className={index === scene ? 'is-active' : ''} onClick={() => setScene(index)}>{item.label}</button>)}
              </div>
              <div className="j-scene-lines">
                {(sceneList[scene] || sceneList[0]).prompts.map((prompt) => <button type="button" key={prompt} disabled={status === 'thinking'} onClick={() => send(prompt)}>{prompt}</button>)}
              </div>
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
