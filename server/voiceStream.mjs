// MITRA's voice over HTTP. /say streams Bulbul to an <audio> element as it is made,
// so speech starts in a few hundred milliseconds. /verify is the spoken-figure check:
// Saaras listens to the audio that was played, and every figure must be heard.
import { figuresIn } from '../src/journeys/money.js';
import { checkSpoken, speakable } from '../src/journeys/voiceFence.js';
import { clientId, rateLimited } from './aiProxy.mjs';
import { recordVoiceCheck } from './ops.mjs';
import { openSpeechStream, questionToEnglish, SARVAM_LANG, sarvamAvailable, splitSentences, transcribeWav, TTS_MODEL } from './sarvamServer.mjs';
import { cacheKey, readVoiceCache, writeVoiceCache } from './voiceCache.mjs';

const FIRST_AUDIO_BUDGET_MS = 6000;
// Saaras takes 30 seconds a request. MP3 at 128 kbps can be cut at any byte.
const STT_PIECE_BYTES = 440_000;

function problem(res, status, title) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ type: 'about:blank', title, status }));
}

function readRequest(url) {
  const text = String(url.searchParams.get('text') || '').trim();
  const lang = url.searchParams.get('lang') || 'en';
  const speaker = url.searchParams.get('speaker') || 'neha';
  const pace = Number(url.searchParams.get('pace') || 1);
  if (!text || text.length > 3500) throw Object.assign(new Error('Send up to 3,500 characters of text'), { status: 422 });
  if (!SARVAM_LANG[lang]) throw Object.assign(new Error('Unsupported language'), { status: 422 });
  if (!/^[a-z0-9_]{2,40}$/.test(speaker)) throw Object.assign(new Error('Unknown speaker'), { status: 422 });
  if (!(pace >= 0.5 && pace <= 2)) throw Object.assign(new Error('Pace must be between 0.5 and 2'), { status: 422 });
  return { text, lang, speaker, pace };
}

export const voiceKey = ({ text, lang, speaker, pace }) => cacheKey('/text-to-speech/stream', JSON.stringify({ text: speakable(text, lang), lang, speaker, pace, model: TTS_MODEL }));

// Keeps a whole clip for reuse, so the same line never costs or stalls twice.
export async function streamSpeech(spec, onChunk, signal) {
  const key = voiceKey(spec);
  const cached = await readVoiceCache(key);
  if (cached) { onChunk(cached); return { cached: true, bytes: cached.length }; }
  const stalled = new AbortController();
  const firstAudio = setTimeout(() => stalled.abort(), FIRST_AUDIO_BUDGET_MS);
  const combined = signal ? AbortSignal.any([signal, stalled.signal]) : stalled.signal;
  try {
    const upstream = await openSpeechStream(spec.text, { ...spec, signal: combined });
    const reader = upstream.body.getReader();
    const parts = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(firstAudio);
      const chunk = Buffer.from(value);
      parts.push(chunk);
      onChunk(chunk);
    }
    const whole = Buffer.concat(parts);
    if (whole.length) await writeVoiceCache(key, whole);
    return { cached: false, bytes: whole.length };
  } finally { clearTimeout(firstAudio); }
}

async function say(req, res, url) {
  const spec = readRequest(url);
  const hungUp = new AbortController();
  req.on('close', () => { if (!res.writableEnded) hungUp.abort(); });
  let opened = false;
  const open = () => { if (!opened) { opened = true; res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); } };
  try {
    await streamSpeech(spec, (chunk) => { open(); res.write(chunk); }, hungUp.signal);
    open();
    res.end();
  } catch (error) {
    if (hungUp.signal.aborted) return;
    // The browser falls back to the device voice on any failure here.
    if (!opened) return problem(res, error.status === 429 ? 429 : 504, 'The voice did not arrive in time');
    res.destroy();
  }
}

async function waitForClip(key, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const clip = await readVoiceCache(key);
    if (clip) return clip;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return null;
}

const hearClip = async (clip) => {
  const heard = [];
  for (let at = 0; at < clip.length; at += STT_PIECE_BYTES) {
    const part = await transcribeWav(clip.subarray(at, at + STT_PIECE_BYTES), { mime: 'audio/mpeg', name: 'said.mp3', mode: 'translate', model: 'saaras:v3', keyterms: false });
    heard.push(part.transcript);
  }
  return heard.join(' ');
};

export async function verifySpeech(spec) {
  const figures = figuresIn(spec.text);
  if (!figures.length) return { checked: false, reason: 'No figures in this reply' };
  const key = voiceKey(spec);
  const resultKey = cacheKey('/voice-check/v3', key);
  const saved = await readVoiceCache(resultKey);
  if (saved) return { ...JSON.parse(saved.toString('utf8')), fromCache: true };
  const clip = await waitForClip(key);
  if (!clip) return { checked: false, reason: 'The audio is not ready' };
  const heard = await hearClip(clip);
  let result = checkSpoken(spec.text, heard);
  // A long clip is heard less exactly than a short one. Before raising a doubt, the
  // sentence holding the missing figure is spoken and heard again by itself.
  let rechecked = 0;
  if (!result.ok && !result.dateMisread) {
    const still = [];
    for (const figure of result.missing) {
      const line = splitSentences(spec.text).find((sentence) => figuresIn(sentence).includes(figure));
      if (!line) { still.push(figure); continue; }
      const piece = { ...spec, text: line };
      await streamSpeech(piece, () => {});
      const again = await waitForClip(voiceKey(piece), 10);
      let confirmed = again ? !checkSpoken(line, await hearClip(again)).missing.includes(figure) : false;
      // Saaras can write the right words in the customer's language and still lose a
      // lakh when it translates. So the native words get their own translation before
      // anything is doubted: the voice is only in question if both routes miss it.
      if (again && !confirmed) {
        const native = await transcribeWav(again.subarray(0, STT_PIECE_BYTES), { mime: 'audio/mpeg', name: 'said.mp3', mode: 'verbatim', model: 'saaras:v3', keyterms: false, lang: spec.lang });
        const english = await questionToEnglish(native.transcript, spec.lang);
        confirmed = !checkSpoken(line, english.text).missing.includes(figure);
      }
      rechecked += 1;
      if (!confirmed) still.push(figure);
    }
    result = { ...result, ok: !still.length, missing: still };
  }
  recordVoiceCheck({ ok: result.ok, figures: figures.length, missing: result.missing });
  const out = { checked: true, ok: result.ok, figures: result.expected, missing: result.missing, dateMisread: result.dateMisread, rechecked, heard: heard.slice(0, 400) };
  if (out.ok) await writeVoiceCache(resultKey, Buffer.from(JSON.stringify(out)));
  return out;
}

export async function handleVoice(req, res, url) {
  if (req.method !== 'GET') return problem(res, 405, 'Use GET');
  if (!sarvamAvailable()) return problem(res, 503, 'Sarvam is not configured on the server');
  if (rateLimited(clientId(req), 'sarvam')) return problem(res, 429, 'Too many voice requests. Try again in a minute.');
  try {
    if (url.pathname === '/api/voice/say') return await say(req, res, url);
    if (url.pathname === '/api/voice/verify') {
      const out = await verifySpeech(readRequest(url));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(out));
    }
    return problem(res, 404, 'Not found');
  } catch (error) {
    return problem(res, error.status || 502, error.status ? error.message : 'Voice failed');
  }
}
