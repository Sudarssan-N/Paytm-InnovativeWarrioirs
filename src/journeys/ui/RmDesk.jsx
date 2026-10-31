// The relationship manager's desk: every case MITRA handed over, across customers.
// Same brief the customer's side panel shows, so the RM never asks them to repeat it.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { HandoffBrief } from './cards.jsx';
import './journeys.css';
import './rm-desk.css';

const POLL_MS = 4000;
const TOKEN_KEY = 'mitra-desk-token';
const NAME_KEY = 'mitra-rm-name';
const CALL_POLL_MS = 5000;

// Call-back targets in minutes. MITRA's defaults, not a regulator's.
const REASONS = {
  distress: { label: 'Scam or distress', tone: 'red', rank: 0, target: 15 },
  hardship: { label: 'Cannot pay', tone: 'amber', rank: 1, target: 60 },
  dispute: { label: 'Complaint', tone: 'amber', rank: 2, target: 120 },
  irreversible: { label: 'Hard to undo', tone: 'amber', rank: 3, target: 120 },
  asked: { label: 'Asked for the RM', tone: 'blue', rank: 4, target: 240 },
  not_in_kfs: { label: 'Not in the papers', tone: 'blue', rank: 5, target: 240 },
  not_sure: { label: 'MITRA unsure', tone: 'blue', rank: 6, target: 240 },
};
const reasonOf = (brief) => REASONS[brief.reason] || { label: brief.reason || 'Other', tone: 'blue', rank: 9, target: 240 };

const OUTCOMES = [
  ['resolved', 'Resolved on the call', 'You answered it. MITRA tells the customer.', '✓'],
  ['routed', 'Routed to the partner', 'The lender or insurer takes it from here.', '→'],
  ['grievance', 'Grievance raised', 'Filed with the evidence. Ombudsman next if it stalls.', '!'],
  ['walked', 'Customer walked away', 'Closed as they asked. Nothing executed.', '×'],
];
const keyOf = (brief) => `${brief.sessionId}/${brief.id}`;
const outcomeLabel = (id) => OUTCOMES.find(([key]) => key === id)?.[1] || id;
const QUICK_NOTES = ['Called back and explained.', 'Customer is safe. No money moved.', 'Sent to the lender with the brief.', 'Will call again tomorrow.'];

const store = {
  get: (key) => { try { return localStorage.getItem(key) || sessionStorage.getItem(key) || ''; } catch { return ''; } },
  set: (key, value, session = false) => { try { (session ? sessionStorage : localStorage).setItem(key, value); } catch { /* kept for this page only */ } },
};

