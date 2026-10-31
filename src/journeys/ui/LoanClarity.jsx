// Loan Clarity: the customer's own income papers, read back line by line, what
// they can safely afford, and sliders to try other terms. The sliders run the same
// engine function as the agent, in the browser, so a change shows at once.
import React, { useMemo, useState } from 'react';
import { inr, pct } from '../money.js';
import { cashFlowWithLoan, classifyDebit } from '../engines/income.js';
import { applyEdits, profileFromDocuments, STREAM_LABELS } from '../incomeRead.js';
import { Foot, Row } from './cardParts.jsx';
import { DocCheck, PaperChecksNote } from './DocCheck.jsx';

const BAND = { fits: ['Fits comfortably', 'is-fits'], tight: ['Tight', 'is-tight'], stretch: ['More than is safe', 'is-stretch'] };
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMonth = (iso) => `${Number(iso.slice(8, 10))} ${SHORT[Number(iso.slice(5, 7)) - 1]}`;

// ── the read-back ───────────────────────────────────────────────
function Line({ row, include, amount, locked, tag, onToggle, onAmount }) {
  return (
    <li className={`j-line ${include ? '' : 'is-off'}`}>
      <input type="checkbox" aria-label={`Count ${row.description}`} checked={include} disabled={locked} onChange={(event) => onToggle(event.target.checked)} />
      <span className="j-line-date">{dayMonth(row.date)}</span>
      <span className="j-line-desc">{row.description}<small>{tag}</small></span>
      <input className="j-line-amount" type="number" min="1" step="1" aria-label="Amount in rupees" value={amount} disabled={locked} onChange={(event) => onAmount(event.target.value)} />
    </li>
  );
}

export function IncomeReadCard({ data: d, onIncome }) {
  const [edits, setEdits] = useState({});
  const [sent, setSent] = useState(false);
  const editList = useMemo(() => Object.entries(edits).map(([key, edit]) => {
    const [doc, row] = key.split(':').map(Number);
    return { doc, row, ...edit, amount: edit.amount === '' ? undefined : edit.amount };
  }), [edits]);
  const preview = useMemo(() => profileFromDocuments(applyEdits(d.docs, editList).docs), [d.docs, editList]);
  const change = (doc, row, patch) => setEdits((current) => ({ ...current, [`${doc}:${row}`]: { ...current[`${doc}:${row}`], ...patch } }));
  const value = (doc, row, field, fallback) => edits[`${doc}:${row}`]?.[field] ?? fallback;
  const statementRows = d.docs.filter((doc) => doc.kind === 'bank_statement').flatMap((doc) => doc.transactions);
  const lineFor = (docIndex, row, index) => {
    const field = row.credit ? 'credit' : 'debit';
    const excluded = row.stream === 'excluded';
    const tag = row.credit ? (excluded ? 'Not income, never counted' : STREAM_LABELS[row.stream]) : { emi: 'An EMI you already pay', business: 'Stock and supplies, taken off your sales' }[classifyDebit(row.description)];
    return (
      <Line
        key={index} row={row} tag={tag} locked={sent || excluded}
        include={!excluded && value(docIndex, index, 'include', row.include)} amount={value(docIndex, index, 'amount', row[field])}
        onToggle={(include) => change(docIndex, index, { include })} onAmount={(amount) => change(docIndex, index, { amount })}
      />
    );
  };

  return (
    <>
      {d.docs.map((doc, docIndex) => (
        <section className="j-tile" key={doc.hash}>
          <p className="j-eyebrow">{doc.kindLabel} · {doc.name}</p>
          <DocCheck check={doc.check} />
          {doc.kind === 'bank_statement' && (() => {
            const indexed = doc.transactions.map((row, index) => ({ row, index }));
            const moneyIn = indexed.filter(({ row }) => row.credit > 0);
            const moneyOut = indexed.filter(({ row }) => row.debit > 0 && ['emi', 'business'].includes(classifyDebit(row.description)));
            return (
              <>
                <p className="j-small j-muted">Money in: untick anything that is not your earning, or fix an amount MITRA misread.</p>
                <ul className="j-lines">{moneyIn.map(({ row, index }) => lineFor(docIndex, row, index))}</ul>
                {moneyOut.length > 0 && (
                  <details className="j-lines-more">
                    <summary>Money out MITRA takes into account ({moneyOut.length})</summary>
                    <ul className="j-lines">{moneyOut.map(({ row, index }) => lineFor(docIndex, row, index))}</ul>
                  </details>
                )}
              </>
            );
          })()}
          {doc.kind === 'payment_receipt' && (
            <ul className="j-lines">
              {doc.receipts.map((row, index) => {
                const twin = statementRows.some((line) => line.date === row.date && line.credit === row.credit);
                return (
                  <Line
                    key={index} row={row} locked={sent || twin}
                    tag={twin ? 'Already on your statement, so counted once' : STREAM_LABELS[row.stream]}
                    include={!twin && value(docIndex, index, 'include', row.include)} amount={value(docIndex, index, 'amount', row.credit)}
                    onToggle={(include) => change(docIndex, index, { include })} onAmount={(amount) => change(docIndex, index, { amount })}
                  />
                );
              })}
            </ul>
          )}
          {doc.declared.map((item) => (
            <Row key={item.source} label={item.source} value={`${inr(item.annual)} a year`} sub={`${inr(Math.round(item.annual / 12))} a month, ${item.kind === 'turnover' ? 'turnover declared for GST' : 'income declared for tax'}`} strong />
          ))}
        </section>
      ))}
      {d.failed?.map((doc) => <section key={doc.name} className="j-callout is-amber"><b>{doc.name}: not used.</b> {doc.problems.join(' ')}</section>)}
      <section className="j-tile j-rows">
        <p className="j-eyebrow">With the lines ticked now</p>
        {preview.basis === 'statements' && <Row label={`${preview.monthCount} months, ${preview.from} to ${preview.to}`} value={`${inr(preview.average)} average`} />}
        <Row label="Income MITRA would count" value={`${inr(preview.counted)} a month`} sub="From your weaker months, so an EMI still fits in a slow month" strong />
      </section>
      {!sent && (
        <div className="j-doc-actions">
          <button type="button" className="is-yes" onClick={() => { setSent(true); onIncome?.(true, editList); }}>Yes, use these lines</button>
          <button type="button" onClick={() => { setSent(true); onIncome?.(false); }}>No, do not use them</button>
        </div>
      )}
      <Foot>The files are not kept. Only their fingerprints and the lines you confirm go on your receipt, and only to check what you can afford.</Foot>
    </>
  );
}

