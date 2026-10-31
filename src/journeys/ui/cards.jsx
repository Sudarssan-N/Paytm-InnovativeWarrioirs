import React from 'react';
import { fmtDate, inr, pct } from '../money.js';
import { Foot, Row } from './cardParts.jsx';
import { AffordabilityCard, IncomeReadCard, SimulatorCard } from './LoanClarity.jsx';
import { InsightsCard } from './PaytmInsights.jsx';
import { DocCheck, PaperChecksNote } from './DocCheck.jsx';

function LoanCard({ data: d, onPlay }) {
  return (
    <>
      {onPlay && (
        <button type="button" className="j-play-cta" onClick={() => onPlay('karz', d)}>
          <i aria-hidden="true">🛺</i>
          <span><b>Drive this loan</b><small>See where every rupee goes, in a 60-second game</small></span>
        </button>
      )}
      <section className="j-tile">
        <p className="j-eyebrow">{d.product} from {d.lender}</p>
        <p className="j-hero">{inr(d.principal)}</p>
        <p className="j-muted">for {d.months} months</p>
        <div className="j-compare">
          <div><span>Rate shown</span><s>{pct(d.ratePct)}</s></div>
          <div><span>Real yearly cost (APR)</span><b>{pct(d.aprPct)}</b></div>
        </div>
      </section>
      {d.documentCheck && d.documentCheck.verdict !== 'clean' && (
        <section className="j-callout is-amber" role="status"><b>{d.documentCheck.headline}.</b> This comes from your own paper, which had a warning when it was read. The lender may not hold to these terms, and this explanation may not be accurate.</section>
      )}
      <PaperChecksNote checks={d.paperChecks} />
      {d.statedApr != null && (
        <section className="j-callout is-amber">
          <b>The page and the numbers disagree.</b> The document states an APR of {pct(d.statedApr)}. Counting every charge on it, MITRA gets {pct(d.aprPct)}. A person should check this with the lender.
        </section>
      )}
      <section className="j-tile j-rows">
        <Row label="You receive" value={inr(d.net)} sub={d.fees ? `after ${inr(d.processingFee)} fee + ${inr(d.gstOnFee)} GST${d.otherCharges ? ` + ${inr(d.otherCharges)} other` : ''}` : 'fees not stated'} strong />
        <Row label="Monthly EMI" value={inr(d.emi)} strong />
        <Row label="Total you repay" value={inr(d.totalRepay)} strong />
        <Row
          label={d.incomeFromPapers ? 'All your EMIs vs your income' : 'EMI vs your income'}
          value={d.fit ? `${d.sharePct}%` : 'Not checked'}
          sub={d.fit ? (d.incomeFromPapers ? `of ${inr(d.income)} counted from your papers, with ${inr(d.obligations)} you already pay` : `of ${inr(d.income)} a month`) : 'Share your income or your bank statements to check this'}
          strong={Boolean(d.fit)}
        />
      </section>
      {d.charges?.length > 0 && (
        <section className="j-tile j-rows">
          <p className="j-eyebrow">Charges to watch before you sign</p>
          {d.charges.map((charge) => <Row key={charge.label} label={charge.label} value={charge.value} sub={charge.note} strong={!charge.known} />)}
        </section>
      )}
      {d.schedule?.length > 0 && (
        <section className="j-tile">
          <p className="j-eyebrow">Where your EMIs go, year by year</p>
          <table className="j-doc-table">
            <thead><tr><th>Year</th><th>Interest</th><th>Repays the loan</th><th>Still owed</th></tr></thead>
            <tbody>{d.schedule.map((year) => <tr key={year.year}><td>{year.year}</td><td>{inr(year.interest)}</td><td><b>{inr(year.principal)}</b></td><td>{inr(year.balance)}</td></tr>)}</tbody>
          </table>
          <p className="j-muted j-small">Early EMIs are mostly interest. That is why closing early saves the most in the first year.</p>
        </section>
      )}
      {d.coolingOffDays != null && (
        <section className="j-callout is-amber">
          <b>Cooling-off period:</b> you have {d.coolingOffDays} days after signing to exit without penalty. MITRA reminds you before it ends.
        </section>
      )}
      {d.ownNumbers && <section className="j-callout is-amber"><b>From your own numbers.</b> This is not a lender’s Key Fact Statement. Fees you did not mention are not counted.</section>}
      <Foot />
    </>
  );
}

