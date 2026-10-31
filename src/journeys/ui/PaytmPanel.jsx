import React, { useCallback, useEffect, useState } from 'react';
import { InsightsView } from './PaytmInsights.jsx';

// What is really connected to Paytm right now, checked live. Nothing here is assumed.
const SURFACES = [
  { name: 'Paytm MCP server', how: 'Official hosted server. Orders, refunds, settlements and payment links are read to profile the business and suggest next steps. A payment link is the only thing it can create.', tag: 'Live, needs a merchant sign-in', live: true },
  { name: 'UPI QR and payment links', how: 'Any upi:// link or QR is read here and checked by Offer X-Ray before the PIN.', tag: 'Works today', live: true },
  { name: 'Paytm app, as a Mini App', how: 'MITRA is a web app, so it can open inside the Consumer or Business app with one-tap login.', tag: 'Needs Paytm onboarding' },
  { name: 'The KFS step of a loan', how: 'An “Explain this in my language” button beside the Key Fact Statement, then back to the same step.', tag: 'Proposed' },
  { name: 'AI Soundbox', how: 'Press, ask and hear it, in the 11 languages the Soundbox speaks. Simulated on the Lakshmi Stores view.', tag: 'Simulated here' },
  { name: 'Paytm Intelligence', how: 'The fence, the receipts and Promise Check as a trust layer for lenders and insurers.', tag: 'Proposed' },
];

// Paytm publishes each tool's schema, so the form follows it instead of guessing names.
function fillArguments(schema, amount) {
  const args = {};
  for (const [name, spec] of Object.entries(schema?.properties || {})) {
    if (/amount/i.test(name)) args[name] = spec.type === 'string' ? String(amount) : amount;
    else if (/(desc|name|purpose|note)/i.test(name) && (schema.required || []).includes(name)) args[name] = 'MITRA test link';
    else if (spec.enum && (schema.required || []).includes(name)) [args[name]] = spec.enum;
  }
  return args;
}

export default function PaytmPanel() {
  const [status, setStatus] = useState(null);
  const [tools, setTools] = useState(null);
  const [amount, setAmount] = useState('1');
  const [note, setNote] = useState('');
  const [link, setLink] = useState(null);
  const [insights, setInsights] = useState(null);
  const [pulling, setPulling] = useState('');
  const failed = new URLSearchParams(window.location.search).get('reason');

  // Reading six months takes many calls, so the first pull can take a while.
  const pull = useCallback(async ({ refresh = false, sample = false } = {}) => {
    setPulling(sample ? 'Loading the sample…' : refresh ? 'Pulling fresh records from Paytm…' : 'Reading your Paytm records…');
    try {
      const res = await fetch(sample ? '/api/paytm/profile?sample=1' : refresh ? '/api/paytm/sync' : '/api/paytm/profile', { method: refresh ? 'POST' : 'GET' });
      const out = await res.json();
      if (!res.ok) throw new Error(out.title);
      setInsights(out);
      setPulling('');
    } catch (error) { setPulling(error.message); }
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await (await fetch('/api/paytm/status')).json();
      setStatus(data);
      if (data.connected) {
        const res = await fetch('/api/paytm/tools');
        if (res.ok) setTools((await res.json()).tools);
        pull();
      }
    } catch { setStatus({ reachable: false }); }
  }, [pull]);
  useEffect(() => { load(); }, [load]);

  const createLink = async (event) => {
    event.preventDefault();
    const tool = tools?.find((item) => /create.*link/i.test(item.name));
    if (!tool) { setNote('This account shows no payment link tool.'); return; }
    setNote('Creating a real payment link…');
    try {
      const res = await fetch('/api/paytm/tool', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: tool.name, confirmed: true, arguments: fillArguments(tool.inputSchema, Number(amount)) }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.title);
      setLink(out.content?.map((item) => item.text).filter(Boolean).join('\n') || JSON.stringify(out));
      setNote('Paytm answered:');
    } catch (error) { setNote(error.message); }
  };

  return (
    <div className="j-side">
      <h3>Live link to Paytm</h3>
      <p className={`j-live ${status?.reachable ? 'is-on' : status ? 'is-off' : ''}`}><i />{status ? (status.reachable ? 'Paytm’s MCP server answered just now' : 'Paytm’s MCP server is not answering') : 'Checking…'}</p>
      <p className={`j-live ${status?.connected ? 'is-on' : ''}`}><i />{status?.connected ? 'Signed in to a merchant account' : 'Not signed in'}</p>
      {failed && <p className="j-side-note">The last sign-in did not finish: {failed}</p>}
      {status && !status.connected && (
        <>
          <a className="j-side-btn" href="/api/paytm/connect">Connect a Paytm merchant account</a>
          <p className="j-side-note">Opens Paytm’s own login (email, password, OTP). MITRA never sees the password, and it only keeps the access token.</p>
        </>
      )}
      {tools && (
        <>
          <p className="j-side-note">{tools.length} tools on this account: {tools.map((item) => item.name).join(', ')}</p>
          <form className="j-side-form" onSubmit={createLink}>
            <label htmlFor="j-paytm-amount">₹</label>
            <input id="j-paytm-amount" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} />
            <button type="submit" className="j-side-btn">Create a real payment link</button>
          </form>
          {note && <p className="j-side-note">{note}</p>}
          {link && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{link}</pre>}
        </>
      )}
      <h3>Your business, from Paytm</h3>
      <div className="pi-panel-actions">
        {status?.connected && <button type="button" className="j-side-btn" onClick={() => pull({ refresh: true })} disabled={Boolean(pulling) && !insights}>Pull fresh records</button>}
        {status && !status.connected && <button type="button" className="j-side-btn" onClick={() => pull({ sample: true })}>See it with sample records</button>}
      </div>
      {pulling && <p className="j-side-note">{pulling}</p>}
      {insights && (
        <>
          <p className="j-side-note">
            {insights.sample ? 'Sample records in Paytm’s format. Nothing here came from Paytm.'
              : `Read from ${Object.values(insights.tools || {}).filter(Boolean).join(', ') || 'no tools'}${insights.calls ? ` in ${insights.calls} calls` : ''}. Payer ids are kept only as a hash.`}
          </p>
          <InsightsView data={insights} />
        </>
      )}
      <h3>Where MITRA fits in Paytm</h3>
      <ul className="j-fit">
        {SURFACES.map((item) => <li key={item.name}><b>{item.name}</b>{item.how}<br /><small className={item.live ? 'is-live' : ''}>{item.tag}</small></li>)}
      </ul>
    </div>
  );
}
