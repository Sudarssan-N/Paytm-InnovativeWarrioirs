// Document checks: genuine papers pass, changed or stale ones are flagged with the
// reason, and the warning follows every answer worked out from them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CASES, runCases } from '../scripts/doc-check-cases.mjs';
import { fileForensics } from '../server/documentForensics.mjs';
import { checkLine, checksCarried, sameName, summarise, verdictFor } from '../src/journeys/engines/docCheck.js';
import { parseBalance } from '../src/journeys/incomeRead.js';
import { createSession, takeTurn } from '../src/journeys/orchestrator.js';
import { recordFact, grantConsent } from '../src/journeys/consent.js';

const NOW = Date.parse('2026-10-31T10:00:00Z');
const results = runCases();

for (const item of CASES) {
  test(`eval: ${item.id}`, () => {
    const result = results.find((row) => row.id === item.id);
    assert.equal(result.got, item.expect, `flags: ${result.flags.join(', ')}`);
    if (item.flag) assert.ok(result.flags.includes(item.flag), `expected ${item.flag} among ${result.flags.join(', ')}`);
  });
}

test('no genuine sample paper raises a warning', () => {
  assert.deepEqual(results.filter((row) => row.group === 'genuine' && row.got !== 'clean').map((row) => row.id), []);
});

test('a file that is not what it says is noticed, and a broken file is not a crash', () => {
  const png = readFileSync('public/samples/sample-rider-receipt-payout.png');
  const found = fileForensics(png, { mime: 'application/pdf' });
  assert.equal(found.mismatch, true);
  assert.equal(found.formatLabel, 'PNG image');
  assert.equal(fileForensics(Buffer.from('not a document'), { mime: 'application/pdf' }).format, 'unknown');
});

test('an overdrawn balance reads as negative', () => {
  assert.equal(parseBalance('1,200.50 Dr'), -1200.5);
  assert.equal(parseBalance('₹3,400.00 Cr'), 3400);
  assert.equal(parseBalance(''), null);
});

test('names match across initials and titles, not across people', () => {
  assert.ok(sameName('Ramesh K.', 'RAMESH KUMAR'));
  assert.ok(sameName('Mr. Ramesh Kumar', 'Ramesh K'));
  assert.ok(!sameName('Ramesh K.', 'Suresh Babu'));
  assert.ok(!sameName('Ramesh K.', 'Ramesh Suresh'), 'a different surname initial is a different person');
});

test('the worst reason decides, and "clean" never claims a paper is genuine', () => {
  const low = { id: 'photo', category: 'quality', label: 'Hard to verify', severity: 'low', text: '' };
  assert.equal(verdictFor([low]).verdict, 'clean');
  assert.equal(verdictFor([]).headline, 'No warning signs found');
  assert.equal(verdictFor([{ ...low, category: 'expired', label: 'Out of date', severity: 'medium' }, { ...low, category: 'edited', severity: 'medium' }]).verdict, 'expired');
  assert.equal(verdictFor([{ ...low, category: 'edited', label: 'Signs of editing', severity: 'high' }]).headline, 'Signs of editing');
});

test('the spoken warning says a lender may reject the paper and the analysis may be wrong', () => {
  const check = summarise({ flags: [{ id: 'editor', category: 'edited', label: 'Signs of editing', severity: 'high', text: '' }], passed: [] });
  const line = checkLine([{ kindLabel: 'Bank statement', check }]);
  assert.match(line, /bank statement shows signs of editing/);
  assert.match(line, /lender may reject/);
  assert.match(line, /may not be accurate/);
  assert.equal(checkLine([{ kindLabel: 'Bank statement', check: summarise({}) }]), '', 'nothing is said about a clean paper');
});

test('affordability worked out from a paper with a warning says so, and stays grounded', async () => {
  const session = createSession({ id: 'jrn-doc-check', customerId: 'ramesh', now: NOW });
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const { profileFromDocuments } = await import('../src/journeys/incomeRead.js');
  const doc = {
    kind: 'bank_statement', kindLabel: 'Bank statement', name: 'statement.pdf', hash: 'abc', usable: true, receipts: [], declared: [],
    period: { from: '2026-05-01', to: '2026-10-28' },
    transactions: months.map((month) => ({ date: `${month}-05`, description: 'NEFT CR SWIGGY PAYOUT', credit: 30000, debit: 0, stream: 'gig', include: true })),
    check: { verdict: 'suspect', headline: 'Signs of editing' },
  };
  const profile = { ...profileFromDocuments([doc]), checks: checksCarried([doc]) };
  recordFact(session, 'incomeProfile', profile, { agent: 'lending', firstFor: 'lending', now: NOW });
  grantConsent(session, 'affordability', { now: NOW });
  const r = await takeTurn(session, { text: 'Can I afford this loan?', textEn: 'Can I afford this loan?', lang: 'en' }, { now: NOW, modelOff: true });
  assert.equal(r.tool, 'check_affordability');
  assert.ok(!r.blocked, r.reply);
  assert.match(r.reply, /lender may reject it, and these figures may not be accurate/);
  assert.deepEqual(r.card.data.profile.checks, [{ name: 'statement.pdf', kindLabel: 'Bank statement', verdict: 'suspect', headline: 'Signs of editing' }]);
});
