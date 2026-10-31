import test from 'node:test';
import assert from 'node:assert/strict';
import { isAssistantEcho } from '../src/engine/speech.js';

test('a call ignores the assistant hearing herself', () => {
  const spoken = "Hi, I'm MITRA. Ask me anything about your money — I'm listening.";
  assert.equal(isAssistantEcho('Hi', spoken), true);
  assert.equal(isAssistantEcho(spoken, spoken), true);
  assert.equal(isAssistantEcho('Show my portfolio', spoken), false);
  assert.equal(isAssistantEcho('Could you specify what you want to review: spending, holdings, goals, protection, or a SIP calculation?', 'Could you specify what you want to review: spending, holdings, goals, protection, or a SIP calculation?'), true);
});

test('interim words are visible without submitting; final words submit once; abort ignores stale events', async () => {
  const old = { window: globalThis.window, localStorage: globalThis.localStorage };
  let recognition;
  globalThis.localStorage = { getItem: () => null };
  globalThis.window = { SpeechRecognition: class {
    constructor() { recognition = this; }
    start() {} stop() {} abort() {}
  } };
  const { listen } = await import('../src/engine/speech.js');
  const result = (text, isFinal) => Object.assign([{ transcript: text }], { isFinal });
  try {
    const final = [], partial = [];
    let ended = 0;
    const mic = listen({ onResult: (text) => final.push(text), onInterim: (text) => partial.push(text), onEnd: () => ended++ });
    assert.equal(recognition.interimResults, true);
    recognition.onresult({ results: [result('Show my', false)] });
    assert.deepEqual(partial, ['Show my']); assert.equal(final.length, 0);
    recognition.onresult({ results: [result('Show my portfolio', true)] });
    recognition.onresult({ results: [result('Show my portfolio', true)] });
    assert.deepEqual(final, ['Show my portfolio']); assert.equal(partial.at(-1), '');
    mic.abort(); recognition.onend();
    assert.equal(ended, 0);
    const next = listen({ onResult: (text) => final.push(text) });
    next.abort(); recognition.onresult({ results: [result('stale words', true)] });
    assert.equal(final.length, 1);
  } finally { globalThis.window = old.window; globalThis.localStorage = old.localStorage; }
});