// ── cash flow, month by month ───────────────────────────────────
function CashFlow({ sim }) {
  const months = sim.monthly.length ? sim.monthly : [{ label: 'A month', income: sim.counted, existing: sim.existingEmi, emi: sim.emi, left: sim.leftOver, tight: sim.band === 'stretch' }];
  const top = Math.max(...months.map((month) => month.income), 1);
  const share = (amount) => `${(Math.max(amount, 0) / top) * 100}%`;
  return (
    <div className="j-flow-wrap">
      <div className="j-flow" role="img" aria-label="Each month's income, split into existing EMIs, this loan's EMI and what is left">
        {months.map((month) => (
          <div key={month.label} className={`j-flow-col ${month.tight ? 'is-tight' : ''}`} title={`${month.label}: ${inr(month.income)} in, ${inr(month.left)} left after EMIs`}>
            <div className="j-flow-bar">
              <span className="is-left" style={{ height: share(month.left) }} />
              <span className="is-new" style={{ height: share(Math.min(month.emi, month.income - month.existing)) }} />
              <span className="is-old" style={{ height: share(month.existing) }} />
            </div>
            <small>{month.label.slice(0, 3)}</small>
            <small className={month.left < 0 ? 'is-red' : ''}>{inr(month.left)}</small>
          </div>
        ))}
      </div>
      <p className="j-flow-key"><i className="is-old" />EMIs you already pay <i className="is-new" />This loan <i className="is-left" />Left to live on{months.some((month) => month.tight) && <><i className="is-tight" />Tight month</>}</p>
    </div>
  );
}

export function Simulator({ profile, offer, start, onAsk }) {
  const [principal, setPrincipal] = useState(start?.principal ?? offer.principal);
  const [months, setMonths] = useState(start?.months ?? offer.months);
  const sim = useMemo(() => cashFlowWithLoan(profile, { principal, ratePct: offer.ratePct, months, feePct: offer.feePct }), [profile, principal, months, offer]);
  const maxAmount = Math.max(500000, Math.ceil((offer.principal * 2) / 50000) * 50000);
  const [bandLabel, bandClass] = BAND[sim.band] || [];
  return (
    <section className="j-tile j-sim">
      <p className="j-eyebrow">Try other terms: {pct(offer.ratePct)} a year, fees {pct(offer.feePct, 2)} of the amount, as in this offer</p>
      <label className="j-slider">
        <span>Amount <b>{inr(principal)}</b></span>
        <input type="range" min="10000" max={maxAmount} step="5000" value={principal} onChange={(event) => setPrincipal(Number(event.target.value))} />
      </label>
      <label className="j-slider">
        <span>Months <b>{months}</b></span>
        <input type="range" min="3" max="60" step="3" value={months} onChange={(event) => setMonths(Number(event.target.value))} />
      </label>
      <div className="j-compare">
        <div><span>Monthly EMI</span><b>{inr(sim.emi)}</b></div>
        <div><span>Total cost</span><strong>{inr(sim.totalCost)}</strong></div>
        <div><span>APR</span><strong>{pct(sim.aprPct)}</strong></div>
      </div>
      <div className="j-rows">
        <Row label="You receive" value={inr(sim.net)} sub={`after ${inr(sim.fees)} in fees`} />
        <Row label="Total you repay" value={inr(sim.totalRepay)} />
      </div>
      {bandLabel && (
        <p className={`j-band ${bandClass}`}>
          <b>{bandLabel}.</b> All your EMIs would be {pct(sim.sharePct)} of the {inr(sim.counted)} MITRA counts, leaving {inr(sim.leftOver)}.
          {sim.tightMonths > 0 && ` Tight in ${sim.tightMonths} of your months.`}
        </p>
      )}
      {sim.counted ? <CashFlow sim={sim} /> : <p className="j-small j-muted">Share your income papers to see this against your own months.</p>}
      <button type="button" className="j-sim-ask" onClick={() => onAsk?.(`What if I borrow ${inr(principal)} for ${months} months?`, { tapped: true })}>
        🔊 Explain these terms aloud, in my language
      </button>
    </section>
  );
}