function GapCard({ data: d, onPlay }) {
  const Block = ({ title, item, note }) => (
    <section className="j-tile">
      <p className="j-eyebrow">{title}</p>
      <div className="j-gap">
        <div><span>You need</span><b>{inr(item.target)}</b></div>
        <div><span>You have</span><b>{inr(item.existing)}</b></div>
        <div className="is-gap"><span>The gap</span><b>{inr(item.gap)}</b></div>
      </div>
      {note && <p className="j-muted j-small">{note}</p>}
    </section>
  );
  return (
    <>
      {onPlay && (
        <button type="button" className="j-play-cta" onClick={() => onPlay('term', d)}>
          <i aria-hidden="true">🧱</i>
          <span><b>See it as a story: Kal Ka Ghar</b><small>Your numbers, in a block world, with a voice. Three minutes.</small></span>
        </button>
      )}
      <Block title="Life cover" item={d.life} note={`${d.multiple} × yearly income of ${inr(d.annualIncome)}`} />
      <Block title="Health cover" item={d.health} note={`Target for ${d.city || 'your city'}`} />
      <p className="j-card-foot">{d.assumption}</p>
    </>
  );
}

function PlansCard({ data: d, onPlay }) {
  return (
    <>
      {onPlay && (
        <button type="button" className="j-play-cta" onClick={() => onPlay('term')}>
          <i aria-hidden="true">🧱</i>
          <span><b>See it as a story: Kal Ka Ghar</b><small>What a term plan really does, with a voice. Three minutes.</small></span>
        </button>
      )}
      <div className="j-plans">
        {d.plans.map((plan) => (
          <section className="j-tile" key={plan.id}>
            <p className="j-eyebrow">{plan.type}</p>
            <p className="j-plan-price">{inr(plan.cover)}</p>
            <p className="j-muted j-small">cover, {inr(plan.premiumYear)} a year</p>
            <p className="j-plan-line"><b>Pays:</b> {plan.pays}</p>
            <p className="j-plan-line"><b>Watch for:</b> {plan.watch}</p>
            {plan.waitingMonths > 0 && <p className="j-tag">{plan.waitingMonths} month wait</p>}
          </section>
        ))}
      </div>
      <p className="j-card-foot">{d.note}</p>
    </>
  );
}

function WindowCard({ data: d }) {
  return (
    <>
      <section className="j-tile j-window">
        <p className="j-eyebrow">{d.policyName}</p>
        <p className="j-hero">{d.open ? `${d.daysLeft} days left` : 'Window closed'}</p>
        <p className="j-muted">in your {d.days} day free-look, until {d.endsLabel}</p>
      </section>
      <section className="j-tile j-rows">
        <Row label="Policy received" value={fmtDate(d.receivedOn)} />
        <Row label="Reminder" value={d.remindLabel} strong />
        <Row label="Premium paid" value={inr(d.premium)} />
      </section>
      <section className="j-callout is-amber">{d.refundNote}</section>
    </>
  );
}

function CoolingCard({ data: d }) {
  return (
    <>
      <section className="j-tile j-window">
        <p className="j-eyebrow">Loan cooling-off</p>
        <p className="j-hero">{d.signed ? (d.open ? `${d.daysLeft} days left` : 'Window closed') : `${d.days} days`}</p>
        <p className="j-muted">{d.signed ? `until ${d.endsLabel}` : 'starting from the day you sign'}</p>
      </section>
      {d.signed && (
        <section className="j-tile j-rows">
          <Row label="To exit, you repay about" value={inr(d.exitCost)} sub="principal and interest for the days held, no penalty" strong />
          <Row label="Reminder" value={d.remindLabel} strong />
        </section>
      )}
      <Foot />
    </>
  );
}

