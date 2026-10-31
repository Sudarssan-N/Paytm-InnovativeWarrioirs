import test from 'node:test';
import assert from 'node:assert/strict';

test('device speech starts mouth only on playback, then rejects cancelled callbacks', async () => {
  const old = { window: globalThis.window, localStorage: globalThis.localStorage, utterance: globalThis.SpeechSynthesisUtterance, raf: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
  let utterance;
  const frames = new Map();
  let frameId = 0;
  globalThis.localStorage = { getItem: () => null };
  globalThis.window = { speechSynthesis: { getVoices: () => [], cancel() {}, speak(u) { utterance = u; } } };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.requestAnimationFrame = (fn) => { frames.set(++frameId, fn); return frameId; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  const { speak, stopSpeaking } = await import('../src/engine/speech.js');
  const { subscribeSpeechMotion } = await import('../src/engine/speechMotion.js');
  let state;
  const unsubscribe = subscribeSpeechMotion((value) => { state = value; });
  let started = 0, ended = 0;
  try {
    assert.equal(speak('Hello there.', { onStart: () => started++, onEnd: () => ended++ }), true);
    assert.equal(started, 0);
    assert.equal(state.open, 0);
    utterance.onstart();
    assert.equal(started, 1);
    assert.equal(frames.size, 1);
    utterance.onboundary({ charIndex: 6 });
    const oldUtterance = utterance;
    stopSpeaking();
    assert.equal(state.open, 0);
    assert.equal(frames.size, 0);
    oldUtterance.onend();
    oldUtterance.onstart();
    assert.equal(ended, 0);
    assert.equal(started, 1);
    speak('Another explanation.', { onEnd: () => ended++ });
    utterance.onstart();
    utterance.onend();
    assert.equal(ended, 1);
    assert.equal(state.open, 0);
  } finally {
    stopSpeaking(); unsubscribe();
    globalThis.window = old.window; globalThis.localStorage = old.localStorage;
    globalThis.SpeechSynthesisUtterance = old.utterance;
    globalThis.requestAnimationFrame = old.raf; globalThis.cancelAnimationFrame = old.cancel;
  }
});
