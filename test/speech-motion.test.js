import test from 'node:test';
import assert from 'node:assert/strict';
import { mouthFromWaveform, mouthForLetter, subscribeSpeechMotion, beginTextSpeechMotion, stopSpeechMotion, prepareSpeechMotion, attachAudioSpeechMotion } from '../src/engine/speechMotion.js';
import { armPose, getCharacter, CHARACTERS } from '../src/engine/characters.js';

test('audio mouth follows amplitude and closes during actual silence', () => {
  const quiet = new Float32Array([0, .001, -.001, 0]);
  const talking = new Float32Array([.15, -.15, .2, -.2]);
  assert.equal(mouthFromWaveform(quiet, .9), 0);
  assert.ok(mouthFromWaveform(talking) > .5);
  assert.equal(mouthFromWaveform(new Float32Array()), 0);
  assert.ok(mouthFromWaveform(new Float32Array([10, -10])) <= 1);
});

test('device mouth shapes distinguish closed consonants, rounded and wide vowels', () => {
  assert.equal(mouthForLetter('m').open, 0);
  assert.equal(mouthForLetter(' ').open, 0);
  assert.equal(mouthForLetter('.').open, 0);
  assert.ok(mouthForLetter('o').round > mouthForLetter('a').round);
  assert.ok(mouthForLetter('a').open > mouthForLetter('i').open);
});

function mockFrames() {
  const saved = { request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
  const pending = new Map();
  let id = 0;
  globalThis.requestAnimationFrame = (fn) => { pending.set(++id, fn); return id; };
  globalThis.cancelAnimationFrame = (key) => pending.delete(key);
  return { pending, tick: (now) => { const frames = [...pending.values()]; pending.clear(); frames.forEach((fn) => fn(now)); }, restore: () => {
    globalThis.requestAnimationFrame = saved.request;
    globalThis.cancelAnimationFrame = saved.cancel;
  } };
}

test('word boundary resynchronizes mouth and cancellation clears its animation', () => {
  const frames = mockFrames();
  const states = [];
  const unsubscribe = subscribeSpeechMotion((state) => states.push(state));
  try {
    const boundary = beginTextSpeechMotion('aaaa oooo mmmm');
    frames.tick(performance.now() + 50);
    assert.ok(states.at(-1).open > 0);
    boundary(10);
    frames.tick(performance.now() + 100);
    assert.equal(states.at(-1).open, 0);
    stopSpeechMotion();
    assert.equal(states.at(-1).active, false);
    assert.equal(frames.pending.size, 0);
    boundary(0); // stale events must not restart a stopped mouth
    assert.equal(frames.pending.size, 0);
  } finally { stopSpeechMotion(); unsubscribe(); frames.restore(); }
});

test('neural audio driver handles speech, pause, and node cleanup', () => {
  const frames = mockFrames();
  const oldWindow = globalThis.window;
  let disconnected = 0;
  const fakeNode = { connect() {}, disconnect() { disconnected++; } };
  globalThis.window = { AudioContext: class {
    state = 'running'; destination = {};
    createMediaElementSource() { return fakeNode; }
    createAnalyser() { return { ...fakeNode, fftSize: 512, getFloatTimeDomainData: (data) => data.fill(.2) }; }
  } };
  const states = [];
  const unsubscribe = subscribeSpeechMotion((state) => states.push(state));
  try {
    prepareSpeechMotion();
    const element = { paused: false };
    assert.equal(attachAudioSpeechMotion(element), true);
    frames.tick(100);
    assert.ok(states.at(-1).open > 0);
    element.paused = true;
    frames.tick(200);
    assert.equal(states.at(-1).open, 0);
    stopSpeechMotion();
    assert.equal(disconnected, 2);
    assert.equal(frames.pending.size, 0);
  } finally { stopSpeechMotion(); unsubscribe(); frames.restore(); globalThis.window = oldWindow; }
});

test('all four characters have distinct choices and articulated action poses', () => {
  assert.equal(new Set(CHARACTERS.map((c) => `${c.style}-${c.gender}`)).size, 4);
  assert.equal(getCharacter('unknown').id, 'asha');
  assert.equal(armPose('thumbs-up').hand, 'thumb');
  assert.equal(armPose('wave').hand, 'open');
  assert.equal(armPose('point-right').hand, 'point');
  assert.notEqual(armPose('point-right', -20).shoulder, armPose('point-right', 20).shoulder);
  assert.deepEqual(armPose('point-right', 999), armPose('point-right', 25));
});