// ── what the customer can afford ────────────────────────────────
export function AffordabilityCard({ data: d, onAsk }) {
  const { profile: p, offer, maxLoan } = d;
  const total = p.streams.reduce((sum, stream) => sum + stream.total, 0) || 1;
  const source = { statements: `From ${p.monthCount} months of your papers, ${p.from} to ${p.to}`, stated: 'From the income you told MITRA', declared: 'From your tax return only' }[p.basis];
  return (
    <>
      <PaperChecksNote checks={p.checks} />
      <section className="j-tile">
        <p className="j-eyebrow">{source}</p>
        <p className="j-hero">{inr(p.comfortableEmi)} a month</p>
        <p className="j-muted">is a comfortable EMI{p.existingEmi ? `, after the ${inr(p.existingEmi)} EMI you already pay` : ''}. The most MITRA calls safe is {inr(p.stretchEmi)}.</p>
        <div className="j-compare">
          {p.basis === 'statements' && <div><span>Average month</span><strong>{inr(p.average)}</strong></div>}
          <div><span>Income MITRA counts</span><b>{inr(p.counted)}</b></div>
          <div><span>Comfortable loan, {offer.months} months at {pct(offer.ratePct)}</span><strong>{inr(maxLoan)}</strong></div>
        </div>
        {p.basis === 'statements' && <p className="j-muted j-small">Income is {p.steadiness}: it moved between {inr(p.lowest)} and {inr(p.highest)}{p.trendPct != null ? `, ${p.trendPct >= 0 ? 'up' : 'down'} ${pct(Math.abs(p.trendPct))} lately` : ''}.</p>}
      </section>
      {p.streams.length > 0 && (
        <section className="j-tile">
          <p className="j-eyebrow">How you earn</p>
          <div className="j-streams" aria-hidden="true">{p.streams.map((stream) => <span key={stream.id} className={`is-${stream.id}`} style={{ width: `${(stream.total / total) * 100}%` }} />)}</div>
          <div className="j-rows">{p.streams.map((stream) => <Row key={stream.id} label={<><i className={`j-dot is-${stream.id}`} />{stream.label}</>} value={`${inr(stream.monthly)} a month`} sub={`${stream.count} payments, ${pct(stream.sharePct)}`} />)}</div>
          {p.business > 0 && <Row label="Stock and supplies" value={`− ${inr(p.business)} a month`} sub="Taken off sales, so MITRA counts what you keep" />}
        </section>
      )}
      {p.declared.map((item) => (
        <section key={item.source} className={`j-callout ${item.flagged ? 'is-amber' : 'is-green'}`}>
          <b>{item.source}:</b> {inr(item.monthly)} a month declared.{' '}
          {item.gapPct == null ? 'There is no statement to compare it with.' : item.flagged
            ? `Your bank shows ${inr(item.observed)}, ${pct(Math.abs(item.gapPct))} ${item.gapPct > 0 ? 'more' : 'less'}. A lender will ask about the difference, so keep both papers ready.`
            : `Your bank shows ${inr(item.observed)}, close enough that the two papers back each other up.`}
        </section>
      ))}
      {p.excluded.length > 0 && (
        <section className="j-tile j-rows">
          <p className="j-eyebrow">Money in that MITRA did not count</p>
          {p.excluded.map((item) => <Row key={`${item.date}${item.description}`} label={item.description} value={inr(item.amount)} sub={item.why} />)}
        </section>
      )}
      <Simulator profile={p} offer={offer} onAsk={onAsk} />
      <Foot>{p.assumption} Nothing is signed here.</Foot>
    </>
  );
}

export function SimulatorCard({ data: d, onAsk }) {
  const { sim, base } = d;
  return (
    <>
      <section className="j-tile">
        <p className="j-eyebrow">{inr(sim.principal)} over {sim.months} months, against the offer of {inr(base.principal)} over {base.months}</p>
        <div className="j-compare">
          <div><span>EMI, against the offer's {inr(base.emi)}</span><b>{inr(sim.emi)}</b></div>
          <div><span>Total cost, against {inr(base.totalCost)}</span><strong>{inr(sim.totalCost)}</strong></div>
        </div>
      </section>
      <Simulator key={`${sim.principal}-${sim.months}`} profile={d.profile} offer={d.offer} start={{ principal: sim.principal, months: sim.months }} onAsk={onAsk} />
      <Foot>Fees are assumed at the same share of the amount as this offer. MITRA explains. You decide. Nothing is signed here.</Foot>
    </>
  );
}
