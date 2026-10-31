import React, { useEffect, useState } from 'react';

// The numbers an operator would watch, live from this server.
export default function OpsPanel() {
  const [m, setM] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch('/api/ops/metrics').then((res) => res.json()).then((data) => { if (live) setM(data); }).catch(() => {});
    load();
    const timer = setInterval(load, 3000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  if (!m) return <p className="j-empty">Loading…</p>;
  const breakers = Object.entries(m.breakers);
  return (
    <div className="j-side">
      <div className="j-ops-grid">
        <div><span>Turns served</span><b>{m.turns.count}</b></div>
        <div><span>Turn time, p95</span><b>{m.turns.p95 != null ? `${(m.turns.p95 / 1000).toFixed(1)} s` : '–'}</b></div>
        <div><span>Cost per turn (est.)</span><b>{m.costPerTurn != null ? `₹${m.costPerTurn}` : '–'}</b></div>
        <div><span>Served from cache</span><b>{m.cacheHitPct != null ? `${m.cacheHitPct}%` : '–'}</b></div>
        <div><span>Figures checked</span><b>{m.fence.figuresChecked}</b></div>
        <div><span>Sentences blocked</span><b>{m.fence.sentencesBlocked}</b></div>
        <div><span>Voice checks passed</span><b>{m.voice.checked - m.voice.failed} / {m.voice.checked}</b></div>
        <div><span>Sent to a model</span><b>{m.turns.routedBy.model || 0} / {m.turns.count}</b></div>
      </div>
      <h3>Sarvam and Paytm, live</h3>
      <table className="j-ops-table">
        <thead><tr><th>Call</th><th>Calls</th><th>p50 ms</th><th>Errors</th><th>₹</th></tr></thead>
        <tbody>
          {m.providers.map((row) => <tr key={row.path}><td>{row.path}</td><td>{row.calls}</td><td>{row.p50 ?? '–'}</td><td>{row.errors}</td><td>{row.costRupees || '–'}</td></tr>)}
        </tbody>
      </table>
      {breakers.length > 0 && <p className="j-side-note">Circuit breakers: {breakers.map(([name, state]) => `${name} ${state.open ? 'OPEN' : 'closed'}`).join(', ')}</p>}
      <p className="j-side-note">{m.pricing}. Chat tokens and Sarvam Vision pages are not priced here. <a href="/api/ops/metrics?format=prometheus">Prometheus format</a></p>
    </div>
  );
}