async function desk(path, { token, body } = {}) {
  const res = await fetch(`/api/journey/desk${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { 'x-desk-token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.title || `Request failed (${res.status})`), { status: res.status });
  return data;
}

function span(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
const minutesSince = (iso, now) => (now - Date.parse(iso)) / 60000;
const sameDay = (iso, now) => iso && new Date(iso).toDateString() === new Date(now).toDateString();
const initials = (name = '') => name.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || '?';
const clock = (at) => new Date(at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

function sla(brief, now) {
  const { target } = reasonOf(brief);
  const used = minutesSince(brief.createdAt, now);
  const share = used / target;
  if (share >= 1) return { state: 'late', share: 1, text: `Overdue by ${span(used - target)}` };
  return { state: share >= 0.75 ? 'soon' : 'ok', share, text: `Call back within ${span(target - used)}` };
}

function Avatar({ name, size = 'md', tone }) {
  return <span className={`rm-avatar is-${size}${tone ? ` is-${tone}` : ''}`} aria-hidden="true">{initials(name)}</span>;
}

function ReasonChip({ brief }) {
  const reason = reasonOf(brief);
  return <span className={`rm-chip is-${reason.tone}`}><i aria-hidden="true">{reason.tone === 'blue' ? '•' : '!'}</i>{reason.label}</span>;
}

function SlaBar({ brief, now }) {
  const due = sla(brief, now);
  return (
    <span className={`rm-sla is-${due.state}`}>
      <span className="rm-sla-track" aria-hidden="true"><i style={{ width: `${Math.max(4, due.share * 100)}%` }} /></span>
      <span className="rm-sla-text">{due.state === 'late' && <b aria-hidden="true">!</b>}{due.text}</span>
    </span>
  );
}

// ── the top of the page ──
function Hero({ rm, open, all, now, onName }) {
  const hour = new Date(now).getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const urgent = open.filter((brief) => brief.reason === 'distress').length;
  const late = open.filter((brief) => sla(brief, now).state === 'late').length;
  const oldest = open.reduce((max, brief) => Math.max(max, minutesSince(brief.createdAt, now)), 0);
  const closedToday = all.filter((brief) => brief.status === 'closed' && sameDay(brief.closedAt, now));
  const handled = closedToday.filter((brief) => brief.closedAt).map((brief) => (Date.parse(brief.closedAt) - Date.parse(brief.createdAt)) / 60000);
  const byReason = Object.entries(REASONS).map(([id, item]) => ({ id, label: item.label, tone: item.tone, count: open.filter((brief) => brief.reason === id).length })).filter((row) => row.count);
  const most = Math.max(1, ...byReason.map((row) => row.count));
  const [draft, setDraft] = useState('');

  return (
    <section className="rm-hero">
      <div className="rm-hero-intro">
        <p className="rm-hero-date">{new Date(now).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        {rm ? (
          <h1>{hello}, {rm.split(' ')[0]}.</h1>
        ) : (
          <form className="rm-hero-name" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) onName(draft.trim()); }}>
            <h1>{hello}.</h1>
            <label><span>Who is on the desk?</span><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Your name" maxLength={60} /></label>
            <button type="submit">Start</button>
          </form>
        )}
        <p className="rm-hero-line">
          {open.length === 0 ? 'Nobody is waiting. MITRA is handling every conversation.'
            : <>{open.length} {open.length === 1 ? 'customer is' : 'customers are'} waiting for a person.{urgent > 0 && <b> {urgent} need{urgent === 1 ? 's' : ''} a call right now.</b>}</>}
        </p>
      </div>

      <div className="rm-kpis">
        <div className="rm-kpi"><span>Waiting</span><strong>{open.length}</strong><small>{open.length ? `longest ${span(oldest)}` : 'queue is clear'}</small></div>
        <div className={`rm-kpi${urgent ? ' is-alert' : ''}`}><span>Call now</span><strong>{urgent}</strong><small>scam or distress</small></div>
        <div className={`rm-kpi${late ? ' is-alert' : ''}`}><span>Overdue</span><strong>{late}</strong><small>past the call-back target</small></div>
        <div className="rm-kpi"><span>Closed today</span><strong>{closedToday.length}</strong><small>{handled.length ? `typically in ${span(handled.sort((a, b) => a - b)[Math.floor(handled.length / 2)])}` : 'none yet'}</small></div>
      </div>

      <div className="rm-reasons" aria-label="Waiting, by reason">
        <p>Why they are waiting</p>
        {byReason.length ? (
          <ul>
            {byReason.map((row) => (
              <li key={row.id}>
                <span>{row.label}</span>
                <span className="rm-reasons-track" aria-hidden="true"><i className={`is-${row.tone}`} style={{ width: `${(row.count / most) * 100}%` }} /></span>
                <b>{row.count}</b>
              </li>
            ))}
          </ul>
        ) : <small>Nothing waiting.</small>}
      </div>
    </section>
  );
}

// ── the queue ──
function QueueItem({ brief, now, active, onPick, rm }) {
  const open = brief.status !== 'closed';
  const reason = reasonOf(brief);
  const name = brief.customerName || brief.customer;
  return (
    <li>
      <button type="button" className={`rm-case is-${open ? reason.tone : 'done'}${active ? ' is-active' : ''}`} onClick={() => onPick(keyOf(brief))} aria-current={active || undefined}>
        <Avatar name={name} tone={open ? reason.tone : 'done'} />
        <span className="rm-case-body">
          <span className="rm-case-top">
            <b>{name}</b>
            <span className="rm-case-wait">{open ? `${span(minutesSince(brief.createdAt, now))} ago` : clock(brief.closedAt || brief.createdAt)}</span>
          </span>
          <span className="rm-case-asked">“{brief.asked?.english}”</span>
          <span className="rm-case-meta">
            {open ? <ReasonChip brief={brief} /> : <span className="rm-chip is-green"><i aria-hidden="true">✓</i>{outcomeLabel(brief.outcome)}</span>}
            <span>{brief.language}</span>
            {brief.owner && open && <span className={`rm-owner${brief.owner.name === rm ? ' is-me' : ''}`}>{brief.owner.name === rm ? 'Yours' : brief.owner.name}</span>}
          </span>
          {open && <SlaBar brief={brief} now={now} />}
        </span>
      </button>
    </li>
  );
}

// ── one case ──
function Conversation({ messages }) {
  if (!messages?.length) return <p className="j-empty rm-pad">No conversation was kept for this case.</p>;
  return (
    <ol className="rm-convo">
      {messages.map((message, index) => {
        const translated = message.native && message.english && message.native !== message.english;
        return (
          <li key={index} className={message.from === 'customer' ? 'is-customer' : 'is-mitra'}>
            <span className="rm-convo-who">{message.from === 'customer' ? 'Customer' : 'MITRA'} · {clock(message.at)}</span>
            <p lang={message.lang || undefined}>{translated && message.from === 'customer' ? message.native : message.english || message.native}</p>
            {translated && message.from === 'customer' && <small>In English: {message.english}</small>}
          </li>
        );
      })}
    </ol>
  );
}

// ── MITRA's Sarvam voice agent calls the customer ──
const CALL_LANGS = { en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', od: 'Odia' };
const CALL_PROBLEMS = { no_answer: 'The customer did not answer', busy: 'The line was busy', failed: 'The call could not be placed', lost: 'Sarvam did not report on this call' };
const callDone = (call) => call.status !== 'calling' && (call.status !== 'connected' || call.transcript?.length > 0 || Date.now() - (call.endedAt || 0) > 180_000);
function callStep(call) {
  if (call.status === 'calling') return 1;
  if (call.status === 'connected') return call.transcript?.length ? 3 : 2;
  return -1;
}
const callSummary = (call) => (call.status === 'connected'
  ? `Talked ${span((call.duration || 0) / 60)}${call.outcome ? ` · ${call.outcome.replace(/_/g, ' ')}` : ''}`
  : call.status === 'calling' ? 'Calling now' : call.problem || CALL_PROBLEMS[call.status] || 'Ended');

function CallPanel({ brief, token, rm, calling, onChanged, onAuth, onClose }) {
  const context = brief.context || {};
  const onFile = context.phoneOnFile;
  const [number, setNumber] = useState('');
  const [lang, setLang] = useState(context.lang || 'en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const latest = brief.calls?.at(-1);
  const live = latest && !callDone(latest) ? latest : null;

  // While a call is under way, ask the server to check with Sarvam.
  useEffect(() => {
    if (!live) return undefined;
    const timer = setInterval(async () => {
      try { await desk(`/${brief.id}/call/${live.id}?session=${encodeURIComponent(brief.sessionId)}`, { token }); onChanged(); }
      catch (err) { if (err.status === 401) onAuth(); }
    }, CALL_POLL_MS);
    return () => clearInterval(timer);
  }, [live?.id, brief.id, brief.sessionId, token, onChanged, onAuth]);

  const ring = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try { await desk(`/${brief.id}/call`, { token, body: { rm, customerPhone: number, lang, sessionId: brief.sessionId } }); onChanged(); }
    catch (err) { if (err.status === 401) onAuth(); setError(err.message); }
    finally { setBusy(false); }
  };

  const step = live ? callStep(live) : 0;
  const steps = ['Asking Sarvam to call', 'MITRA agent is on the call', 'Writing up the call', 'Done'];
  return (
    <section className="rm-panel rm-call" aria-label="Call the customer through MITRA's voice agent">
      <div className="rm-call-head">
        <h3><span className="rm-call-icon" aria-hidden="true">✆</span>Call {brief.customerName || 'the customer'} through MITRA’s voice agent</h3>
        <button type="button" className="rm-x" onClick={onClose} aria-label="Close">×</button>
      </div>
      {!calling.ready ? (
        <p className="j-callout is-amber"><b>The Sarvam voice agent is not switched on.</b> Missing from <code>.env</code>: {calling.missing.map((name) => <code key={name}>{name} </code>)}. The customer page’s call needs the same settings. See docs/VOICE_AGENT.md.</p>
      ) : live ? (
        <div className="rm-call-live">
          <ol className="rm-steps">
            {steps.map((label, index) => <li key={label} className={index < step ? 'is-done' : index === step ? 'is-now' : ''}><i aria-hidden="true">{index < step ? '✓' : index + 1}</i>{label}</li>)}
          </ol>
          <p className="rm-muted">Calling {live.to} in {CALL_LANGS[live.lang] || live.lang}. The result and transcript land on this case. Checked every few seconds.</p>
        </div>
      ) : (
        <form className="rm-call-form" onSubmit={ring}>
          {onFile ? (
            <div className="rm-call-onfile"><span>Customer’s number</span><b>{onFile}</b><small>From their MITRA account.</small></div>
          ) : (
            <label><span>Customer’s mobile</span><input type="tel" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="10-digit mobile" required /><small>No number on file for this customer.</small></label>
          )}
          <label><span>Language of the call</span>
            <select value={lang} onChange={(event) => setLang(event.target.value)}>{Object.entries(CALL_LANGS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select>
          </label>
          <button type="submit" className="rm-call-btn" disabled={busy}><span aria-hidden="true">✆</span>{busy ? 'Placing…' : 'Call now'}</button>
          <p className="rm-muted rm-call-how">
            MITRA’s Sarvam voice agent rings the customer, says it is an AI, and the outcome and transcript come back here.
            {!calling.ownAgent && ' It is the onboarding agent for now, so it asks the onboarding questions. Set SARVAM_RM_APP_ID and SARVAM_RM_APP_VERSION to use a follow-up agent made for RMs.'}
          </p>
        </form>
      )}
      {latest && callDone(latest) && latest.status !== 'connected' && <p className="j-callout is-amber"><b>{callSummary(latest)}.</b> You can try again.</p>}
      {error && <p className="rm-error" role="alert">{error}</p>}
    </section>
  );
}

function CallLog({ calls }) {
  if (!calls?.length) return null;
  return (
    <section className="rm-panel rm-calllog">
      <h3>Calls on this case</h3>
      <ul>{[...calls].reverse().map((call) => (
        <li key={call.id}>
          <div className="rm-calllog-row">
            <span className={`rm-dot is-${call.status === 'connected' ? 'ok' : call.status === 'calling' ? 'live' : 'warn'}`} aria-hidden="true" />
            <b>{call.by}</b><span>{clock(call.at)}</span><span>{call.to} · {CALL_LANGS[call.lang] || call.lang}</span><span>{callSummary(call)}</span>
          </div>
          {call.transcript?.length > 0 && (
            <details className="rm-transcript">
              <summary>Transcript ({call.transcript.length} lines)</summary>
              <ol>{call.transcript.map((turn, index) => <li key={index} className={`is-${turn.who}`}><b>{turn.who === 'customer' ? 'Customer' : 'MITRA agent'}</b>{turn.text}</li>)}</ol>
            </details>
          )}
        </li>
      ))}</ul>
    </section>
  );
}

function CaseDetail({ brief, now, token, rm, calling, onChanged, onAuth, onNeedName }) {
  const [tab, setTab] = useState('brief');
  const [notes, setNotes] = useState('');
  const [outcome, setOutcome] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [phoning, setPhoning] = useState(false);
  useEffect(() => { setNotes(''); setOutcome(''); setError(''); setTab('brief'); setPhoning(false); }, [brief.id, brief.sessionId]);

  const call = async (path, body) => {
    setBusy(true); setError('');
    try { await desk(path, { token, body }); onChanged(); }
    catch (err) { if (err.status === 401) onAuth(); setError(err.message); }
    finally { setBusy(false); }
  };
  const take = () => (rm ? call(`/${brief.id}/take`, { rm, sessionId: brief.sessionId }) : onNeedName());

  const open = brief.status !== 'closed';
  const reason = reasonOf(brief);
  const name = brief.customerName || brief.customer;
  const context = brief.context || {};
  const messages = context.conversation || [];
  const mine = brief.owner?.name === rm;

  return (
    <article className="rm-detail">
      <header className={`rm-detail-head is-${open ? reason.tone : 'done'}`}>
        <Avatar name={name} size="lg" tone={open ? reason.tone : 'done'} />
        <div className="rm-detail-who">
          <h2>{name}</h2>
          <p>
            <span>{context.kind === 'merchant' ? 'Merchant' : 'Customer'}</span>
            <span>Speaks {brief.language}</span>
            <span>{brief.journey}</span>
            {context.earlierCases > 0 && <span>{context.earlierCases} earlier {context.earlierCases === 1 ? 'case' : 'cases'}</span>}
          </p>
        </div>
        <div className="rm-detail-act">
          {open ? (
            <>
              {brief.owner ? <span className={`rm-owner is-big${mine ? ' is-me' : ''}`}>{mine ? 'You have this case' : `With ${brief.owner.name}`}</span> : null}
              <button type="button" className="rm-call-btn" onClick={() => (rm ? setPhoning(true) : onNeedName())} aria-expanded={phoning}><span aria-hidden="true">✆</span>Call customer</button>
              {!mine && <button type="button" className="rm-primary" disabled={busy} onClick={take}>{brief.owner ? 'Take over' : 'Take this case'}</button>}
            </>
          ) : <span className="rm-chip is-green is-big"><i aria-hidden="true">✓</i>Closed</span>}
        </div>
      </header>

      {open && (
        <div className="rm-detail-status">
          <ReasonChip brief={brief} />
          <SlaBar brief={brief} now={now} />
          <span className="rm-muted">Handed over {clock(brief.createdAt)} · {brief.id}</span>
        </div>
      )}

      {open && phoning && <CallPanel brief={brief} token={token} rm={rm} calling={calling} onChanged={onChanged} onAuth={onAuth} onClose={() => setPhoning(false)} />}
      {open && reason.tone === 'red' && <section className="j-callout is-red"><b>Call this customer now.</b><p>MITRA saw signs of a scam or distress. Stay on the line until they are safe. Never ask for an OTP, PIN or payment.</p></section>}

      <div className="j-segment rm-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'brief'} className={tab === 'brief' ? 'is-active' : ''} onClick={() => setTab('brief')}>Brief</button>
        <button type="button" role="tab" aria-selected={tab === 'convo'} className={tab === 'convo' ? 'is-active' : ''} onClick={() => setTab('convo')}>Conversation{messages.length ? ` (${messages.length})` : ''}</button>
      </div>
      {tab === 'brief' ? <HandoffBrief brief={brief} /> : <section className="rm-panel"><Conversation messages={messages} /></section>}
      <CallLog calls={brief.calls} />

      {open ? (
        <section className="rm-panel rm-close">
          <h3>Close the case</h3>
          <div className="rm-outcomes" role="radiogroup" aria-label="Outcome">
            {OUTCOMES.map(([id, label, note, icon]) => (
              <button key={id} type="button" role="radio" aria-checked={outcome === id} className={`rm-outcome${outcome === id ? ' is-picked' : ''}`} onClick={() => setOutcome(id)}>
                <i aria-hidden="true">{icon}</i><b>{label}</b><small>{note}</small>
              </button>
            ))}
          </div>
          <label className="rm-notes">
            <span>Notes, sealed on the customer’s record and read back to them in {brief.language}</span>
            <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What you found out, and what happens next" maxLength={1000} />
          </label>
          <div className="rm-quick">
            {QUICK_NOTES.map((text) => <button key={text} type="button" onClick={() => setNotes((current) => (current ? `${current} ${text}` : text))}>+ {text}</button>)}
          </div>
          <div className="rm-close-foot">
            {error && <p className="rm-error" role="alert">{error}</p>}
            <button type="button" className="rm-primary" disabled={busy || !outcome} onClick={() => call(`/${brief.id}/resolve`, { outcome, notes, rm, sessionId: brief.sessionId })}>Close and tell the customer</button>
          </div>
        </section>
      ) : (
        <section className="j-callout is-green rm-closed">
          <b>{outcomeLabel(brief.outcome)}{brief.closedBy ? `, by ${brief.closedBy}` : ''}.</b>
          <p>{brief.closedAt ? `Closed ${clock(brief.closedAt)}, ${span((Date.parse(brief.closedAt) - Date.parse(brief.createdAt)) / 60000)} after the handover. ` : ''}Sealed on the customer’s Journey Passport and sent to them in {brief.language}.</p>
        </section>
      )}
    </article>
  );
}

function TokenGate({ onToken, failed }) {
  const [value, setValue] = useState('');
  return (
    <form className="rm-gate rm-panel" onSubmit={(event) => { event.preventDefault(); if (value.trim()) onToken(value.trim()); }}>
      <span className="j-logo-mark" aria-hidden="true" />
      <h2>Staff sign-in</h2>
      <p className="rm-muted">This server keeps the RM desk behind a staff token (<code>MITRA_DESK_TOKEN</code>).</p>
      <label><span>Desk token</span><input type="password" value={value} onChange={(event) => setValue(event.target.value)} autoFocus autoComplete="off" /></label>
      {failed && <p className="rm-error" role="alert">That token was not accepted.</p>}
      <button type="submit" className="rm-primary">Open the desk</button>
    </form>
  );
}

export default function RmDesk() {
  const [briefs, setBriefs] = useState(null);
  const [calling, setCalling] = useState({ ready: false, missing: [], ownAgent: false });
  const [token, setToken] = useState(() => store.get(TOKEN_KEY));
  const [rm, setRm] = useState(() => store.get(NAME_KEY));
  const [needsToken, setNeedsToken] = useState(false);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [view, setView] = useState('open');
  const [reason, setReason] = useState('all');
  const [lang, setLang] = useState('all');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await desk('', { token });
      setBriefs(data.briefs); setCalling(data.calling || { ready: false, missing: [], ownAgent: false }); setNeedsToken(false); setError(''); setUpdated(Date.now()); setNow(Date.now());
    } catch (err) {
      if (err.status === 401) setNeedsToken(true);
      else setError('Cannot reach the server. Retrying.');
    }
  }, [token]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  useEffect(() => { document.title = 'MITRA · RM desk'; }, []);

  const all = briefs || [];
  const open = all.filter((brief) => brief.status !== 'closed');
  const languages = useMemo(() => [...new Set(all.map((brief) => brief.language).filter(Boolean))].sort(), [all]);
  const counts = { open: open.length, mine: open.filter((brief) => brief.owner?.name === rm).length };

  const shown = useMemo(() => {
    const words = search.trim().toLowerCase();
    return all
      .filter((brief) => view === 'all' || (view === 'closed' ? brief.status === 'closed' : brief.status !== 'closed'))
      .filter((brief) => view !== 'mine' || brief.owner?.name === rm)
      .filter((brief) => reason === 'all' || brief.reason === reason)
      .filter((brief) => lang === 'all' || brief.language === lang)
      .filter((brief) => !words || [brief.customer, brief.customerName, brief.id, brief.journey, brief.asked?.english, brief.asked?.original].some((text) => text?.toLowerCase().includes(words)))
      // Open cases: most urgent reason first, then whoever has waited longest.
      .sort((a, b) => (view === 'open' || view === 'mine'
        ? (reasonOf(a).rank - reasonOf(b).rank) || (Date.parse(a.createdAt) - Date.parse(b.createdAt))
        : Date.parse(b.closedAt || b.createdAt) - Date.parse(a.closedAt || a.createdAt)));
  }, [all, view, reason, lang, search, rm]);

  const current = all.find((brief) => keyOf(brief) === picked) || shown[0] || null;
  const signIn = (value) => { store.set(TOKEN_KEY, value, true); setToken(value); };
  const name = (value) => { store.set(NAME_KEY, value); setRm(value); };

  return (
    <div className="j-app rm">
      <header className="j-top">
        <div className="j-top-left">
          <span className="j-logo"><span className="j-logo-mark" aria-hidden="true" />MITRA</span>
          <span className="j-divider" />
          <span className="rm-title">RM desk</span>
        </div>
        <div className="j-top-right">
          <span className={`rm-live${error ? ' is-off' : ''}`} role="status"><i aria-hidden="true" />{error || (updated ? `Live · ${new Date(updated).toLocaleTimeString('en-IN', { timeStyle: 'medium' })}` : 'Connecting')}</span>
          {rm && <button type="button" className="rm-me" onClick={() => name('')} title="Change who is on the desk"><Avatar name={rm} size="sm" />{rm}</button>}
          <a className="j-btn is-quiet" href="/">Customer app</a>
        </div>
      </header>

      {needsToken ? <main className="rm-scroll"><TokenGate onToken={signIn} failed={Boolean(token)} /></main> : (
        <main className="rm-scroll">
          <Hero rm={rm} open={open} all={all} now={now} onName={name} />

          <div className="rm-body">
            <section className="rm-queue" aria-label="Cases">
              <div className="rm-queue-head">
                <div className="j-segment" role="tablist">
                  {[['open', 'Waiting', counts.open], ['mine', 'Mine', counts.mine], ['closed', 'Closed'], ['all', 'All']].map(([id, label, count]) => (
                    <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'is-active' : ''} onClick={() => { setView(id); setPicked(null); }}>
                      {label}{count > 0 && <i className="rm-count">{count}</i>}
                    </button>
                  ))}
                </div>
                <input className="rm-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, case or question" aria-label="Search cases" />
                <div className="rm-selects">
                  <select value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Reason">
                    <option value="all">Any reason</option>
                    {Object.entries(REASONS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
                  </select>
                  <select value={lang} onChange={(event) => setLang(event.target.value)} aria-label="Language">
                    <option value="all">Any language</option>
                    {languages.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </div>
              </div>
              {briefs === null ? <p className="j-empty rm-pad">Loading cases…</p>
                : shown.length ? <ul>{shown.map((brief) => <QueueItem key={keyOf(brief)} brief={brief} now={now} rm={rm} active={current && keyOf(current) === keyOf(brief)} onPick={setPicked} />)}</ul>
                : <div className="rm-none"><span aria-hidden="true">✓</span><p>{all.length ? 'No cases match.' : 'No cases yet.'}</p><small>{all.length ? 'Try another filter.' : 'When a customer says “hand over to my RM”, the case lands here with the whole story.'}</small></div>}
            </section>
            <section className="rm-pane" aria-label="Case">
              {current ? <CaseDetail brief={current} now={now} token={token} rm={rm} calling={calling} onChanged={load} onAuth={() => setNeedsToken(true)} onNeedName={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); document.querySelector('.rm-hero-name input')?.focus(); }} />
                : <div className="rm-none rm-panel"><span aria-hidden="true">☰</span><p>Pick a case</p><small>The brief, the conversation and the close-out are here.</small></div>}
            </section>
          </div>
          <p className="rm-foot">Call-back targets are MITRA’s defaults: 15 minutes for a scam or distress, an hour when someone cannot pay, two hours for a complaint or a hard-to-undo step, four hours otherwise.</p>
        </main>
      )}
    </div>
  );
}
