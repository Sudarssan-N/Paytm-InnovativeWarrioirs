import test from 'node:test';
import assert from 'node:assert/strict';
import { createCall, decodeFrames, encodeFrame, linearToMulaw, mulawToLinear, pcmToWav, resample, wavToPcm } from '../server/telephony.mjs';

const toneFrame = (amplitude, ms = 20) => {
  const mulaw = Buffer.alloc((8000 * ms) / 1000);
  for (let i = 0; i < mulaw.length; i++) mulaw[i] = linearToMulaw(Math.round(amplitude * Math.sin((2 * Math.PI * 300 * i) / 8000)));
  return mulaw;
};
const media = (frame) => ({ event: 'media', media: { track: 'inbound', payload: frame.toString('base64') } });

function harness(overrides = {}) {
  const sent = [], turns = [], heardAudio = [];
  const clip = pcmToWav(Buffer.alloc(3200), 8000);
  const call = createCall({
    send: (message) => sent.push(message),
    open: async () => ({ session: { id: 'phone-1' }, reply: 'This is MITRA, an AI assistant.' }),
    hear: async (wav) => { heardAudio.push(wav); return { transcript: 'இந்த லோனுக்கு செலவு எவ்வளவு?', lang: 'ta', confidence: 0.99 }; },
    turn: async (session, input) => { turns.push(input); return { tool: 'explain_loan_offer', customer: { english: 'loan cost' }, reply: { native: 'APR 17.7%.', lang: 'ta' } }; },
    tts: async () => [clip],
    ...overrides,
  });
  return { call, sent, turns, heardAudio };
}

const listen = async (h) => {
  await h.call.onMessage({ event: 'start', start: { streamSid: 'MZ1' } });
  const mark = h.sent.find((message) => message.event === 'mark');
  await h.call.onMessage({ event: 'mark', mark: { name: mark.mark.name } });
};

const speak = async (call, { speechMs = 600, silenceMs = 1000 } = {}) => {
  for (let t = 0; t < speechMs; t += 20) await call.onMessage(media(toneFrame(8000)));
  for (let t = 0; t < silenceMs; t += 20) await call.onMessage(media(toneFrame(0)));
};

test('mu-law survives a round trip within its quantisation error', () => {
  for (const sample of [0, 100, -100, 1000, -1000, 8000, -8000, 30000, -30000]) {
    const back = mulawToLinear(linearToMulaw(sample));
    assert.ok(Math.abs(back - sample) <= Math.max(16, Math.abs(sample) * 0.05), `${sample} came back as ${back}`);
  }
});

test('WAV wrapping and unwrapping keep the samples and the rate', () => {
  const pcm = Buffer.from(Int16Array.from([1, -2, 3, -4]).buffer);
  const { pcm: out, sampleRate } = wavToPcm(pcmToWav(pcm, 16000));
  assert.equal(sampleRate, 16000);
  assert.deepEqual(out, pcm);
  assert.equal(resample(Buffer.alloc(3200), 16000, 8000).length, 1600);
  assert.throws(() => wavToPcm(Buffer.alloc(44)), /No audio/);
});

test('WebSocket frames decode, including masked and split ones', () => {
  const { frames, rest } = decodeFrames(encodeFrame('hello'));
  assert.equal(frames[0].payload.toString(), 'hello');
  assert.equal(rest.length, 0);
  const mask = Buffer.from([1, 2, 3, 4]);
  const text = Buffer.from('masked');
  const masked = Buffer.concat([Buffer.from([0x81, 0x80 | text.length]), mask, Buffer.from(text.map((byte, i) => byte ^ mask[i % 4]))]);
  assert.equal(decodeFrames(masked).frames[0].payload.toString(), 'masked');
  const split = decodeFrames(masked.subarray(0, 4));
  assert.equal(split.frames.length, 0);
  assert.equal(split.rest.length, 4);
  const long = 'x'.repeat(70000);
  assert.equal(decodeFrames(encodeFrame(long)).frames[0].payload.length, 70000);
  assert.equal(decodeFrames(encodeFrame('x'.repeat(300))).frames[0].payload.length, 300);
});

test('the call opens by speaking, then waits for the audio to finish before listening', async () => {
  const h = harness();
  await h.call.onMessage({ event: 'start', start: { streamSid: 'MZ1' } });
  assert.equal(h.call.state, 'speaking');
  assert.ok(h.sent.some((message) => message.event === 'media' && message.streamSid === 'MZ1'));
  const frame = Buffer.from(h.sent.find((message) => message.event === 'media').media.payload, 'base64');
  assert.equal(frame.length, 160, 'audio goes out in 20 ms frames');
  await h.call.onMessage({ event: 'mark', mark: { name: h.sent.find((message) => message.event === 'mark').mark.name } });
  assert.equal(h.call.state, 'listening');
});

test('silence ends the turn, and the same orchestrator gets the detected language', async () => {
  const h = harness();
  await listen(h);
  await speak(h.call);
  await h.call.settled();
  assert.equal(h.turns.length, 1);
  assert.deepEqual(h.turns[0].spoken, { lang: 'ta', confidence: 0.99 });
  assert.equal(h.turns[0].channel, 'phone');
  assert.equal(h.call.lang, 'ta');
  assert.equal(h.heardAudio[0].toString('ascii', 0, 4), 'RIFF');
});

