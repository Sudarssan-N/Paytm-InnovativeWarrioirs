// A real phone call on the same voice stack. Twilio streams the call over a
// WebSocket as 8 kHz mu-law; this file finds the end of each turn, hands the audio
// to Saaras, runs the same orchestrator as the app, and speaks the answer back.
//
// No dependency: the WebSocket framing is the small subset a media stream uses.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { splitSentences, sarvamAvailable, speakWav, streamPhoneAudio, transcribeWav } from './sarvamServer.mjs';
import { openSession, runTurn } from './journeyApi.mjs';
import { clientId, rateLimited } from './aiProxy.mjs';

// ── G.711 mu-law ────────────────────────────────────────────────
export function mulawToLinear(byte) {
  const u = ~byte & 0xff;
  const exponent = (u >> 4) & 0x07;
  const magnitude = (((u & 0x0f) << 3) + 0x84) << exponent;
  return (u & 0x80 ? 0x84 - magnitude : magnitude - 0x84);
}

export function linearToMulaw(sample) {
  const BIAS = 0x84, CLIP = 32635;
  const sign = sample < 0 ? 0x80 : 0;
  let value = Math.min(Math.abs(sample), CLIP) + BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (value & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (value >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function pcmToWav(pcm, sampleRate = 8000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function wavToPcm(wav) {
  let offset = 12, sampleRate = 8000;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'fmt ') sampleRate = wav.readUInt32LE(offset + 12);
    if (id === 'data') return { pcm: wav.subarray(offset + 8, Math.min(offset + 8 + size, wav.length)), sampleRate };
    offset += 8 + size + (size % 2);
  }
  throw new Error('No audio data in the WAV');
}

export function resample(pcm, from, to) {
  if (from === to) return pcm;
  const count = Math.floor(((pcm.length / 2) * to) / from);
  const out = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) out.writeInt16LE(pcm.readInt16LE(Math.min(Math.floor((i * from) / to), pcm.length / 2 - 1) * 2), i * 2);
  return out;
}

function pcmToMulaw(pcm) {
  const out = Buffer.alloc(pcm.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = linearToMulaw(pcm.readInt16LE(i * 2));
  return out;
}

function rms(mulaw) {
  let sum = 0;
  for (const byte of mulaw) { const sample = mulawToLinear(byte); sum += sample * sample; }
  return Math.sqrt(sum / (mulaw.length || 1));
}

// ── one call ────────────────────────────────────────────────────
const FRAME_MS = 20;
const SPEECH_RMS = 500;
const END_OF_TURN_MS = 800;
const MIN_SPEECH_MS = 300;
const MAX_TURN_MS = 20000;
const BARGE_IN_MS = 320;

// The dependencies are passed in so a whole call can run under test with no network.
export function createCall({ send, open, hear, turn, tts, ttsStream = null, log = () => {}, onSpeechFailure = null }) {
  let streamSid = null, state = 'connecting', session = null, generation = 0;
  let frames = [], speechMs = 0, silenceMs = 0, bargeMs = 0, lang = 'en', turnChain = Promise.resolve();

  const sendAudio = (mulaw) => {
    for (let at = 0; at < mulaw.length; at += 160) {
      send({ event: 'media', streamSid, media: { payload: mulaw.subarray(at, at + 160).toString('base64') } });
    }
  };

  async function say(text, replyLang) {
    const mine = ++generation;
    state = 'speaking';
    const speakClips = async (line, lineLang) => {
      // Streaming first: the caller hears the first word in about 200 ms.
      if (ttsStream) {
        let sent = false;
        try {
          await ttsStream(line, lineLang, (mulaw) => { if (mine === generation) { sent = true; sendAudio(mulaw); } });
          if (sent) return;
        } catch (error) {
          if (sent) throw error; // half a sentence must not be repeated from the start
          log('Streaming speech failed, using a whole clip', error.message);
        }
      }
      for (const clip of await tts(line, lineLang)) {
        if (mine !== generation) return;
        const { pcm, sampleRate } = wavToPcm(clip);
        sendAudio(pcmToMulaw(resample(pcm, sampleRate, 8000)));
      }
    };
    for (const sentence of splitSentences(text)) {
      if (mine !== generation) return;
      try {
        await speakClips(sentence, replyLang);
      } catch (error) {
        log('A sentence could not be spoken', error.message);
        // Never skip a sentence and carry on: the next one may only make sense with
        // the figure that was lost. Say so, and let a person finish the answer.
        try { await speakClips('I could not say that part clearly, so I will not guess. A person will call you back with the exact numbers.', 'en'); }
        catch (again) { log('The apology could not be spoken either', again.message); }
        onSpeechFailure?.(sentence);
        break;
      }
    }
    if (mine === generation) send({ event: 'mark', streamSid, mark: { name: `reply-${mine}` } });
  }

  async function finishTurn(audio) {
    state = 'thinking';
    try {
      const heard = await hear(pcmToWav(audio));
      if (!heard.transcript) { await say('Sorry, I did not catch that. Please say it again.', 'en'); return; }
      const result = await turn(session, { text: heard.transcript, spoken: heard.lang && heard.confidence >= 0.6 ? { lang: heard.lang, confidence: heard.confidence } : null, channel: 'phone' });
      lang = result.reply.lang;
      log(`Turn: ${result.tool}`, result.customer.english);
      await say(result.reply.native, result.reply.lang);
    } catch (error) {
      log('The turn failed', error.message);
      await say('I am having trouble right now. A person will call you back.', 'en');
    }
  }

  function onFrame(mulaw) {
    const loud = rms(mulaw) > SPEECH_RMS;
    if (state === 'speaking') {
      // The caller talks over MITRA: stop speaking and listen, like a person would.
      bargeMs = loud ? bargeMs + FRAME_MS : 0;
      if (bargeMs >= BARGE_IN_MS) {
        generation++;
        send({ event: 'clear', streamSid });
        state = 'listening';
        frames = []; speechMs = bargeMs; silenceMs = 0; bargeMs = 0;
      }
      return;
    }
    if (state !== 'listening') return;
    if (loud) { speechMs += FRAME_MS; silenceMs = 0; }
    else if (speechMs) silenceMs += FRAME_MS;
    if (speechMs) frames.push(mulaw);
    const ended = speechMs >= MIN_SPEECH_MS && silenceMs >= END_OF_TURN_MS;
    if (ended || frames.length * FRAME_MS >= MAX_TURN_MS) {
      const pcm = Buffer.alloc(frames.reduce((total, frame) => total + frame.length, 0) * 2);
      let at = 0;
      for (const frame of frames) for (const byte of frame) { pcm.writeInt16LE(mulawToLinear(byte), at); at += 2; }
      frames = []; speechMs = 0; silenceMs = 0;
      turnChain = turnChain.then(() => finishTurn(pcm));
    } else if (!speechMs) frames = [];
  }

  return {
    get state() { return state; },
    get session() { return session; },
    get lang() { return lang; },
    settled: () => turnChain,
    async onMessage(message) {
      if (message.event === 'start') {
        streamSid = message.start?.streamSid || message.streamSid;
        const opening = await open();
        session = opening.session;
        await say(opening.reply, 'en');
      } else if (message.event === 'media' && message.media?.track !== 'outbound') {
        onFrame(Buffer.from(message.media.payload, 'base64'));
      } else if (message.event === 'mark' && message.mark?.name === `reply-${generation}`) {
        if (state === 'speaking') { state = 'listening'; bargeMs = 0; }
      } else if (message.event === 'stop') {
        generation++;
        state = 'ended';
      }
    },
  };
}

// ── WebSocket framing ───────────────────────────────────────────
export function encodeFrame(text, opcode = 1) {
  const payload = Buffer.from(text);
  const head = payload.length < 126 ? Buffer.from([0x80 | opcode, payload.length])
    : payload.length < 65536 ? Buffer.from([0x80 | opcode, 126, payload.length >> 8, payload.length & 0xff])
      : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | opcode; h[1] = 127; h.writeBigUInt64BE(BigInt(payload.length), 2); return h; })();
  return Buffer.concat([head, payload]);
}