function ChecklistCard({ data: d }) {
  return (
    <>
      <section className="j-tile">
        <p className="j-eyebrow">Documents for your claim</p>
        <ul className="j-check">
          {d.docs.map((doc) => <li key={doc.id} className={doc.have ? 'is-have' : ''}><i aria-hidden="true">{doc.have ? '✓' : ''}</i>{doc.label}</li>)}
        </ul>
      </section>
      <section className={`j-callout ${d.late ? 'is-red' : 'is-amber'}`}>
        <b>{d.late ? 'The date has passed:' : 'Send by:'}</b> {d.documentsByLabel}. {d.late ? 'Send what you have, with a note saying why it is late.' : `${d.daysLeft} days left.`}
      </section>
      <section className="j-tile j-rows">
        <p className="j-eyebrow">Claim intimation, pre-filled</p>
        <Row label="Policy" value={d.intimation.policyNumber} />
        <Row label="Patient" value={d.intimation.patient} />
        <Row label="Hospital" value={d.intimation.hospital} />
        <Row label="Status" value={d.intimation.status} strong />
      </section>
    </>
  );
}

function ClaimCard({ data: d }) {
  return (
    <>
      <section className="j-tile">
        <div className="j-compare">
          <div><span>Billed</span><strong>{inr(d.billed)}</strong></div>
          <div><span>Insurer paid</span><strong>{inr(d.paid)}</strong></div>
          <div><span>Looks wrong</span><b className="is-red">{inr(d.shortBy)}</b></div>
        </div>
      </section>
      <section className="j-tile j-claim">
        {d.lines.map((line) => (
          <article key={line.id} className={line.status === 'looks-wrong' ? 'is-flagged' : ''}>
            <header>
              <span>{line.head}</span>
              <span className="j-claim-nums">{inr(line.billed)} billed, {inr(line.paid)} paid</span>
            </header>
            <p>{line.why}</p>
            {line.status === 'looks-wrong' && <p className="j-claim-short">Should be {inr(line.allowed)}, short by {inr(line.shortBy)}</p>}
            <p className="j-claim-clause">{line.clause}</p>
          </article>
        ))}
      </section>
    </>
  );
}

function GrievanceCard({ data: d }) {
  return (
    <>
      <section className="j-letter">
        <span className="j-letter-stamp">{d.status}</span>
        {d.body.map((line) => <p key={line}>{line}</p>)}
      </section>
      <section className="j-callout is-amber"><b>What happens next:</b> the insurer has {d.firstComplaintDays} days, until {d.respondByLabel}. If unresolved: {d.route}.</section>
    </>
  );
}

function RiskCard({ data: d }) {
  const banner = { stop: 'Do not pay', caution: 'Pause and check', clear: 'No red flags found' }[d.verdict];
  return (
    <>
      <section className={`j-verdict is-${d.verdict}`}>
        <p className="j-verdict-title">{banner}</p>
        <p>Offer X-Ray checked this before the PIN screen. Safety score {d.score} of 100.</p>
      </section>
      {d.flags.length > 0 && (
        <section className="j-tile j-flags">
          {d.flags.map((flag) => <article key={flag.id}><b>{flag.label}</b><p>{flag.why}</p></article>)}
        </section>
      )}
      <section className={`j-callout ${d.verdict === 'stop' ? 'is-red' : 'is-amber'}`}>{d.action}</section>
      <section className="j-tile j-quoted"><p className="j-eyebrow">What was checked</p><p>“{d.checkedText}”</p></section>
    </>
  );
}

function MerchantCard({ data: d }) {
  return (
    <>
      <section className="j-tile">
        <p className="j-eyebrow">From {d.eligibility.monthCount} months of Soundbox sales</p>
        <p className="j-hero">{inr(d.eligibility.limit)}</p>
        <p className="j-muted">possible limit, on {inr(d.eligibility.averageMonthly)} average monthly sales</p>
      </section>
      <section className="j-tile">
        <p className="j-eyebrow">{d.product}, {inr(d.principal)} for {d.days} days</p>
        <div className="j-compare">
          <div><span>You pay daily</span><strong>{inr(d.dailyRepayment)}</strong></div>
          <div><span>Real yearly cost (APR)</span><b>{pct(d.aprPct)}</b></div>
        </div>
      </section>
      <section className="j-tile j-rows">
        <Row label="You receive" value={inr(d.net)} sub={`after ${inr(d.fee)} fee + ${inr(d.gst)} GST`} strong />
        <Row label="Total you repay" value={inr(d.totalRepay)} strong />
        <Row label="Share of daily sales" value={pct(d.shareOfDailySales)} sub={`of about ${inr(d.averageDaily)} a day`} strong />
      </section>
      <Foot>MITRA explains. The partner lender decides. Nothing is signed here.</Foot>
    </>
  );
}

