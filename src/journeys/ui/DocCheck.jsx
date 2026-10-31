import React from 'react';
import './doc-check.css';

const ICON = { ok: '✓', warn: '!', bad: '!' };

// The check on one paper: the verdict, why, and what passed. Tone always comes with
// an icon and words, never colour alone.
export function DocCheck({ check }) {
  if (!check) return null;
  const clean = check.verdict === 'clean';
  return (
    <div className={`dc dc-${check.tone}`} role="status">
      <p className="dc-head"><span className="dc-icon" aria-hidden="true">{ICON[check.tone]}</span><b>{check.headline}</b></p>
      {!clean && <p className="dc-warning">{check.warning}</p>}
      {check.flags.length > 0 && (
        <ul className="dc-flags">
          {check.flags.map((item) => <li key={item.id} className={`is-${item.severity}`}>{item.label !== check.headline && <b>{item.label}. </b>}{item.text}</li>)}
        </ul>
      )}
      {check.passed.length > 0 && (
        <details className="dc-passed">
          <summary>What passed ({check.passed.length})</summary>
          <ul>{check.passed.map((text) => <li key={text}>{text}</li>)}</ul>
        </details>
      )}
      {!clean && <p className="dc-foot">MITRA cannot prove a paper is genuine or forged. Only the bank or the tax portal can. You can still use it, or share a fresh copy from the source.</p>}
    </div>
  );
}

// On an answer worked out from papers that had warnings.
export function PaperChecksNote({ checks }) {
  if (!checks?.length) return null;
  return (
    <section className="j-callout is-amber dc-note" role="status">
      <b>Worked out from {checks.length === 1 ? 'a paper' : 'papers'} with a warning.</b>
      <p>{checks.map((item) => `${item.name}: ${item.headline.toLowerCase()}`).join('. ')}. A lender may reject {checks.length === 1 ? 'it' : 'them'}, and these figures may not be accurate.</p>
    </section>
  );
}
