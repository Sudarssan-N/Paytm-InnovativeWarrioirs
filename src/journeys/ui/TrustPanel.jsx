import React, { useEffect, useMemo, useState } from 'react';
import { browserSha256, sealPassport, shortHash, verifyChain } from '../passport.js';
import { fmtDate } from '../money.js';
import { HandoffBrief } from './cards.jsx';
import { getJourney, postJourney } from './useJourney.js';

const PaytmPanel = React.lazy(() => import('./PaytmPanel.jsx'));
const OpsPanel = React.lazy(() => import('./OpsPanel.jsx'));

const KIND_LABEL = { stt: 'Heard', translate: 'Translate', route: 'Route', agent: 'Agent', consent: 'Consent', engine: 'Engine', policy: 'Policy', grounding: 'Fence', fence: 'Fence', seal: 'Seal', handoff: 'Person', disclosure: 'Disclose', voice: 'Voice', vision: 'Read' };

function Trace({ trace }) {
  if (!trace.length) return <p className="j-empty">Start the call. Each step of every turn appears here: what was heard, which agent acted, what the engine computed, and what was sealed.</p>;
  return (
    <ol className="j-trace" aria-label="What MITRA did on this turn">
      {trace.map((event, index) => (
        <li key={`${event.kind}-${index}`} className={`is-${event.kind} ${event.ok === false ? 'is-bad' : ''}`}>
          <span className="j-trace-kind">{KIND_LABEL[event.kind] || event.kind}</span>
          <div>
            <p>{event.label}{event.ms != null && <small> {event.ms} ms</small>}</p>
            {event.detail && <p className="j-trace-detail">{event.detail}</p>}
            {event.args && Object.keys(event.args).length > 0 && <code>{JSON.stringify(event.args)}</code>}
          </div>
        </li>
      ))}
    </ol>
  );
}

const TAMPER_FIELD = { field: 'result', label: 'Change the result on this receipt' };