function ApplicationCard({ data: d }) {
  return (
    <>
      <section className="j-tile j-window">
        <p className="j-eyebrow">Fields MITRA filled from this call</p>
        <p className="j-hero">{d.filled.length} of {d.filled.length + d.left.length}</p>
        <p className="j-muted">“{d.words}”</p>
      </section>
      <section className="j-tile j-rows">
        {d.filled.map(([label, value]) => <Row key={label} label={label} value={value} strong />)}
        {d.left.map((label) => <Row key={label} label={label} value="You enter this on the lender’s page" />)}
      </section>
      <section className="j-callout is-amber">{d.status}</section>
      <Foot>MITRA prepares. You sign with the lender. Nothing is signed here.</Foot>
    </>
  );
}

function LenderBriefCard({ data: d }) {
  return (
    <>
      <section className="j-tile j-window">
        <p className="j-eyebrow">Time from intent to application</p>
        <p className="j-hero">{d.seconds} seconds</p>
        <p className="j-muted">no form filled</p>
      </section>
      <section className="j-tile j-rows">
        <Row label="Merchant" value={d.merchant} />
        <Row label="Amount" value={inr(d.amount)} strong />
        {d.averageMonthly && <Row label="Average monthly sales" value={inr(d.averageMonthly)} />}
      </section>
      <section className="j-callout is-amber">{d.status}</section>
    </>
  );
}

export function HandoffBrief({ brief }) {
  return (
    <section className="j-brief">
      <header>
        <div><b>Handoff brief</b><span>{brief.id}</span></div>
        <span className="j-brief-when">{brief.status === 'closed' ? 'Closed' : brief.callback}</span>
      </header>
      <dl>
        <div><dt>Customer</dt><dd>{brief.customer}</dd></div>
        <div><dt>Journey</dt><dd>{brief.journey}</dd></div>
        <div><dt>They asked</dt><dd>“{brief.asked.english}”{brief.asked.original !== brief.asked.english && <small>{brief.asked.original}</small>}</dd></div>
        {brief.explained.length > 0 && <div><dt>Already explained</dt><dd>{brief.explained.join('; ')}</dd></div>}
        <div><dt>Why a person</dt><dd>{brief.why}</dd></div>
        <div><dt>Consent</dt><dd>{brief.consent}</dd></div>
        <div><dt>Suggested next step</dt><dd>{brief.next}</dd></div>
        {brief.linkedPassport && <div><dt>Linked record</dt><dd className="j-mono">Journey Passport {brief.linkedPassport}</dd></div>}
        {brief.notes && <div><dt>Expert notes</dt><dd>{brief.notes}</dd></div>}
      </dl>
    </section>
  );
}

function ConsentsCard({ data: d }) {
  return (
    <section className="j-tile j-rows">
      <p className="j-eyebrow">{d.revoked ? 'Withdrawn' : 'What you have agreed to'}</p>
      {d.revoked && <Row label={d.revoked.label} value="Withdrawn" strong />}
      {d.live.map((grant) => <Row key={grant.id} label={grant.label} value={`until ${fmtDate(grant.expiresOn)}`} />)}
      {!d.live.length && !d.revoked && <p className="j-muted">Nothing shared yet.</p>}
    </section>
  );
}

function AskCard({ data: d }) {
  const purpose = { loan_eligibility: 'Loan eligibility', insurance_needs: 'Working out insurance needs', merchant_credit: 'Working capital eligibility', business_insights: 'Profiling your business', affordability: 'Checking what you can afford' }[d.purpose] || d.purpose;
  return (
    <section className="j-tile j-rows">
      <p className="j-eyebrow">{d.mode === 'consent' ? 'Already known, so MITRA asks permission only' : 'Asked once, reused by every agent'}</p>
      <Row label="MITRA is asking for" value={d.field} strong />
      <Row label="Used only for" value={purpose} />
      <Row label="For how long" value="30 days" />
      <Row label="Can you withdraw it?" value="Any time, with one sentence" />
    </section>
  );
}

function NoteCard({ data: d }) {
  return <section className={`j-callout is-${d.tone === 'warn' ? 'amber' : d.tone === 'ok' ? 'green' : 'blue'}`}><b>{d.title}</b><p>{d.body}</p></section>;
}

