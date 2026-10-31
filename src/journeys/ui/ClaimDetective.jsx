import React, { useEffect, useMemo, useState } from 'react';
import { explainDeductions } from '../engines/claims.js';
import { inr } from '../money.js';
import { CLAIM, POLICY_WORDING } from '../sampleData.js';
import { beep, sealUnderstanding, speakLine, stopLine, useLines } from './arcadeShared.js';

const LABELS = {
  lead: 'The insurer cut this hospital bill. Some cuts follow the policy, and some do not. Tap every line you think was cut unfairly.',
  head: 'Bill item', billed: 'Billed', paid: 'Paid', mark: 'Looks wrong', ok: 'Looks fair', check: 'Open the case', again: 'Try again', owed: 'You found', rule: 'Why', draft: 'Draft the grievance with MITRA',
  correct: 'Right', missed: 'Missed', falseFlag: 'This cut was fair', sealed: 'Sealed on your Journey Passport', total: 'Money you are owed',
};

export default function ClaimDetective({ lang = 'en', sessionId = null, onSealed, onAsk }) {
  const analysis = useMemo(() => explainDeductions({ claim: CLAIM, wording: POLICY_WORDING }), []);
  const [marked, setMarked] = useState([]);
  const [open, setOpen] = useState(false);
  const [sealed, setSealed] = useState(null);
  const labels = useLines(lang, LABELS);
  const heads = useLines(lang, useMemo(() => Object.fromEntries(analysis.lines.map((line) => [line.id, line.head])), [analysis]));
  const whys = useLines(lang, useMemo(() => Object.fromEntries(analysis.lines.map((line) => [line.id, line.why])), [analysis]));
  const found = analysis.lines.filter((line) => marked.includes(line.id) && line.status === 'looks-wrong').reduce((total, line) => total + line.shortBy, 0);

  const toggle = (id) => { if (!open) { beep(600, 0.04, 'triangle', 0.02); setMarked((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id])); } };

  const solve = async () => {
    setOpen(true);
    const perfect = analysis.flagged.every((id) => marked.includes(id)) && marked.every((id) => analysis.flagged.includes(id));
    beep(perfect ? 880 : 300, 0.2, perfect ? 'sine' : 'triangle', 0.04);
    const line = perfect ? `You found it. The insurer owes ${inr(analysis.shortBy)}. ${analysis.lines.find((item) => item.status === 'looks-wrong').why}` : `The insurer owes ${inr(analysis.shortBy)}. ${analysis.lines.find((item) => item.status === 'looks-wrong').why}`;
    speakLine(line, 'en');
    try {
      const out = await sealUnderstanding(sessionId, { game: 'claim', answers: marked });
      setSealed(out);
      onSealed?.(out);
    } catch { /* the game still works without a receipt */ }
  };
  useEffect(() => () => stopLine(), []);

  return (
    <div className="kg-panel cd">
      <h2>Claim Detective</h2>
      <p className="kg-lead">{labels.lead}</p>
      <div className="cd-bill" role="table" aria-label="Claim Detective">
        <p className="cd-hospital">{CLAIM.hospital} · {CLAIM.days} days · {CLAIM.id}</p>
        <div className="cd-row cd-head" role="row"><span role="columnheader">{labels.head}</span><span role="columnheader">{labels.billed}</span><span role="columnheader">{labels.paid}</span><span role="columnheader" /></div>
        {analysis.lines.map((line) => {
          const isMarked = marked.includes(line.id);
          const wrong = line.status === 'looks-wrong';
          return (
            <div key={line.id} role="row" className={`cd-row ${isMarked ? 'is-marked' : ''} ${open ? (wrong ? 'is-wrong' : 'is-fair') : ''}`}>
              <span role="cell" lang={lang}>{heads[line.id]}</span>
              <span role="cell">{inr(line.billed)}</span>
              <span role="cell">{inr(line.paid)}</span>
              <span role="cell">
                {!open && <button type="button" aria-pressed={isMarked} onClick={() => toggle(line.id)}>{isMarked ? `🔍 ${labels.mark}` : labels.ok}</button>}
                {open && <b>{wrong ? (isMarked ? `✓ ${labels.correct}` : `! ${labels.missed}`) : isMarked ? labels.falseFlag : '✓'}</b>}
              </span>
              {open && <p className="cd-why" lang={lang}>{whys[line.id]}{wrong && <> <b>+{inr(line.shortBy)}</b></>}<small>{line.clause}</small></p>}
            </div>
          );
        })}
      </div>
      {open ? (
        <>
          <p className="cd-total"><span>{labels.total}</span><b>{inr(analysis.shortBy)}</b><small>{labels.owed} {inr(found)}</small></p>
          {sealed?.passport && <section className="kg-receipt"><p className="kg-receipt-head">{labels.sealed}</p><p><code>{sealed.passport.id}</code></p></section>}
          <div className="kg-actions">
            {onAsk && <button type="button" className="kg-go" onClick={() => onAsk('Draft the grievance')}>{labels.draft}</button>}
            <button type="button" onClick={() => { setOpen(false); setMarked([]); setSealed(null); stopLine(); }}>{labels.again}</button>
          </div>
        </>
      ) : <button type="button" className="kg-go" onClick={solve}>{labels.check}</button>}
    </div>
  );
}
