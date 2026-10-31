// The RM desk sees cases from saved journeys too, so a server restart does not
// empty the queue, and a saved case can still be closed.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSession, takeTurn } from '../src/journeys/orchestrator.js';

const NOW = Date.parse('2026-10-31T10:00:00Z');
const data = mkdtempSync(path.join(tmpdir(), 'mitra-desk-'));
process.env.MITRA_DATA_DIR = data;
after(() => rmSync(data, { recursive: true, force: true }));

test('a case saved before a restart is on the desk and can be closed', async () => {
  const session = createSession({ id: 'jrn-desk-saved', customerId: 'ramesh', now: NOW });
  const r = await takeTurn(session, { text: 'I want to talk to a person', textEn: 'I want to talk to a person', lang: 'en' }, { now: NOW, modelOff: true });
  assert.equal(r.tool, 'handoff_to_human');
  const erased = { id: 'jrn-desk-erased', erasedAt: new Date(NOW).toISOString(), receipts: 0, lastHash: null };
  writeFileSync(path.join(data, 'mitra.json'), JSON.stringify({ journeySessions: { [session.id]: JSON.parse(JSON.stringify(session)), [erased.id]: erased } }));

  const { deskBriefs, resolveHandoff } = await import('../server/journeyApi.mjs');
  const briefs = await deskBriefs();
  assert.deepEqual(briefs.map((brief) => brief.sessionId), [session.id], 'the saved case shows, the erased journey does not');
  assert.equal(briefs[0].status, 'open');

  await resolveHandoff(briefs[0].id, { outcome: 'resolved', notes: 'Explained the foreclosure charge.' });
  const [closed] = await deskBriefs();
  assert.equal(closed.status, 'closed');
  assert.equal(closed.outcome, 'resolved');
  assert.ok(closed.closedAt, 'the close time is kept for "closed today"');
});

test('asking for the RM, or to hand over or escalate, reaches a person', async () => {
  const { routeByRules } = await import('../src/journeys/router.js');
  for (const text of ['handover to RM', 'hand over to my RM please', 'handoff to rm', 'Hand off to my relationship manager', 'escalate this', 'RM ko bulao', 'give me a human', 'I need my RM']) {
    assert.deepEqual(routeByRules(text, text), { name: 'handoff_to_human', arguments: { reason: 'asked' } }, text);
  }
  for (const text of ['I want to pay the agent', 'I need a personal loan of 2 lakh', 'I need someone to explain']) {
    assert.notEqual(routeByRules(text, text)?.name, 'handoff_to_human', text);
  }
});

test('an RM takes a case, the desk shows the conversation, and a closed case cannot be taken', async () => {
  const { deskBriefs, takeHandoff, resolveHandoff } = await import('../server/journeyApi.mjs');
  const session = createSession({ id: 'jrn-desk-take', customerId: 'lakshmi', now: NOW });
  await takeTurn(session, { text: 'handover to RM', textEn: 'handover to RM', lang: 'en' }, { now: NOW, modelOff: true });
  session.messages.push({ from: 'customer', native: 'handover to RM', english: 'handover to RM', lang: 'en', at: NOW });
  writeFileSync(path.join(data, 'mitra.json'), JSON.stringify({ journeySessions: { [session.id]: JSON.parse(JSON.stringify(session)) } }));

  const brief = (await deskBriefs()).find((item) => item.sessionId === session.id);
  assert.equal(brief.context.conversation.at(-1).english, 'handover to RM');
  await assert.rejects(takeHandoff(brief.id, { rm: ' ' }), /who is taking/);
  assert.equal((await takeHandoff(brief.id, { rm: 'Priya' })).brief.owner.name, 'Priya');
  await resolveHandoff(brief.id, { outcome: 'routed', rm: 'Priya' });
  const closed = (await deskBriefs()).find((item) => item.id === brief.id);
  assert.equal(closed.closedBy, 'Priya');
  await assert.rejects(takeHandoff(brief.id, { rm: 'Arun' }), /already closed/);
});

test('an RM can take several cases, even two saved with the same id before ids were unique', async () => {
  const { deskBriefs, takeHandoff } = await import('../server/journeyApi.mjs');
  const make = async (id) => {
    const session = createSession({ id, customerId: 'ramesh', now: NOW });
    await takeTurn(session, { text: 'handover to RM', textEn: 'handover to RM', lang: 'en' }, { now: NOW, modelOff: true });
    return JSON.parse(JSON.stringify(session));
  };
  const first = await make('jrn-dup-1');
  const second = await make('jrn-dup-2');
  second.handoffs[0].id = first.handoffs[0].id; // as after a restart, before the fix
  writeFileSync(path.join(data, 'mitra.json'), JSON.stringify({ journeySessions: { [first.id]: first, [second.id]: second } }));

  const id = first.handoffs[0].id;
  await takeHandoff(id, { rm: 'Batman', sessionId: first.id });
  await takeHandoff(id, { rm: 'Batman', sessionId: second.id });
  const owners = (await deskBriefs()).filter((brief) => brief.id === id).map((brief) => brief.owner?.name);
  assert.deepEqual(owners, ['Batman', 'Batman'], 'both cases are taken, not the first one twice');
});

test('case numbers carry on after a restart instead of starting again', async () => {
  const { resumeHandoffNumbers } = await import('../src/journeys/orchestrator.js');
  resumeHandoffNumbers(['HB-26-1031-0041', 'HB-26-1030-0007', null]);
  const session = createSession({ id: 'jrn-numbering', customerId: 'ramesh', now: NOW });
  const r = await takeTurn(session, { text: 'handover to RM', textEn: 'handover to RM', lang: 'en' }, { now: NOW, modelOff: true });
  assert.ok(Number(r.handoff.id.slice(-4)) > 41, r.handoff.id);
});