function PrepayCard({ data: d }) {
  return (
    <>
      <section className="j-tile">
        <p className="j-eyebrow">If you have {inr(d.extra)} spare</p>
        <div className="j-compare">
          <div><span>Prepay: saves, for certain</span><strong>{inr(d.interestSaved)}</strong></div>
          <div><span>Invest at an assumed {pct(d.investReturnPct)}: could earn</span><strong>{inr(d.investGain)}</strong></div>
        </div>
        <p className="j-muted j-small">Prepaying also ends the loan {d.monthsSaved} months sooner.</p>
      </section>
      <p className="j-card-foot">{d.assumption}</p>
    </>
  );
}

function ClosedCard({ data: d }) {
  return (
    <>
      <section className="j-tile j-window"><p className="j-hero">Call closed</p><p className="j-muted">Your record is sealed and yours to keep.</p></section>
      {d.reminders.length > 0 && <section className="j-tile j-rows"><p className="j-eyebrow">Reminders</p>{d.reminders.map((item) => <Row key={item.id} label={item.label} value={fmtDate(item.on)} />)}</section>}
      {d.explained.length > 0 && <section className="j-tile"><p className="j-eyebrow">Covered on this call</p><ul className="j-plain">{d.explained.map((line) => <li key={line}>{line}</li>)}</ul></section>}
    </>
  );
}

function MenuCard({ data: d, onAsk }) {
  const items = d?.merchant
    ? [['Working capital', 'From Soundbox sales, no 12-field form', 'I need money for stock for my shop'], ['Check a payment', 'Before you enter your PIN', 'Is this message a scam? Pay ₹2,999 processing fee to pmloan.help@ybl within 2 hours']]
    : [
      ['Take a loan you understand', 'The real cost, before you sign', 'What does this loan really cost?'],
      ['Buy the right cover', 'How much you need, in plain words', 'How much insurance do I need?'],
      ['File a claim by voice', 'Every deduction explained', 'My claim was cut, why?'],
      ['Catch a scam before the PIN', 'Offer X-Ray', 'Is this message a scam? Your PM Loan of ₹5,00,000 is approved. Pay ₹2,999 processing fee to pmloan.help@ybl within 2 hours to release it.'],
    ];
  return (
    <div className="j-menu">
      {items.map(([title, blurb, prompt]) => (
        <button type="button" key={title} onClick={() => onAsk?.(prompt)}><b>{title}</b><span>{blurb}</span></button>
      ))}
    </div>
  );
}

const CARDS = {
  loan: { title: 'Loan offer, explained', Body: LoanCard },
  gap: { title: 'Your protection gap', Body: GapCard },
  plans: { title: 'Plan types, in plain words', Body: PlansCard },
  window: { title: 'Free-look window', Body: WindowCard },
  cooling: { title: 'Cooling-off window', Body: CoolingCard },
  checklist: { title: 'Your claim checklist', Body: ChecklistCard },
  claim: { title: 'Every deduction, explained', Body: ClaimCard },
  grievance: { title: 'Grievance draft', Body: GrievanceCard },
  risk: { title: 'Offer X-Ray', Body: RiskCard },
  merchant: { title: 'Working capital, explained', Body: MerchantCard },
  lenderBrief: { title: 'Ready for the lender', Body: LenderBriefCard },
  insights: { title: 'Your business, profiled', Body: InsightsCard },
  application: { title: 'Your application, pre-filled', Body: ApplicationCard },
  handoff: { title: 'Passed to a person', Body: ({ data }) => <HandoffBrief brief={data} /> },
  consents: { title: 'Your consents', Body: ConsentsCard },
  ask: { title: 'One question', Body: AskCard },
  note: { title: 'A straight answer', Body: NoteCard },
  prepay: { title: 'Prepay or invest', Body: PrepayCard },
  closed: { title: 'Journey closed', Body: ClosedCard },
  menu: { title: 'What MITRA can do', Body: MenuCard },
  arcade: { title: 'Learn by playing', Body: ArcadeCard },
  promises: { title: 'Promise Check: what the agent said', Body: PromisesCard },
  document: { title: 'What MITRA read from your document', Body: DocumentCard },
  incomeRead: { title: 'What MITRA read from your income papers', Body: IncomeReadCard },
  affordability: { title: 'What you can safely afford', Body: AffordabilityCard },
  simulator: { title: 'Other terms, tried out', Body: SimulatorCard },
};