function Passport({ chain }) {
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState(null); // an altered copy being checked
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const active = view || chain;
  const index = selected != null && selected < active.length ? selected : active.length - 1;
  const passport = active[index];

  const verify = async (candidate, attack = null) => {
    setBusy(true);
    try {
      // Checked twice on purpose: here in the browser, then by the server's key.
      const local = await verifyChain(candidate, { sha256: browserSha256 });
      const server = await postJourney('/verify', { chain: candidate });
      setCheck({ local, server, attack });
    } catch (error) {
      setCheck({ error: error.message });
    } finally { setBusy(false); }
  };

  useEffect(() => {
    setView(null);
    if (chain.length) verify(chain);
  }, [chain.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const tamperOne = () => {
    const copy = structuredClone(chain);
    const target = copy[index];
    target[TAMPER_FIELD.field] = `${target[TAMPER_FIELD.field]} (edited)`;
    setView(copy);
    verify(copy, 'edit');
  };

  // The attack a bare hash chain cannot catch: edit a receipt, then recompute
  // every hash after it so the whole chain adds up again.
  const forgeAll = async () => {
    const forged = [];
    for (const [position, item] of chain.entries()) {
      const { hash, signature, sequence, previous, ...body } = item;
      const changed = position === index ? { ...body, [TAMPER_FIELD.field]: `${body[TAMPER_FIELD.field]} (forged)` } : body;
      await sealPassport(forged, changed, { sha256: browserSha256, sign: () => signature });
    }
    setView(forged);
    verify(forged, 'forge');
  };

  const restore = () => { setView(null); verify(chain); };

  const download = () => {
    const blob = new Blob([JSON.stringify(active, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: `journey-passport-${active[0]?.id || 'chain'}.json` });
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!passport) return <p className="j-empty">The first receipt is sealed when the call opens.</p>;
  const verified = check?.server?.valid && check?.local?.valid;
  const brokenHere = check?.server && !check.server.valid && check.server.index === index;

  return (
    <div className="j-passport-wrap">
      <div className="j-chain" role="tablist" aria-label="Receipts in this journey">
        {active.map((item, position) => (
          <button key={item.id} type="button" role="tab" aria-selected={position === index} className={`${position === index ? 'is-active' : ''} ${check?.server?.index === position && !check.server.valid ? 'is-broken' : ''}`} onClick={() => setSelected(position)} title={item.journey}>
            {position + 1}
          </button>
        ))}
      </div>

      <article className={`j-passport ${brokenHere ? 'is-broken' : ''}`}>
        <header>
          <div className="j-passport-title"><span className="j-logo-mark" aria-hidden="true" /><h3>Journey Passport</h3></div>
          <span className={`j-seal ${verified ? 'is-ok' : check ? 'is-bad' : ''}`}>{busy ? 'Checking…' : verified ? '✓ Verified' : check ? 'Failed' : '…'}</span>
        </header>
        <p className="j-mono j-passport-id">{passport.id} · {new Date(passport.issuedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
        <dl>
          <div><dt>Journey</dt><dd><b>{passport.journey}</b></dd></div>
          <div><dt>Language</dt><dd>{passport.language.label}{passport.language.confidence != null ? `, detected automatically (${Number(passport.language.confidence).toFixed(2)})` : passport.language.method && passport.language.method !== 'Not applicable' ? `, ${passport.language.method.toLowerCase()}` : ''}</dd></div>
          {passport.asked && <div><dt>Asked</dt><dd>“{passport.asked.original}”{passport.asked.english !== passport.asked.original && <small>{passport.asked.english}</small>}</dd></div>}
          {passport.evidence.length > 0 && <div><dt>Evidence</dt><dd>{passport.evidence.map((item, i) => <span key={i} className="j-evidence"><i>{item.field}:</i> {item.value}</span>)}</dd></div>}
          <div><dt>Formula</dt><dd className="j-mono">{passport.formula}</dd></div>
          <div><dt>Result</dt><dd className="j-passport-result">{passport.result}</dd></div>
          {passport.policyPack && <div><dt>Policy pack</dt><dd>{passport.policyPack.label}</dd></div>}
          <div><dt>Consent</dt><dd>{passport.consent.length ? passport.consent.map((item) => <span key={item.id} className="j-evidence">{item.label}{item.days ? `, ${item.days} days` : ''}</span>) : 'None needed for this step'}</dd></div>
          <div><dt>Action</dt><dd><span className="j-action">{passport.action}</span></dd></div>
          {passport.said?.figuresChecked?.length > 0 && <div><dt>Figure check</dt><dd>{passport.said.figuresChecked.length} figures checked after translation{passport.said.linesRejected ? `, ${passport.said.linesRejected} sentences rejected` : ', all intact'}</dd></div>}
        </dl>
        <div className="j-links">
          <div><span>Previous</span><code>{shortHash(passport.previous)}</code></div>
          <i aria-hidden="true">→</i>
          <div className="is-this"><span>This passport</span><code>{shortHash(passport.hash)}</code></div>
          <i aria-hidden="true">→</i>
          <div><span>Next</span><code>{shortHash(active[index + 1]?.hash)}</code></div>
        </div>
      </article>

      {check?.server && !check.server.valid && (
        <div className="j-verify-fail" role="alert">
          <b>Verification failed at {check.server.brokenAt}.</b>
          <p>{check.server.detail}.</p>
          {check.attack === 'forge' && <p>Every hash adds up (browser check: {check.local.valid ? 'passed' : 'failed'}), but the forger does not have MITRA’s signing key.</p>}
        </div>
      )}
      {check?.server?.valid && <p className="j-verify-ok">{check.server.checked} receipts recomputed in this browser and on the server. Signatures valid. Latest hash: <code>{shortHash(check.server.head)}</code></p>}

      <div className="j-passport-actions">
        {view ? <button type="button" className="j-btn" onClick={restore}>Restore the real chain</button> : (
          <>
            <button type="button" className="j-btn" onClick={tamperOne}>Change one field</button>
            <button type="button" className="j-btn" onClick={forgeAll}>Rewrite the whole chain</button>
          </>
        )}
        <button type="button" className="j-btn is-quiet" onClick={download}>Download</button>
      </div>
    </div>
  );
}

const WITHDRAW_TEXT = { loan_eligibility: 'Withdraw my income consent', insurance_needs: 'Withdraw my insurance consent', merchant_credit: 'Withdraw my sales consent', rm_handoff: 'Withdraw consent for the expert case' };

function Consents({ state, onSend, onErased }) {
  const consents = state?.consents || [];
  const facts = Object.entries(state?.facts || {});
  const [asking, setAsking] = useState(false);
  const erase = async () => {
    const res = await fetch(`/api/journey/${state.sessionId}`, { method: 'DELETE' });
    if (res.ok) onErased?.(await res.json());
    setAsking(false);
  };
  return (
    <div className="j-consents">
      <h3>Facts held, asked once</h3>
      {facts.length ? (
        <ul className="j-plain">
          {facts.map(([field, info]) => <li key={field}><b>{{ income: 'Monthly income', dependants: 'Dependants', existingLife: 'Life cover', existingHealth: 'Health cover', salesSummary: 'Soundbox sales summary' }[field] || field}</b> <span className="j-muted">collected by {info.collectedBy} on {fmtDate(info.collectedOn)}</span></li>)}
        </ul>
      ) : <p className="j-empty">Nothing yet. MITRA asks only when an answer needs it.</p>}
      {state?.metrics && <p className="j-reuse">Reused without asking again: <b>{state.metrics.reused}</b></p>}
      <h3>Consent, one purpose at a time</h3>
      {consents.length ? consents.map((grant) => (
        <article key={grant.id} className={`j-consent ${grant.status !== 'active' ? 'is-off' : ''}`}>
          <p><b>{grant.label}</b></p>
          <p className="j-muted">{grant.status === 'active' ? `Until ${fmtDate(grant.expiresOn)}, in the customer’s words: “${grant.words}”` : `Withdrawn on ${fmtDate(grant.revokedOn)}`}</p>
          {grant.status === 'active' && <button type="button" className="j-btn is-quiet" onClick={() => onSend(WITHDRAW_TEXT[grant.purpose], { tapped: true })}>Withdraw</button>}
        </article>
      )) : <p className="j-empty">No consent given yet.</p>}
      {state?.reminders?.length > 0 && (
        <>
          <h3>Reminders MITRA is tracking</h3>
          <ul className="j-plain">{state.reminders.map((item) => <li key={item.id}><b>{item.label}</b> <span className="j-muted">reminds on {fmtDate(item.on)}</span></li>)}</ul>
          <p className="j-empty">In this prototype, reminders are tracked and shown. No SMS is sent.</p>
        </>
      )}
      {state?.sessionId && (
        <>
          <h3>Your data</h3>
          {asking ? (
            <p className="j-doc-actions"><button type="button" className="is-yes" onClick={erase}>Yes, erase it all</button><button type="button" onClick={() => setAsking(false)}>Keep it</button></p>
          ) : <button type="button" className="j-btn is-quiet" onClick={() => setAsking(true)}>Erase everything about this call</button>}
          <p className="j-empty">Removes what you said, your facts and your receipts. Only a note that a record existed stays.</p>
        </>
      )}
    </div>
  );
}

const OUTCOMES = [
  ['resolved', 'Resolved on the call'],
  ['routed', 'Routed to the partner'],
  ['grievance', 'Grievance raised'],
];

function Desk({ sessionId, onResolved }) {
  const [briefs, setBriefs] = useState([]);
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => getJourney('/desk').then((data) => { if (alive) setBriefs(data.briefs); }).catch(() => {});
    load();
    const timer = setInterval(load, 2500);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const mine = useMemo(() => briefs.filter((brief) => brief.sessionId === sessionId), [briefs, sessionId]);
  if (!mine.length) return <p className="j-empty">When MITRA hands over, the expert sees the whole story here. The customer never repeats it.</p>;

  const resolve = async (brief, outcome) => {
    setBusy(brief.id);
    try {
      const out = await postJourney(`/desk/${brief.id}/resolve`, { outcome, notes: notes[brief.id] || '' });
      onResolved?.(out.state);
    } finally { setBusy(null); }
  };

  return (
    <div className="j-desk">
      <p className="j-eyebrow">The expert’s view</p>
      {mine.map((brief) => (
        <div key={brief.id}>
          <HandoffBrief brief={brief} />
          {brief.status !== 'closed' ? (
            <div className="j-desk-actions">
              <label>
                <span>Notes, added to the same record and read back to the customer</span>
                <textarea rows={2} value={notes[brief.id] || ''} onChange={(event) => setNotes((items) => ({ ...items, [brief.id]: event.target.value }))} placeholder="What you found out" />
              </label>
              <div>{OUTCOMES.map(([id, label]) => <button key={id} type="button" className="j-btn" disabled={busy === brief.id} onClick={() => resolve(brief, id)}>{label}</button>)}</div>
            </div>
          ) : <p className="j-verify-ok">Closed: {OUTCOMES.find(([id]) => id === brief.outcome)?.[1] || brief.outcome}. Sealed into the same chain and sent to the customer in {brief.language}.</p>}
        </div>
      ))}
    </div>
  );
}

const TABS = [['trace', 'What happened'], ['passport', 'Passport'], ['consent', 'Consent'], ['desk', 'Expert desk'], ['paytm', 'Paytm'], ['ops', 'Ops']];

export default function TrustPanel({ trace, state, onSend, onResolved, onErased, tab, onTab }) {
  const open = (state?.handoffs || []).filter((brief) => brief.status !== 'closed').length;
  return (
    <aside className="j-trust" aria-label="Under the hood">
      <div className="j-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => onTab(id)}>
            {label}{id === 'desk' && open > 0 && <i className="j-badge">{open}</i>}{id === 'passport' && state?.chain?.length > 0 && <i className="j-count">{state.chain.length}</i>}
          </button>
        ))}
      </div>
      <div className="j-tab-body">
        {tab === 'trace' && <Trace trace={trace} />}
        {tab === 'passport' && <Passport chain={state?.chain || []} />}
        {tab === 'consent' && <Consents state={state} onSend={onSend} onErased={onErased} />}
        {tab === 'desk' && <Desk sessionId={state?.sessionId} onResolved={onResolved} />}
        {tab === 'paytm' && <React.Suspense fallback={null}><PaytmPanel /></React.Suspense>}
        {tab === 'ops' && <React.Suspense fallback={null}><OpsPanel /></React.Suspense>}
      </div>
    </aside>
  );
}