// Returns the complete frames in `buffer` and what is left over.
export function decodeFrames(buffer) {
  const frames = [];
  let at = 0;
  while (buffer.length - at >= 2) {
    const opcode = buffer[at] & 0x0f, masked = buffer[at + 1] & 0x80;
    let length = buffer[at + 1] & 0x7f, offset = at + 2;
    if (length === 126) { if (buffer.length < offset + 2) break; length = buffer.readUInt16BE(offset); offset += 2; }
    else if (length === 127) { if (buffer.length < offset + 8) break; length = Number(buffer.readBigUInt64BE(offset)); offset += 8; }
    const maskLength = masked ? 4 : 0;
    if (buffer.length < offset + maskLength + length) break;
    const payload = Buffer.from(buffer.subarray(offset + maskLength, offset + maskLength + length));
    if (masked) {
      const mask = buffer.subarray(offset, offset + 4);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }
    frames.push({ opcode, payload });
    at = offset + maskLength + length;
  }
  return { frames, rest: buffer.subarray(at) };
}

// ── routes ──────────────────────────────────────────────────────
const STREAM_TOKEN = process.env.PHONE_STREAM_TOKEN || randomBytes(18).toString('base64url');
const twilio = () => ({ sid: process.env.TWILIO_ACCOUNT_SID, token: process.env.TWILIO_AUTH_TOKEN, from: process.env.TWILIO_FROM });
const publicHost = (req) => process.env.PUBLIC_HOST || req.headers['x-forwarded-host'] || req.headers.host;

