// Before the call: sign in, try a demo account, or create an account and onboard.
// Onboarding asks once for what MITRA needs: how you work, your language, and, with
// consent for one purpose, your income papers, checked line by line.
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { inr } from '../money.js';
import { IncomeReadCard } from './LoanClarity.jsx';
import { authApi, getToken, readFiles, sampleFiles, setToken } from './auth.js';
import './journeys.css';
import './auth.css';

const JourneyApp = lazy(() => import('./JourneyApp.jsx'));
const params = new URLSearchParams(window.location.search);

const LANGS = [['en', 'English'], ['hi', 'हिन्दी'], ['ta', 'தமிழ்'], ['te', 'తెలుగు'], ['kn', 'ಕನ್ನಡ'], ['ml', 'മലയാളം'], ['mr', 'मराठी'], ['bn', 'বাংলা'], ['gu', 'ગુજરાતી'], ['pa', 'ਪੰਜਾਬੀ'], ['od', 'ଓଡ଼ିଆ']];
const LANG_NAME = { en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', od: 'Odia' };

const svg = (d, size = 20) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const ICON = {
  gig: svg('M5 17a2 2 0 1 0 0 .01M19 17a2 2 0 1 0 0 .01M7 17h8l2-5h-5l-2-4H7M14 8h3l2 4'),
  shop: svg('M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6'),
  salaried: svg('M4 8h16v11H4zM9 8V5h6v3M4 13h16'),
  other: svg('M12 3v18M3 12h18'),
  check: svg('M5 12l5 5 9-10', 16),
  doc: svg('M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5', 18),
  upload: svg('M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3', 26),
  close: svg('M6 6l12 12M18 6L6 18', 16),
  arrow: svg('M5 12h14M13 6l6 6-6 6', 18),
  shield: svg('M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4', 18),
  voice: svg('M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3', 18),
  receipt: svg('M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', 18),
  bank: svg('M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18', 22),
  search: svg('M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4', 18),
  lock: svg('M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3', 18),
};
const WORK_CHOICES = [
  ['gig', 'Gig work', 'Delivery, driving or freelance'],
  ['shop', 'A shop or business', 'Kirana, stall or small trade'],
  ['salaried', 'A salaried job', 'A fixed monthly salary'],
  ['other', 'Something else', 'Any other way you earn'],
];

const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

function Spinner() { return <i className="a-spin" aria-hidden="true" />; }

function Logo({ light }) {
  return <span className={`a-logo ${light ? 'is-light' : ''}`}><span className="a-logo-mark" aria-hidden="true" />MITRA</span>;
}

// Four boxes for a PIN: typing moves on, backspace moves back, a paste fills all four.
function PinInput({ value, onChange, label, autoFocus, length = 4, secret = true }) {
  const refs = useRef([]);
  const digits = value.padEnd(length, ' ').slice(0, length).split('');
  const set = (index, digit) => {
    const next = digits.map((item, at) => (at === index ? digit : item)).join('').replace(/\s+$/, '');
    onChange(next.replace(/\s/g, ''));
  };
  return (
    <fieldset className={`a-pin ${length > 4 ? 'is-long' : ''}`}>
      <legend>{label}</legend>
      <div>
        {digits.map((digit, index) => (
          <input
            key={index} ref={(el) => { refs.current[index] = el; }} type={secret ? 'password' : 'text'} inputMode="numeric" autoComplete="off" maxLength={1}
            aria-label={`${label}, digit ${index + 1}`} className={digit.trim() ? 'is-filled' : ''} value={digit.trim()} autoFocus={autoFocus && index === 0}
            onChange={(event) => {
              const typed = event.target.value.replace(/\D/g, '').slice(-1);
              if (!typed) return;
              set(index, typed);
              refs.current[index + 1]?.focus();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Backspace') {
                event.preventDefault();
                if (digit.trim()) set(index, ' ');
                else if (index > 0) { set(index - 1, ' '); refs.current[index - 1]?.focus(); }
              }
              if (event.key === 'ArrowLeft') refs.current[index - 1]?.focus();
              if (event.key === 'ArrowRight') refs.current[index + 1]?.focus();
            }}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
              if (!pasted) return;
              event.preventDefault();
              onChange(pasted);
              refs.current[Math.min(pasted.length, length - 1)]?.focus();
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="a-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function ErrorLine({ error }) {
  if (!error) return null;
  return <p className="a-error" role="alert" key={error.at}>{error.message}</p>;
}

// ── sign in ─────────────────────────────────────────────────────
function SignIn({ onSignedIn }) {
  const [mode, setMode] = useState('signin');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const fail = (message) => setError({ message, at: Date.now() });

  const run = async (key, call) => {
    setBusy(key);
    setError(null);
    try {
      const out = await call();
      setToken(out.token);
      onSignedIn(out.user, key === 'signup');
    } catch (problem) { fail(problem.message); } finally { setBusy(null); }
  };

  const submit = (event) => {
    event.preventDefault();
    if (mode === 'signin') return run('signin', () => authApi('/login', { method: 'POST', body: { phone, pin } }));
    if (pin !== pin2) return fail('The two PINs do not match');
    return run('signup', () => authApi('/signup', { method: 'POST', body: { name, phone, pin } }));
  };

  return (
    <div className="a-shell a-signin">
      <aside className="a-brand">
        <Logo light />
        <div className="a-brand-orb" aria-hidden="true"><span /><span /><span /><i /></div>
        <div className="a-brand-copy">
          <h1>Money, explained in your own language.</h1>
          <p>Loans, insurance and payments, on a call with an AI assistant that shows every rupee and never signs for you.</p>
          <ul>
            <li>{ICON.voice}<span>Talk in eleven Indian languages</span></li>
            <li>{ICON.receipt}<span>No salary slip? Your bank statement is enough</span></li>
            <li>{ICON.shield}<span>A signed receipt for every answer</span></li>
          </ul>
        </div>
        <p className="a-brand-foot">Hackathon prototype on synthetic data.</p>
      </aside>

      <main className="a-panel">
        <div className="a-card">
          <h2>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
          <p className="a-sub">{mode === 'signin' ? 'Sign in with your mobile number and PIN.' : 'It takes about two minutes, and you only do it once.'}</p>

          <div className="a-tabs" role="tablist" aria-label="Sign in or create an account">
            <span className="a-tabs-pill" style={{ transform: `translateX(${mode === 'signin' ? 0 : 100}%)` }} aria-hidden="true" />
            <button type="button" role="tab" aria-selected={mode === 'signin'} onClick={() => { setMode('signin'); setError(null); }}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => { setMode('signup'); setError(null); }}>Create account</button>
          </div>

          <form className="a-form" key={mode} onSubmit={submit}>
            {mode === 'signup' && (
              <Field label="Your name">
                <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="As you would like MITRA to call you" required />
              </Field>
            )}
            <Field label="Mobile number">
              <span className="a-phone"><b>+91</b><input value={phone} onChange={(event) => setPhone(event.target.value.replace(/[^\d ]/g, '').slice(0, 12))} inputMode="tel" autoComplete="tel-national" placeholder="98765 43210" required /></span>
            </Field>
            <PinInput label={mode === 'signin' ? 'PIN' : 'Choose a 4-digit PIN'} value={pin} onChange={setPin} />
            {mode === 'signup' && <PinInput label="Type the PIN again" value={pin2} onChange={setPin2} />}
            <ErrorLine error={error} />
            <button type="submit" className="a-btn" disabled={Boolean(busy)}>
              {busy === mode ? <Spinner /> : null}{mode === 'signin' ? 'Sign in' : 'Create account'}{!busy && ICON.arrow}
            </button>
            {mode === 'signup' && <p className="a-fine">A prototype: your PIN is stored hashed, and no SMS is sent.</p>}
          </form>

          <div className="a-or"><span>or try a demo account</span></div>
          <div className="a-demos">
            {[['ramesh', 'Ramesh K.', 'Delivery rider, Chennai', 'Has a personal loan offer'], ['lakshmi', 'Lakshmi Stores', 'Kirana shop, Madurai', 'Talks to MITRA on a Soundbox']].map(([id, label, kind, note], index) => (
              <button key={id} type="button" className="a-demo" style={{ animationDelay: `${200 + index * 80}ms` }} disabled={Boolean(busy)} onClick={() => run(id, () => authApi('/demo', { method: 'POST', body: { id } }))}>
                <i className={`is-${id}`}>{initials(label)}</i>
                <span><b>{label}</b><small>{kind}</small><small>{note}</small></span>
                {busy === id ? <Spinner /> : ICON.arrow}
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

// ── onboarding ──────────────────────────────────────────────────
const STEPS = ['Account', 'About you', 'Your papers', 'Ready'];

function useCountUp(target, ms = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!target) { setValue(0); return undefined; }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setValue(target); return undefined; }
    let frame;
    const started = performance.now();
    const tick = (now) => {
      const t = Math.min((now - started) / ms, 1);
      setValue(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

function AboutStep({ user, onNext }) {
  const [work, setWork] = useState(user.work || null);
  const [city, setCity] = useState(user.city || '');
  const [lang, setLang] = useState(user.lang || 'en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const next = async (event) => {
    event.preventDefault();
    setBusy(true);
    try { onNext((await authApi('/profile', { method: 'POST', body: { work, city, lang } })).user); } catch (problem) { setError({ message: problem.message, at: Date.now() }); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={next} className="a-step-body">
      <h2>Tell MITRA a little about you</h2>
      <p className="a-sub">So it asks for the right papers, and talks to you in your language.</p>
      <fieldset className="a-group">
        <legend>How do you earn?</legend>
        <div className="a-choices" role="radiogroup">
          {WORK_CHOICES.map(([id, title, blurb], index) => (
            <button key={id} type="button" role="radio" aria-checked={work === id} className={`a-choice ${work === id ? 'is-on' : ''}`} style={{ animationDelay: `${index * 60}ms` }} onClick={() => setWork(id)}>
              <i>{ICON[id]}</i><b>{title}</b><small>{blurb}</small><em aria-hidden="true">{ICON.check}</em>
            </button>
          ))}
        </div>
      </fieldset>
      <Field label="Your city"><input value={city} onChange={(event) => setCity(event.target.value)} autoComplete="address-level2" placeholder="For example, Chennai" /></Field>
      <fieldset className="a-group">
        <legend>Which language should MITRA speak?</legend>
        <div className="a-langs" role="radiogroup">
          {LANGS.map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={lang === id} className={lang === id ? 'is-on' : ''} onClick={() => setLang(id)} lang={id}>{label}</button>)}
        </div>
        <small className="a-fine">You can still speak any language on a call. MITRA follows you.</small>
      </fieldset>
      <ErrorLine error={error} />
      <div className="a-actions"><button type="submit" className="a-btn" disabled={!work || busy}>{busy && <Spinner />}Continue{!busy && ICON.arrow}</button></div>
    </form>
  );
}

// ── linking a bank, the Account Aggregator way ──────────────────
const LINK_STEPS = ['Bank', 'Consent', 'Verify', 'Accounts'];
const TILE_TONES = ['#002970', '#0079a8', '#0a5c8a', '#1d4fa3'];

const ONBOARDING_BANK_API = {
  banks: () => authApi('/bank/banks'),
  start: (body) => authApi('/bank/start', { method: 'POST', body }),
  verify: (body) => authApi('/bank/verify', { method: 'POST', body }),
  fetch: (body) => authApi('/bank/fetch', { method: 'POST', body }),
};

export function BankConnect({ user, onFetched, onBack, api = ONBOARDING_BANK_API, inCall = false }) {
  const [step, setStep] = useState('pick');
  const [banks, setBanks] = useState([]);
  const [query, setQuery] = useState('');
  const [bank, setBank] = useState(null);
  const [link, setLink] = useState(null);
  const [otp, setOtp] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [chosen, setChosen] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fail = (message) => setError({ message, at: Date.now() });

  useEffect(() => { api.banks().then((out) => setBanks(out.banks)).catch((problem) => fail(problem.message)); }, [api]);
  const shown = banks.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()));
  const at = { pick: 0, consent: 1, otp: 2, accounts: 3, fetching: 3 }[step];
  const call = async (fn) => { setBusy(true); setError(null); try { await fn(); } catch (problem) { fail(problem.message); } finally { setBusy(false); } };

  const approve = () => call(async () => {
    setLink(await api.start({ bankId: bank.id, consent: true }));
    setOtp('');
    setStep('otp');
  });
  const verify = () => call(async () => {
    const out = await api.verify({ handle: link.handle, otp });
    setAccounts(out.accounts);
    setChosen(out.accounts.filter((item) => item.primary).map((item) => item.ref));
    setStep('accounts');
  });
  const share = () => call(async () => {
    setStep('fetching');
    const [out] = await Promise.all([
      api.fetch({ handle: link.handle, accounts: chosen }),
      new Promise((resolve) => setTimeout(resolve, 1800)), // long enough to see where the data comes from
    ]).catch((problem) => { setStep('accounts'); throw problem; });
    onFetched(out);
  });

  const monogram = (item) => item.id.slice(0, 3).toUpperCase();
  return (
    <div className="a-step-body a-link-flow">
      <div className="a-link-head">
        <button type="button" className="a-icon-back" aria-label="Back" onClick={() => {
          if (step === 'pick') onBack(); else if (step === 'consent') setStep('pick'); else if (step === 'otp') setStep('consent'); else if (step === 'accounts') setStep('otp');
        }} disabled={step === 'fetching'}>{svg('M15 6l-6 6 6 6', 18)}</button>
        <ol className="a-link-steps" aria-label="Linking your bank">
          {LINK_STEPS.map((label, index) => <li key={label} className={index < at ? 'is-done' : index === at ? 'is-now' : ''}><i />{label}</li>)}
        </ol>
        <span className="a-sandbox">Sandbox</span>
      </div>

      <div className="a-link-body" key={step}>
        {step === 'pick' && (
          <>
            <h2>Link your bank account</h2>
            <p className="a-sub">Your statement comes straight from your bank through RBI’s Account Aggregator network. No uploads, no passwords shared with MITRA.</p>
            <label className="a-search">{ICON.search}<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your bank" aria-label="Search your bank" /></label>
            <div className="a-banks" role="radiogroup" aria-label="Your bank">
              {shown.map((item, index) => (
                <button key={item.id} type="button" role="radio" aria-checked={bank?.id === item.id} className={`a-bank ${bank?.id === item.id ? 'is-on' : ''}`} style={{ animationDelay: `${index * 25}ms` }} onClick={() => setBank(item)}>
                  <i style={{ background: TILE_TONES[index % TILE_TONES.length] }}>{monogram(item)}</i>
                  <span>{item.name}</span>
                </button>
              ))}
              {!shown.length && banks.length > 0 && <p className="a-fine">No bank matches “{query}”. You can upload a statement instead.</p>}
            </div>
            <ErrorLine error={error} />
            <div className="a-actions"><button type="button" className="a-btn" disabled={!bank} onClick={() => { setError(null); setStep('consent'); }}>Continue with {bank ? bank.name : 'your bank'}{ICON.arrow}</button></div>
          </>
        )}

        {step === 'consent' && (
          <>
            <h2>Approve what MITRA can see</h2>
            <p className="a-sub">This is the consent your bank will act on. It covers one purpose, and you can revoke it any time.</p>
            <div className="a-consent-card">
              <header><i>{ICON.bank}</i><span><b>{bank.name}</b><small>to MITRA, through an Account Aggregator</small></span></header>
              <dl>
                <div><dt>Purpose</dt><dd>Check what you can safely afford before a loan</dd></div>
                <div><dt>Data</dt><dd>Account transactions and summary</dd></div>
                <div><dt>Period</dt><dd>Last 6 months</dd></div>
                <div><dt>How often</dt><dd>Once</dd></div>
                <div><dt>Kept for</dt><dd>30 days, then deleted</dd></div>
                <div><dt>Mobile</dt><dd>{user.phone || 'Your number registered with the bank'}</dd></div>
              </dl>
              <p>{ICON.lock}MITRA never sees your net-banking password, and cannot move money.</p>
            </div>
            <ErrorLine error={error} />
            <div className="a-actions">
              <button type="button" className="a-link" onClick={onBack}>{inCall ? 'Not now' : 'Upload papers instead'}</button>
              <button type="button" className="a-btn" disabled={busy} onClick={approve}>{busy && <Spinner />}Approve and get OTP{!busy && ICON.arrow}</button>
            </div>
          </>
        )}

        {step === 'otp' && link && (
          <>
            <h2>Enter the code</h2>
            <p className="a-sub">Sent to {link.sentTo || 'your mobile'}. It expires in {link.expiresInMinutes} minutes.</p>
            <PinInput label="6-digit code" value={otp} onChange={setOtp} length={6} secret={false} autoFocus />
            <div className="a-sandbox-otp">
              <span><b>Sandbox:</b> no SMS is sent. Your code is <code>{link.sandboxOtp}</code>.</span>
              <button type="button" className="a-link" onClick={() => setOtp(link.sandboxOtp)}>Fill it in</button>
            </div>
            <ErrorLine error={error} />
            <div className="a-actions">
              <button type="button" className="a-link" onClick={approve} disabled={busy}>Send a new code</button>
              <button type="button" className="a-btn" disabled={busy || otp.length !== 6} onClick={verify}>{busy && <Spinner />}Verify{!busy && ICON.arrow}</button>
            </div>
          </>
        )}

        {step === 'accounts' && (
          <>
            <h2>Choose accounts to share</h2>
            <p className="a-sub">{bank.name} found {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'} for this number. Share the ones your earnings go into.</p>
            <div className="a-accounts">
              {accounts.map((account, index) => {
                const on = chosen.includes(account.ref);
                return (
                  <label key={account.ref} className={`a-account ${on ? 'is-on' : ''}`} style={{ animationDelay: `${index * 80}ms` }}>
                    <input type="checkbox" checked={on} onChange={() => setChosen((list) => (on ? list.filter((ref) => ref !== account.ref) : [...list, account.ref]))} />
                    <i aria-hidden="true">{ICON.check}</i>
                    <span><b>{account.type}</b><small>{bank.name} · {account.masked}</small></span>
                    {account.primary && <em>Most used</em>}
                  </label>
                );
              })}
            </div>
            <ErrorLine error={error} />
            <div className="a-actions"><button type="button" className="a-btn" disabled={busy || !chosen.length} onClick={share}>Share statement{ICON.arrow}</button></div>
          </>
        )}

        {step === 'fetching' && (
          <div className="a-fetch" aria-live="polite">
            <div className="a-fetch-line" aria-hidden="true">
              <i className="is-bank">{ICON.bank}</i>
              <span><b /><b /><b /><b /><b /></span>
              <i className="is-mitra"><span className="a-logo-mark" /></i>
            </div>
            <h2>Fetching 6 months from {bank.name}…</h2>
            <p className="a-sub">Encrypted from your bank to MITRA. You will check every line {inCall ? 'on the answer card' : 'next'}.</p>
          </div>
        )}
      </div>
    </div>
  );
}

const READING = ['Opening your papers', 'Reading every line', 'Sorting payouts, sales and transfers', 'Checking the totals'];

function PapersStep({ user, onNext, onSkip, onBack }) {
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState([]);
  const [drag, setDrag] = useState(false);
  const [phase, setPhase] = useState('choose');
  const [read, setRead] = useState(null);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState(null);
  const fail = (message) => setError({ message, at: Date.now() });

  useEffect(() => {
    if (phase !== 'reading') return undefined;
    const timer = setInterval(() => setTick((value) => value + 1), 2200);
    return () => clearInterval(timer);
  }, [phase]);

  const add = (list) => setFiles((current) => [...current, ...list.filter((file) => /pdf|jpe?g|png/i.test(file.type))].slice(0, 5));
  const readThem = async (chosen) => {
    if (!consent) return fail('Tick the box first, so MITRA may read them');
    setPhase('reading'); setTick(0); setError(null);
    try {
      const out = await authApi('/papers', { method: 'POST', body: { consent: true, files: await readFiles(chosen) } });
      if (!out.docs.length) { setPhase('pick'); return fail(out.line); }
      setRead(out);
      setPhase('review');
    } catch (problem) { setPhase('pick'); fail(problem.message); }
  };
  const confirm = async (accept, edits) => {
    try {
      const out = await authApi('/papers/confirm', { method: 'POST', body: { accept, edits } });
      if (!accept) { setPhase('choose'); setFiles([]); return fail('Nothing from those lines is used. You can link another account, upload papers, or skip for now.'); }
      onNext(out.user);
    } catch (problem) { setPhase('review'); fail(problem.message); }
  };

  if (phase === 'choose') {
    return (
      <div className="a-step-body">
        <h2>Show MITRA what you earn</h2>
        <p className="a-sub">No salary slip needed. Pick one way. Either way, you check every line before it is used.</p>
        <div className="a-ways">
          <button type="button" className="a-way is-main" onClick={() => { setError(null); setPhase('bank'); }}>
            <i>{ICON.bank}</i>
            <span><b>Link your bank account</b><small>About a minute. Your statement comes straight from your bank through an Account Aggregator.</small></span>
            <em>Recommended</em>
          </button>
          <button type="button" className="a-way" style={{ animationDelay: '80ms' }} onClick={() => { setError(null); setPhase('pick'); }}>
            <i>{ICON.upload}</i>
            <span><b>Upload papers</b><small>Bank statements, UPI receipts, ITR or GST, as PDF or photos.</small></span>
          </button>
        </div>
        <ErrorLine error={error} />
        <div className="a-actions"><button type="button" className="a-link" onClick={onBack}>Back</button><button type="button" className="a-link" onClick={onSkip}>Skip for now</button></div>
      </div>
    );
  }
  if (phase === 'bank') return <BankConnect user={user} onBack={() => setPhase('choose')} onFetched={(out) => { setRead(out); setError(null); setPhase('review'); }} />;
  if (phase === 'reading') {
    return (
      <div className="a-step-body a-reading" aria-live="polite">
        <div className="a-scan" aria-hidden="true"><i /><i /><i /><i /><i /><span /></div>
        <h2>{READING[tick % READING.length]}…</h2>
        <p className="a-sub">Sarvam Vision is reading {files.length || 'your'} {files.length === 1 ? 'file' : 'files'}. This usually takes 10 to 20 seconds.</p>
      </div>
    );
  }
  if (phase === 'review') {
    return (
      <div className="a-step-body">
        <h2>{read.docs.some((doc) => doc.via === 'aa') ? 'Check what your bank shared' : 'Check what MITRA read'}</h2>
        <p className="a-sub">{read.line}</p>
        <ErrorLine error={error} />
        <div className="j-app a-embed"><div className="j-result"><IncomeReadCard data={read} onIncome={confirm} /></div></div>
      </div>
    );
  }
  return (
    <div className="a-step-body">
      <h2>Show MITRA what you earn</h2>
      <p className="a-sub">No salary slip needed. MITRA reads your papers, adds up every way you earn, and you check every line before it is used.</p>
      <div className="a-needs">
        <p>Helpful for {user.workLabel ? user.workLabel.toLowerCase() : 'you'}:</p>
        <ul>{user.papers.map((paper, index) => <li key={paper} style={{ animationDelay: `${index * 70}ms` }}>{ICON.doc}{paper}</li>)}</ul>
      </div>
      <label className={`a-consent ${consent ? 'is-on' : ''}`}>
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <i aria-hidden="true">{ICON.check}</i>
        <span><b>MITRA may use my papers only to check what I can afford, for 30 days.</b> I can withdraw this any time with one sentence. The files are not kept, only their fingerprints and the lines I confirm.</span>
      </label>
      <label
        className={`a-drop ${drag ? 'is-drag' : ''} ${consent ? '' : 'is-locked'}`}
        onDragOver={(event) => { event.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(event) => { event.preventDefault(); setDrag(false); if (consent) add([...event.dataTransfer.files]); else fail('Tick the box first, so MITRA may read them'); }}
      >
        <input type="file" multiple accept="application/pdf,image/jpeg,image/png" disabled={!consent} onChange={(event) => { add([...(event.target.files || [])]); event.target.value = ''; }} />
        <i>{ICON.upload}</i>
        <b>{consent ? 'Drop your papers here, or tap to choose' : 'Tick the box above to add papers'}</b>
        <small>PDF, JPG or PNG. Up to 5 files, 15 MB together.</small>
      </label>
      {files.length > 0 && (
        <ul className="a-files">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>{ICON.doc}<span>{file.name}</span><small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((_, at) => at !== index))}>{ICON.close}</button>
            </li>
          ))}
        </ul>
      )}
      <ErrorLine error={error} />
      <div className="a-actions">
        <button type="button" className="a-link" onClick={() => setPhase('choose')}>Back</button>
        <button type="button" className="a-btn is-quiet" disabled={!consent} onClick={async () => { const sample = await sampleFiles(user.sample); setFiles(sample); readThem(sample); }}>Use sample papers</button>
        <button type="button" className="a-btn" disabled={!consent || !files.length} onClick={() => readThem(files)}>Read my papers{ICON.arrow}</button>
      </div>
    </div>
  );
}

function ReadyStep({ user, onStart }) {
  const income = user.income;
  const counted = useCountUp(income?.counted || 0);
  const safe = useCountUp(income?.comfortableEmi || 0, 1100);
  return (
    <div className="a-step-body a-ready">
      <svg className="a-tick" width="84" height="84" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="38" /><path d="M26 43l11 11 21-23" /></svg>
      <h2>You’re all set, {user.name.split(' ')[0]}.</h2>
      <p className="a-sub">MITRA will greet you in {LANG_NAME[user.lang] || 'English'}{income ? ', and it already knows what you can afford.' : '.'}</p>
      {income ? (
        <div className="a-stats">
          <div><span>Income MITRA counts</span><b>{inr(counted)}</b><small>a month, from your weaker months</small></div>
          <div><span>A comfortable EMI</span><b>{inr(safe)}</b><small>a month{income.existingEmi ? `, after the ${inr(income.existingEmi)} you already pay` : ''}</small></div>
          <div><span>Sources on file</span><b>{income.documents}</b><small>{income.monthCount ? `${income.monthCount} months, ${income.from} to ${income.to}` : 'from your tax return'}</small></div>
        </div>
      ) : null}
      {income && user.banks?.length > 0 && <p className="a-linked">{ICON.bank}Linked: {user.banks.map((item) => `${item.bank} ••${item.account.slice(-4)}`).join(', ')}</p>}
      {income ? null : <p className="a-callout">No papers yet. You can share them on any call with the + button, and MITRA works out what you can afford there.</p>}
      <div className="a-actions is-center"><button type="button" className="a-btn is-big" onClick={onStart}>Start your first call{ICON.arrow}</button></div>
    </div>
  );
}

function Onboarding({ user: start, onDone, onSignOut }) {
  const [user, setUser] = useState(start);
  const [step, setStep] = useState(start.work ? 2 : 1);
  const [dir, setDir] = useState('fwd');
  const go = (next) => { setDir(next > step ? 'fwd' : 'back'); setStep(next); };
  const finish = async () => {
    const out = await authApi('/onboarded', { method: 'POST' }).catch(() => null);
    if (out) setUser(out.user);
    go(3);
  };
  return (
    <div className="a-shell a-onboard">
      <header className="a-top">
        <Logo />
        <span className="a-top-who">Setting up for <b>{user.name}</b></span>
        <button type="button" className="a-link" onClick={onSignOut}>Sign out</button>
      </header>
      <nav className="a-progress" aria-label="Onboarding steps">
        <div className="a-progress-bar" aria-hidden="true"><span style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }} /></div>
        <ol>
          {STEPS.map((label, index) => (
            <li key={label} className={index < step ? 'is-done' : index === step ? 'is-now' : ''} aria-current={index === step ? 'step' : undefined}>
              <i>{index < step ? ICON.check : index + 1}</i><span>{label}</span>
            </li>
          ))}
        </ol>
      </nav>
      <main className="a-stage">
        <div className={`a-step is-${dir}`} key={step}>
          {step === 1 && <AboutStep user={user} onNext={(next) => { setUser(next); go(2); }} />}
          {step === 2 && <PapersStep user={user} onNext={(next) => { setUser(next); finish(); }} onSkip={finish} onBack={() => go(1)} />}
          {step === 3 && <ReadyStep user={user} onStart={() => onDone(user)} />}
        </div>
      </main>
    </div>
  );
}

// ── the gate ────────────────────────────────────────────────────
export default function AuthGate() {
  const [phase, setPhase] = useState('loading');
  const [user, setUser] = useState(null);

  const enter = useCallback((next) => {
    setUser(next);
    setPhase(next.onboarded ? 'app' : 'onboarding');
  }, []);

  useEffect(() => {
    const demo = params.get('demo') || params.get('customer');
    const boot = async () => {
      if (!getToken() && ['ramesh', 'lakshmi'].includes(demo)) {
        const out = await authApi('/demo', { method: 'POST', body: { id: demo } });
        setToken(out.token);
        return enter(out.user);
      }
      if (!getToken()) return setPhase('signin');
      const out = await authApi('/me');
      return enter(out.user);
    };
    boot().catch(() => { setToken(null); setPhase('signin'); });
  }, [enter]);

  const signOut = useCallback(async () => {
    await authApi('/logout', { method: 'POST' }).catch(() => {});
    setToken(null);
    setUser(null);
    setPhase('signin');
  }, []);

  const refreshUser = useCallback(async () => {
    const out = await authApi('/me').catch(() => null);
    if (out) setUser(out.user);
  }, []);

  const view = useMemo(() => {
    if (phase === 'loading') return <div className="a-shell a-loading" aria-busy="true"><Logo /><Spinner /></div>;
    if (phase === 'signin') return <SignIn onSignedIn={enter} />;
    if (phase === 'onboarding') return <Onboarding user={user} onDone={(next) => { setUser(next); setPhase('app'); }} onSignOut={signOut} />;
    return (
      <Suspense fallback={<div className="a-shell a-loading"><Logo /><Spinner /></div>}>
        <div className="a-enter"><JourneyApp user={user} onSignOut={signOut} onRefreshUser={refreshUser} /></div>
      </Suspense>
    );
  }, [phase, user, enter, signOut, refreshUser]);

  return <div key={phase} className="a-fade">{view}</div>;
}
