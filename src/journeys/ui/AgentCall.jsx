// The onboarding call on screen: the login number, arranging the call, following it,
// and checking what the agent heard. Nothing it heard counts until "Use these details".
import React, { useCallback, useEffect, useState } from 'react';
import { inr } from '../money.js';
import { authApi } from './auth.js';

const LANGUAGES = [['en', 'English'], ['hi', 'हिन्दी'], ['ta', 'தமிழ்'], ['te', 'తెలుగు'], ['kn', 'ಕನ್ನಡ'], ['ml', 'മലയാളം'], ['mr', 'मराठी'], ['bn', 'বাংলা'], ['gu', 'ગુજરાતી'], ['pa', 'ਪੰਜਾਬੀ'], ['od', 'ଓଡ଼ିଆ']];
const WORK = [['gig', 'Gig work'], ['shop', 'A shop or business'], ['salaried', 'A salaried job'], ['other', 'Something else']];
const ACTIVE = new Set(['scheduled', 'placing', 'calling']);
const MISSED = {
  no_answer: 'You did not pick up, so nothing was saved.',
  busy: 'Your line was busy, so nothing was saved.',
  failed: 'The call did not go through.',
  lost: 'We did not hear back about this call.',
  cancelled: 'That call was cancelled.',
};

const doubtLine = (call, field) => {
  const doubt = call.details?.doubts?.find((item) => item.field === field);
  if (!doubt) return null;
  const said = field === 'dependants' ? doubt.said : inr(doubt.said);
  return <small className="ac-doubt">Heard on the call: {said}. That looks unusual and may be misheard, so it is left for you to fill in.</small>;
};

const asInputTime = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const whenLabel = (ms) => new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const SOON = [[1, '1 min'], [2, '2 min'], [5, '5 min'], [15, '15 min']];

