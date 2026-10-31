import test from 'node:test';
import assert from 'node:assert/strict';

// node --test gives each file its own process, so these globals are ours alone.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let utterance;
globalThis.window = { speechSynthesis: { getVoices: () => [], cancel() {}, speak(u) { utterance = u; } } };
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

// Sarvam: record every synthesis request body, answer with one tiny clip each.
const bodies = [];
globalThis.fetch = async (_url, init) => {
  bodies.push(JSON.parse(init.body));
  return { ok: true, json: async () => ({ audios: [Buffer.from('RIFF').toString('base64')] }) };
};
globalThis.URL.createObjectURL = () => 'blob:clip';
globalThis.URL.revokeObjectURL = () => {};
globalThis.Audio = class { constructor(src) { this.src = src; } play() { return Promise.resolve(); } pause() {} };

const { speak, speakStream, stopSpeaking, getSpeechPace, setSpeechPace, clampPace, SPEECH_PACES } =
  await import('../src/engine/speech.js');
const flush = () => new Promise((resolve) => setTimeout(resolve, 25));
const useSarvam = () => { store.clear(); store.set('mitra_sarvam_key', 'test-key'); bodies.length = 0; };

test('speech pace defaults to normal and clamps bad stored values', () => {
  store.clear();
  assert.equal(getSpeechPace(), 1);
  store.set('mitra_speech_pace', 'banana');
  assert.equal(getSpeechPace(), 1);
  store.set('mitra_speech_pace', '9');
  assert.equal(getSpeechPace(), 1.5);
  store.set('mitra_speech_pace', '0.1');
  assert.equal(getSpeechPace(), 0.7);
  setSpeechPace(1.15);
  assert.equal(getSpeechPace(), 1.15);
  assert.equal(clampPace(null), 1);
  assert.equal(clampPace(''), 1);
});

test('every preset sits inside the allowed range and Normal is the default', () => {
  for (const { pace } of SPEECH_PACES) assert.equal(clampPace(pace), pace);
  assert.equal(SPEECH_PACES.find((p) => p.id === 'normal').pace, 1);
});

test('device voice rate follows the saved pace, and an explicit pace overrides it', () => {
  store.clear(); // no Sarvam key, so this is the browser voice
  setSpeechPace(1.3);
  speak('Hello there.');
  assert.ok(Math.abs(utterance.rate - 0.98 * 1.3) < 1e-9);
  speak('Hello there.', { pace: 0.85 });
  assert.ok(Math.abs(utterance.rate - 0.98 * 0.85) < 1e-9);
  stopSpeaking();
});

test('Sarvam synthesis requests carry the saved pace, and an explicit pace overrides it', async () => {
  useSarvam();
  setSpeechPace(1.15);
  speak('Your surplus is ready.');
  await flush();
  assert.equal(bodies[0].pace, 1.15);

  bodies.length = 0;
  speak('Your surplus is ready.', { pace: 0.85 });
  await flush();
  assert.equal(bodies[0].pace, 0.85);
  stopSpeaking();
});

test('a streamed reply is spoken at one pace throughout', async () => {
  useSarvam();
  setSpeechPace(1.3);
  const stream = speakStream({});
  setSpeechPace(0.85); // changed mid-reply: must not split the reply across two speeds
  stream.push('First sentence.');
  stream.push('Second sentence.');
  await flush();
  assert.deepEqual(bodies.map((b) => b.pace), [1.3, 1.3]);
  stopSpeaking();
});