function DocumentCard({ data: d, onDocument }) {
  return (
    <>
      <section className="j-tile">
        <p className="j-eyebrow">{d.lender} · read by Sarvam Vision in {(d.ms / 1000).toFixed(1)} s</p>
        <table className="j-doc-table">
          <thead><tr><th>On your page</th><th>MITRA read</th><th>Sure?</th></tr></thead>
          <tbody>
            {d.rows.map((row) => (
              <tr key={row.field} className={row.confidence != null && row.confidence < 0.8 ? 'is-unsure' : ''}>
                <td>{row.label}</td><td><b>{row.value}</b></td><td>{row.confidence != null ? `${Math.round(row.confidence * 100)}%` : '–'}{row.page ? ` · p${row.page}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {d.checks?.map((check) => <section key={check.field} className="j-callout is-amber"><b>Does not add up.</b> {check.text}</section>)}
      <DocCheck check={d.documentCheck} />
      {d.usable && !d.settled && (
        <div className="j-doc-actions">
          <button type="button" className="is-yes" onClick={() => onDocument?.(true)}>Yes, that is what it says</button>
          <button type="button" onClick={() => onDocument?.(false)}>No, something is wrong</button>
        </div>
      )}
      <Foot>The file is not kept. Only its fingerprint and the figures you confirm go on your receipt.</Foot>
    </>
  );
}

const VERDICT = {
  contradicted: ['Does not match', 'is-bad'], half_truth: ['Half the truth', 'is-warn'], pressure: ['Pressure', 'is-warn'], matches: ['Matches', 'is-good'], unknown: ['Not on paper', ''],
};
const stamp = (seconds) => (seconds == null ? '' : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`);

function PromisesCard({ data: d }) {
  return (
    <>
      <section className="j-tile">
        <p className="j-eyebrow">Heard {d.turns.length} turns from two voices in {(d.ms / 1000).toFixed(1)} s</p>
        <p className="j-hero">{d.broken} of {d.total}</p>
        <p className="j-muted">promises do not match your papers</p>
      </section>
      <ul className="j-promises">
        {d.rows.map((row) => {
          const [label, tone] = VERDICT[row.verdict] || VERDICT.unknown;
          return (
            <li key={row.kind} className="j-tile">
              <p className="j-promise-head"><b>{row.label}</b><span className={`j-verdict ${tone}`}>{label}</span></p>
              <blockquote>“{row.quote}”{row.at != null && <small> at {stamp(row.at)}</small>}</blockquote>
              {row.english && row.english !== row.quote && <p className="j-gloss">{row.english}</p>}
              <p className="j-promise-paper"><b>Your papers say:</b> {row.paper}</p>
            </li>
          );
        })}
      </ul>
      {d.freeLookDaysLeft > 0 && <section className="j-callout is-green"><b>You still have {d.freeLookDaysLeft} days</b> to return the policy, until {d.freeLookEnds}.</section>}
      <Foot>Only upload a call you were part of. MITRA does not keep the audio. The sealed receipt holds the quotes and a fingerprint.</Foot>
    </>
  );
}

function ArcadeCard({ data: d, onPlay }) {
  return (
    <button type="button" className="j-play-cta" onClick={() => onPlay?.(d.game)}>
      <i aria-hidden="true">{{ karz: '🛺', term: '🧱', scam: '🛡', claim: '🔍' }[d.game]}</i>
      <span><b>{{ karz: 'Karz Yatra: drive your loan', term: 'Kal Ka Ghar: what a term plan really does', scam: 'Scam Shield: block the trap', claim: 'Claim Detective: find the unfair cut' }[d.game]}</b><small>Uses the same numbers as this call</small></span>
    </button>
  );
}

export function ResultCard({ card, onAsk, onPlay, onDocument, onIncome }) {
  const spec = CARDS[card?.type];
  if (!spec) return null;
  const { Body, title } = spec;
  return (
    <div className="j-result" key={card.key}>
      <h2>{title}</h2>
      <Body data={card.data} onAsk={onAsk} onPlay={onPlay} onDocument={onDocument} onIncome={onIncome} />
    </div>
  );
}