const liveCalls = new Set();
let latestPhoneSession = null;
export const latestPhoneSessionId = () => latestPhoneSession;

const realCall = (send) => createCall({
  send,
  open: async () => {
    const { session, opening } = await openSession({ channel: 'phone' });
    latestPhoneSession = session.id;
    return { session, reply: opening.reply.native };
  },
  hear: (wav) => transcribeWav(wav),
  turn: (session, input) => runTurn(session, input),
  tts: (text, lang) => speakWav(text, lang),
  ttsStream: (text, lang, onAudio) => streamPhoneAudio(text, lang, onAudio),
  log: (...args) => console.log('[phone]', ...args),
});

export function acceptStream(req, socket) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/api/phone/stream' || url.searchParams.get('token') !== STREAM_TOKEN || !sarvamAvailable()) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const call = realCall((message) => { if (!socket.destroyed) socket.write(encodeFrame(JSON.stringify(message))); });
  liveCalls.add(call);
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    const { frames, rest } = decodeFrames(Buffer.concat([pending, chunk]));
    pending = rest;
    for (const frame of frames) {
      if (frame.opcode === 8) { socket.write(encodeFrame('', 8)); socket.end(); continue; }
      if (frame.opcode === 9) { socket.write(encodeFrame(frame.payload, 10)); continue; }
      if (frame.opcode !== 1) continue;
      let message;
      try { message = JSON.parse(frame.payload.toString('utf8')); } catch { continue; }
      call.onMessage(message).catch((error) => console.error('[phone]', error.message));
    }
  });
  const finish = () => { liveCalls.delete(call); call.onMessage({ event: 'stop' }); };
  socket.on('close', finish);
  socket.on('error', finish);
}

const twiml = (req) => `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://${publicHost(req)}/api/phone/stream?token=${STREAM_TOKEN}" /></Connect></Response>`;

// Twilio signs each webhook. With the auth token set, an unsigned request is refused.
function signatureValid(req, params) {
  const { token } = twilio();
  if (!token) return true;
  const url = `https://${publicHost(req)}${req.url}`;
  const data = url + Object.keys(params).sort().map((key) => key + params[key]).join('');
  const expected = createHmac('sha1', token).update(data).digest();
  const given = Buffer.from(String(req.headers['x-twilio-signature'] || ''), 'base64');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) throw Object.assign(new Error('Too large'), { status: 413 }); }
  return raw;
}

function reply(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}

export async function handlePhone(req, res, url) {
  if (rateLimited(clientId(req), 'journey')) return reply(res, 429, { title: 'Too many requests' });
  const { sid, token, from } = twilio();
  const configured = Boolean(sid && token && from && sarvamAvailable());

  if (req.method === 'GET' && url.pathname === '/api/phone/status') return reply(res, 200, { configured, liveCalls: liveCalls.size, latestSession: latestPhoneSession });

  if (req.method === 'POST' && url.pathname === '/api/phone/twiml') {
    const params = Object.fromEntries(new URLSearchParams(await body(req)));
    if (!signatureValid(req, params)) return reply(res, 403, { title: 'Bad signature' });
    return reply(res, 200, twiml(req), 'text/xml');
  }

  // Call-back: MITRA rings the customer. Trial accounts can only ring verified numbers.
  if (req.method === 'POST' && url.pathname === '/api/phone/call-back') {
    if (!configured) return reply(res, 409, { title: 'Phone calling is not configured', detail: 'Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM and PUBLIC_HOST.' });
    const input = JSON.parse((await body(req)) || '{}');
    if (!/^\+[1-9]\d{7,14}$/.test(String(input.to || ''))) return reply(res, 422, { title: 'Use a full number, like +919876543210' });
    const form = new URLSearchParams({ To: input.to, From: from, Url: `https://${publicHost(req)}/api/phone/twiml` });
    const upstream = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(10000),
      headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return reply(res, 502, { title: 'Twilio refused the call', detail: data.message || `Status ${upstream.status}` });
    return reply(res, 201, { status: data.status, callSid: data.sid });
  }
  return reply(res, 404, { title: 'Not found' });
}

export const streamTokenForTests = () => STREAM_TOKEN;