test('a short blip and line noise are not a question', async () => {
  const h = harness();
  await listen(h);
  await speak(h.call, { speechMs: 100, silenceMs: 1500 });
  for (let t = 0; t < 1500; t += 20) await h.call.onMessage(media(toneFrame(150)));
  await h.call.settled();
  assert.equal(h.turns.length, 0);
});

test('talking over MITRA stops the audio and starts listening', async () => {
  const h = harness();
  await h.call.onMessage({ event: 'start', start: { streamSid: 'MZ1' } });
  assert.equal(h.call.state, 'speaking');
  for (let t = 0; t < 360; t += 20) await h.call.onMessage(media(toneFrame(8000)));
  assert.ok(h.sent.some((message) => message.event === 'clear'));
  assert.equal(h.call.state, 'listening');
});

test('a low-confidence language is not trusted, and an empty transcript asks again', async () => {
  const unsure = harness({ hear: async () => ({ transcript: 'hmm', lang: 'ta', confidence: 0.3 }) });
  await listen(unsure);
  await speak(unsure.call);
  await unsure.call.settled();
  assert.equal(unsure.turns[0].spoken, null);
  const empty = harness({ hear: async () => ({ transcript: '', lang: null, confidence: 0 }) });
  await listen(empty);
  await speak(empty.call);
  await empty.call.settled();
  assert.equal(empty.turns.length, 0);
});

test('a failed turn tells the caller rather than going silent', async () => {
  const spoken = [];
  const h = harness({ turn: async () => { throw new Error('boom'); }, tts: async (text) => { spoken.push(text); return [pcmToWav(Buffer.alloc(320))]; } });
  await listen(h);
  await speak(h.call);
  await h.call.settled();
  assert.ok(spoken.some((text) => text.includes('person will call you back')));
});

test('a mark from an interrupted reply does not start listening early', async () => {
  const h = harness();
  await h.call.onMessage({ event: 'start', start: { streamSid: 'MZ1' } });
  await h.call.onMessage({ event: 'mark', mark: { name: 'reply-999' } });
  assert.equal(h.call.state, 'speaking');
});

test('a sentence that cannot be spoken stops the reply instead of being skipped', async () => {
  const sent = [];
  const said = [];
  let failed = null;
  const call = createCall({
    send: (message) => sent.push(message),
    open: async () => ({ session: { id: 's' }, reply: 'The APR is 17.7%. So the loan costs ₹30,000. Goodbye.' }),
    hear: async () => ({ transcript: '' }),
    turn: async () => ({}),
    tts: async (text) => {
      said.push(text);
      if (/17\.7/.test(text)) throw new Error('Bulbul stalled');
      return [pcmToWav(Buffer.alloc(320))];
    },
    onSpeechFailure: (sentence) => { failed = sentence; },
  });
  await call.onMessage({ event: 'start', start: { streamSid: 'MZ1' } });
  assert.ok(!said.some((text) => /30,000/.test(text)), 'the sentence after the lost figure is not spoken');
  assert.match(said.at(-1), /will not guess/);
  assert.equal(failed, 'The APR is 17.7%.');
});

test('splitting a reply into sentences never loses a word', async () => {
  const { splitSentences } = await import('../server/sarvamServer.mjs');
  const scam = 'Your PM Loan of ₹5,00,000 is approved. Pay ₹2,999 processing fee to pmloan.help@ybl within 2 hours to release it.';
  assert.deepEqual(splitSentences(scam), ['Your PM Loan of ₹5,00,000 is approved.', 'Pay ₹2,999 processing fee to pmloan.help@ybl within 2 hours to release it.']);
  assert.deepEqual(splitSentences('Report it at cybercrime.gov.in right away. The APR is 17.7%!'), ['Report it at cybercrime.gov.in right away.', 'The APR is 17.7%!']);
  assert.deepEqual(splitSentences('No full stop at the end'), ['No full stop at the end']);
  for (const text of [scam, 'A. B? C! D। E', 'x.y.z', '1.5 and 2.5.']) {
    assert.equal(splitSentences(text).join(' ').replace(/\s+/g, ''), text.replace(/\s+/g, ''));
  }
});

test('the phone line streams speech, and falls back to a whole clip', async () => {
  const sent = [];
  const call = createCall({
    send: (message) => sent.push(message),
    open: async () => ({ session: { id: 's' }, reply: 'Hello there. Second line.' }),
    hear: async () => ({ transcript: '' }), turn: async () => ({}),
    tts: async () => [pcmToWav(Buffer.alloc(320))],
    ttsStream: async (text, lang, onAudio) => { if (/Second/.test(text)) throw new Error('stream down'); onAudio(Buffer.alloc(400)); },
  });
  await call.onMessage({ event: 'start', start: { streamSid: 'MZ2' } });
  const media = sent.filter((message) => message.event === 'media');
  assert.equal(media.length, 4, 'three frames streamed, one from the fallback clip');
  assert.ok(sent.some((message) => message.event === 'mark'));
});
