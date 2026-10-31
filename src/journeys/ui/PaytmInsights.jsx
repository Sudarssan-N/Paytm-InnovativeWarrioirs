import React, { useState } from 'react';
import { fmtDate, inr, pct } from '../money.js';
import { Foot, Row } from './cardParts.jsx';
import './paytm-insights.css';

const TONE = { warn: ['Needs a look', 'is-warn'], info: ['Worth knowing', 'is-info'], ok: ['Going well', 'is-ok'] };
const count = (n) => n.toLocaleString('en-IN');
const short = (n) => (n >= 100000 ? `₹${(n / 100000).toFixed(1).replace(/\.0$/, '')}L` : n >= 1000 ? `₹${Math.round(n / 1000)}k` : inr(n));

// One series, so no legend: the heading names it. Only the best and weakest months
// carry a label; every month shows its figure on hover and in the table.
function MonthBars({ months, best, lowest }) {
  const [hover, setHover] = useState(null);
  const top = Math.max(...months.map((m) => m.sales), 1);
  return (
    <figure className="pi-bars" onMouseLeave={() => setHover(null)}>
      <div className="pi-bars-plot" role="img" aria-label={`Monthly sales, ${months[0].month} to ${months.at(-1).month}`}>
        {months.map((m) => {
          const marked = m.key === best?.key || m.key === lowest?.key;
          return (
            <div key={m.key} className={`pi-bar ${hover === m.key ? 'is-hover' : ''}`} onMouseEnter={() => setHover(m.key)} onFocus={() => setHover(m.key)} tabIndex={0}>
              {(marked || hover === m.key) && <span className="pi-bar-label">{short(m.sales)}</span>}
              <i style={{ height: `${Math.max((m.sales / top) * 100, 1)}%` }} />
              {hover === m.key && <span className="pi-tip" role="status"><b>{m.month}</b>{inr(m.sales)} · {m.count} payments</span>}
            </div>
          );
        })}
      </div>
      <div className="pi-bars-axis" aria-hidden="true">{months.map((m) => <span key={m.key}>{m.month.slice(0, 3)}</span>)}</div>
      <table className="pi-sr">
        <caption>Monthly sales</caption>
        <tbody>{months.map((m) => <tr key={m.key}><th>{m.month}</th><td>{inr(m.sales)}</td><td>{m.count} payments</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

function ModeBars({ modes }) {
  return (
    <ul className="pi-modes">
      {modes.slice(0, 5).map((m) => (
        <li key={m.mode} title={`${m.mode}: ${m.count} payments, ${inr(m.sales)}${m.successRatePct != null ? `, ${pct(m.successRatePct)} went through` : ''}`}>
          <span className="pi-mode-name">{m.mode}</span>
          <span className="pi-mode-track"><i style={{ width: `${Math.max(m.sharePct, 1)}%` }} /></span>
          <span className="pi-mode-value">{pct(m.sharePct)}{m.successRatePct != null && <small>{pct(m.successRatePct)} ok</small>}</span>
        </li>
      ))}
    </ul>
  );
}

export function InsightsView({ data: d, compact = false, onAsk }) {
  const p = d.profile;
  if (!p.months.length) {
    return <section className="j-callout is-amber"><b>No full month of sales yet.</b> <p>Paytm returned {p.coverage.orders} orders and {p.coverage.settlements} settlements. Once a full month is in, MITRA can profile the business.</p></section>;
  }
  return (
    <div className="pi">
      <section className="j-tile">
        <p className="j-eyebrow">{p.name} · {p.coverage.monthCount} months · {d.sample ? 'sample records, not from Paytm' : `from Paytm${d.pulledAt ? `, ${fmtDate(d.pulledAt)}` : ''}`}</p>
        <p className="j-hero">{inr(p.averageMonthly)}</p>
        <p className="j-muted">average monthly sales, from {count(p.payments)} payments of {inr(p.averageTicket)} on average</p>
        <ul className="pi-segments">{d.segments.map((s) => <li key={s.id} title={s.why}><b>{s.label}</b>{!compact && <small>{s.why}</small>}</li>)}</ul>
      </section>

      <section className="j-tile">
        <p className="j-eyebrow">Monthly sales</p>
        <MonthBars months={p.months} best={p.bestMonth} lowest={p.lowestMonth} />
      </section>

      <section className="pi-suggestions" aria-label="Suggestions">
        {d.suggestions.slice(0, compact ? 3 : undefined).map((s) => {
          const [label, tone] = TONE[s.tone] || TONE.info;
          return (
            <article key={s.id} className={`pi-suggestion ${tone}`}>
              <p className="pi-suggestion-head"><b>{s.title}</b><span>{label}</span></p>
              <p>{s.body}</p>
              {s.ask && onAsk && <button type="button" className="pi-ask" onClick={() => onAsk(s.ask)}>{s.ask}</button>}
            </article>
          );
        })}
        {!d.suggestions.length && <p className="j-muted">Nothing needs your attention right now.</p>}
      </section>

      {!compact && (
        <>
          <section className="j-tile">
            <p className="j-eyebrow">How customers pay · share of payments</p>
            <ModeBars modes={p.modes} />
          </section>
          <section className="j-tile j-rows">
            {p.successRatePct != null && <Row label="Payments that went through" value={pct(p.successRatePct)} sub={`${count(p.failedAttempts)} of ${count(p.attempts)} failed, ${inr(p.failedValue)}`} strong />}
            {p.refunds.ratePct != null && <Row label="Refunded" value={inr(p.refunds.total)} sub={`${pct(p.refunds.ratePct)} of sales, ${p.refunds.count} refunds`} />}
            {p.settlements && <Row label="Charges on settlements" value={inr(p.settlements.fees)} sub={`${p.settlements.feeSharePct != null ? `${pct(p.settlements.feeSharePct)} of settled` : ''}${p.settlements.averageLagDays != null ? `, paid out in ${p.settlements.averageLagDays} ${p.settlements.averageLagDays === 1 ? 'day' : 'days'} on average` : ''}`} />}
            {p.customers && <Row label="Payers" value={count(p.customers.payers)} sub={`${pct(p.customers.repeatSharePct)} of sales from repeat payers`} />}
            {p.links && <Row label="Payment links" value={`${p.links.paid} paid of ${p.links.total}`} sub={p.links.active ? `${p.links.active} open, ${inr(p.links.activeValue)}` : 'none open'} />}
            {p.rhythm?.bestDay && <Row label="Busiest day" value={p.rhythm.bestDay.day} sub={`quietest: ${p.rhythm.quietestDay.day}`} />}
          </section>
          {d.notes?.length > 0 && <ul className="pi-notes">{d.notes.map((note) => <li key={note}>{note}</li>)}</ul>}
        </>
      )}
      <Foot>{d.pack?.label}: MITRA’s own thresholds, as of {d.pack?.asOf}. MITRA explains; it never moves money.</Foot>
    </div>
  );
}

export function InsightsCard({ data, onAsk }) {
  return <InsightsView data={data} compact onAsk={onAsk} />;
}