const leftLabel = (ms) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const pad = (value) => String(value).padStart(2, '0');
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} h ${pad(Math.floor(seconds / 60) % 60)} min`;
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
};

// The time left until the phone rings. Used here and in the app's notice bar.
export function CallCountdown({ at }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return at > now ? <b className="ac-count">{leftLabel(at - now)}</b> : <b className="ac-count">any moment</b>;
}

// While a new number is being typed, no call can be arranged: it would ring the saved one.
function PhoneRow({ user, onUser, editing, setEditing, locked }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const out = await authApi('/phone', { method: 'POST', body: { phone, pin } });
      onUser(out.user);
      setEditing(false);
      setSaved(true);
      setPhone('');
      setPin('');
    } catch (problem) { setError(problem.message); } finally { setBusy(false); }
  };
  if (!editing) {
    return (
      <div className="ac-phone">
        <div><span>MITRA will call</span><b data-testid="ac-number">{user.phoneFull || 'No number yet'}</b>{saved && <small>Saved. You sign in with this number now.</small>}</div>
        {!locked && <button type="button" className="a-link" onClick={() => { setEditing(true); setSaved(false); }}>Change number</button>}
      </div>
    );
  }
  return (
    <form className="ac-phone-edit" onSubmit={save}>
      <label className="a-field"><span>New mobile number</span>
        <span className="a-phone"><b>+91</b><input value={phone} onChange={(event) => setPhone(event.target.value.replace(/[^\d ]/g, '').slice(0, 12))} inputMode="tel" autoComplete="tel-national" placeholder="98765 43210" required /></span>
      </label>
      <label className="a-field"><span>Your 4-digit PIN</span>
        <input className="ac-pin" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" type="password" autoComplete="current-password" required />
      </label>
      <small className="a-fine">Save this first: MITRA calls the saved number. It also becomes the number you sign in with.</small>
      {error && <p className="ac-error" role="alert">{error}</p>}
      <div className="a-actions"><button type="button" className="a-link" onClick={() => { setEditing(false); setError(''); }}>Cancel</button><button type="submit" className="a-btn" disabled={busy || pin.length !== 4}>Save number</button></div>
    </form>
  );
}

function Arrange({ user, onPlaced, again }) {
  const [lang, setLang] = useState(user.lang || 'en');
  const [choice, setChoice] = useState('now');
  const [when, setWhen] = useState(() => asInputTime(Date.now() + 3600000));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const place = async () => {
    setBusy(true);
    setError('');
    try {
      const at = choice === 'now' ? 'now' : new Date(choice === 'pick' ? when : Date.now() + choice * 60000).toISOString();
      const out = await authApi('/call', { method: 'POST', body: { consent, lang, when: at } });
      onPlaced(out.call);
    } catch (problem) { setError(problem.message); } finally { setBusy(false); }
  };
  return (
    <div className="ac-arrange">
      <div className="ac-row">
        <label className="a-field"><span>Language</span>
          <select value={lang} onChange={(event) => setLang(event.target.value)}>{LANGUAGES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        </label>
        <fieldset className="ac-when"><legend>When</legend>
          {[['now', 'Now'], ...SOON, ['pick', 'Pick a time']].map(([id, label]) => <button key={id} type="button" aria-pressed={choice === id} className={choice === id ? 'is-on' : ''} onClick={() => setChoice(id)}>{label}</button>)}
        </fieldset>
      </div>
      {choice === 'pick' && <label className="a-field"><span>Pick a time</span><input type="datetime-local" value={when} min={asInputTime(Date.now() + 120000)} onChange={(event) => setWhen(event.target.value)} /></label>}
      <label className={`a-consent ${consent ? 'is-on' : ''}`}>
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <i aria-hidden="true">✓</i>
        <span>MITRA’s AI voice agent may call this number to ask how I earn, what I earn, who depends on me and what cover I have. The call is recorded and transcribed. I will check everything on screen before it is used.</span>
      </label>
      <small className="a-fine">It never asks for an OTP, PIN or card number. If anyone does, hang up.</small>
      {error && <p className="ac-error" role="alert">{error}</p>}
      <div className="a-actions is-center"><button type="button" className="a-btn is-big" disabled={!consent || busy || !user.phone} onClick={place}>{choice === 'now' ? `Call ${user.phoneFull} now` : typeof choice === 'number' ? `Call ${user.phoneFull} in ${choice} min` : `Arrange a call to ${user.phoneFull}`}</button></div>
    </div>
  );
}

function Following({ call, user, onCancelled }) {
  const cancel = async () => { const out = await authApi('/call/cancel', { method: 'POST' }); onCancelled(out.call); };
  if (call.reading) {
    return (
      <div className="ac-live" role="status">
        <i className="ac-ring" aria-hidden="true" />
        <p className="ac-live-title">The call has ended</p>
        <p>MITRA is writing up what you said. It will appear here for you to check.</p>
      </div>
    );
  }
  if (call.status === 'scheduled') {
    return (
      <div className="ac-live">
        <p className="ac-live-title">MITRA will call in</p>
        <CallCountdown at={call.scheduledFor} />
        <p>On {user.phoneFull}, at {whenLabel(call.scheduledFor)}. Keep your phone close. You can close this: what it hears will be here for you to check.</p>
        <button type="button" className="a-link" onClick={cancel}>Cancel the call</button>
      </div>
    );
  }
  return (
    <div className="ac-live" role="status">
      <i className="ac-ring" aria-hidden="true" />
      <p className="ac-live-title">{call.status === 'placing' ? 'Placing the call…' : `${call.to || 'Your phone'} should ring now`}</p>
      <p>Pick up and talk as you normally would. When the call ends, its details appear here. This can take about a minute.</p>
    </div>
  );
}

function Details({ call, user, onUser }) {
  const d = call.details || {};
  const [form, setForm] = useState({
    // What the app already knew was not asked again on the call, so it starts filled in.
    work: d.work || user.work || '', city: d.city || user.city || '', lang: d.lang || call.lang || 'en', income: d.income ?? '', dependants: d.dependants ?? '',
    existingLife: d.existingLife ?? '', existingHealth: d.existingHealth ?? '', goal: d.goal || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (name) => (event) => setForm((value) => ({ ...value, [name]: event.target.value }));
  const answer = async (accept) => {
    setBusy(true);
    setError('');
    try {
      const out = await authApi('/call/confirm', { method: 'POST', body: { accept, edits: accept ? form : undefined } });
      onUser(out.user);
    } catch (problem) { setError(problem.message); } finally { setBusy(false); }
  };
  // The name and language were sent to the agent, so they say nothing about what it heard.
  const heard = ['work', 'city', 'income', 'dependants', 'existingLife', 'existingHealth', 'goal'].some((name) => d[name] != null) || d.doubts?.length > 0;
  return (
    <div className="ac-details">
      <h3>What MITRA heard on the call</h3>
      <p className="a-sub">{heard ? 'Check each line and fix anything it got wrong. Nothing is used until you say so.' : 'The call ended before MITRA heard any details. You can fill these in, or skip.'}</p>
      {call.doubtful && <p className="ac-warn" role="status">Several answers on this call looked unusual. Please check every line, or discard all of it and start again.</p>}
      <div className="ac-form">
        <label className="a-field"><span>How you earn</span><select value={form.work} onChange={set('work')}><option value="">Not said</option>{WORK.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="a-field"><span>City</span><input value={form.city} onChange={set('city')} /></label>
        <label className="a-field"><span>Language</span><select value={form.lang} onChange={set('lang')}>{LANGUAGES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="a-field"><span>Monthly income (₹)</span><input value={form.income} onChange={set('income')} inputMode="numeric" />{doubtLine(call, 'income') || <small>{Number(form.income) > 0 ? inr(Number(form.income)) : ' '}</small>}</label>
        <label className="a-field"><span>People who depend on you</span><input value={form.dependants} onChange={set('dependants')} inputMode="numeric" />{doubtLine(call, 'dependants')}</label>
        <label className="a-field"><span>Life cover you have (₹)</span><input value={form.existingLife} onChange={set('existingLife')} inputMode="numeric" />{doubtLine(call, 'existingLife') || <small>{Number(form.existingLife) > 0 ? inr(Number(form.existingLife)) : ' '}</small>}</label>
        <label className="a-field"><span>Health cover you have (₹)</span><input value={form.existingHealth} onChange={set('existingHealth')} inputMode="numeric" />{doubtLine(call, 'existingHealth') || <small>{Number(form.existingHealth) > 0 ? inr(Number(form.existingHealth)) : ' '}</small>}</label>
        <label className="a-field ac-wide"><span>What you want help with</span><input value={form.goal} onChange={set('goal')} /></label>
      </div>
      {call.transcript.length > 0 && (
        <details className="ac-transcript"><summary>Read the call</summary>
          <ol>{call.transcript.map((turn, at) => <li key={at} className={turn.who === 'you' ? 'is-you' : ''}><b>{turn.who === 'you' ? 'You' : 'MITRA'}</b> {turn.text}</li>)}</ol>
        </details>
      )}
      {error && <p className="ac-error" role="alert">{error}</p>}
      <div className="a-actions"><button type="button" className="a-link" disabled={busy} onClick={() => answer(false)}>Discard all of it</button><button type="button" className="a-btn" disabled={busy} onClick={() => answer(true)}>Use these details</button></div>
    </div>
  );
}

export default function AgentCall({ user, onUser, onDone = null, doneLabel = 'Continue', skipLabel = null }) {
  const [ready, setReady] = useState(null);
  const [call, setCall] = useState(user.agentCall || null);
  const [editing, setEditing] = useState(false);

  const refresh = useCallback(async () => {
    const out = await authApi('/call');
    setReady(out.ready);
    setCall(out.call);
    return out;
  }, []);
  useEffect(() => { refresh().catch(() => setReady(false)); }, [refresh]);

  const active = call && (ACTIVE.has(call.status) || call.reading);
  // The rest of the app follows the call too, including after this screen has gone.
  const changed = (next) => { setCall(next); onUser({ ...user, agentCall: next }); };
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => { refresh().catch(() => {}); }, 3000);
    return () => clearInterval(timer);
  }, [active, refresh]);

  const waiting = call?.status === 'connected' && !call.decided && !call.reading;
  const finished = call?.decided === 'confirmed';
  const discarded = call?.decided === 'discarded';
  const missed = call && MISSED[call.status];

  return (
    <div className="ac">
      <PhoneRow user={user} onUser={onUser} editing={editing} setEditing={setEditing} locked={call?.status === 'placing' || call?.status === 'calling' || call?.reading} />
      {ready === false && (
        <p className="a-callout">Phone calls are not switched on for this server yet, so MITRA cannot ring you. You can set everything up on a call in the app instead.</p>
      )}
      {ready && active && <Following call={call} user={user} onCancelled={changed} />}
      {ready !== false && waiting && <Details call={call} user={user} onUser={(next) => { onUser(next); refresh(); }} />}
      {finished && <p className="ac-good" role="status">Done. MITRA will not ask for these again.</p>}
      {discarded && <p className="a-callout">Discarded. Nothing from that call is kept.</p>}
      {ready && missed && <p className="a-callout" role="status">{call.problem || MISSED[call.status]}</p>}
      {ready && !editing && !active && !waiting && (!finished || !onDone) && <Arrange user={user} onPlaced={changed} again={Boolean(call)} />}
      {(onDone || skipLabel) && !waiting && (
        <div className="a-actions is-center">
          {finished || discarded
            ? <button type="button" className="a-btn" onClick={onDone}>{doneLabel}</button>
            : skipLabel && <button type="button" className="a-link" onClick={onDone}>{active && call.status === 'scheduled' ? 'Continue for now' : skipLabel}</button>}
        </div>
      )}
    </div>
  );
}
