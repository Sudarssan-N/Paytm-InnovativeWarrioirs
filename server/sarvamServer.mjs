// Server-side Sarvam calls for the journey API and the phone bridge. The figures
// fence lives here: a translated sentence is accepted only if every number in it
// survived, and it is retried in other styles before being left in English.
import { checkFigures, figuresIn } from '../src/journeys/money.js';
import { speakable } from '../src/journeys/voiceFence.js';
import { sarvamKey } from './aiProxy.mjs';
import { cacheKey, readVoiceCache, writeVoiceCache } from './voiceCache.mjs';
import { countCall, watch } from './ops.mjs';

const BASE = 'https://api.sarvam.ai';
const TRANSLATE_MODEL = 'mayura:v1';
const WIDE_TRANSLATE_MODEL = 'sarvam-translate:v1';
export const TTS_MODEL = 'bulbul:v3';
const STT_MODEL = 'saaras:v4';
// Words Saaras should expect on a finance call. Biases recognition, changes no figure.
export const KEYTERMS = ['EMI', 'APR', 'KFS', 'Paytm', 'Soundbox', 'foreclosure', 'free-look', 'cooling-off', 'UPI', 'OTP', 'CIBIL'];
// Measured on Tamil finance sentences: classic-colloquial reads naturally and keeps
// APR and EMI as they are. Modern-colloquial changed meaning on some sentences, and
// formal mistranslated "lender" as "mortgagor", so it is only the last resort.
const STYLES = ['classic-colloquial', 'modern-colloquial', 'formal'];
export const SARVAM_LANG = { en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN', te: 'te-IN', bn: 'bn-IN', mr: 'mr-IN', gu: 'gu-IN', kn: 'kn-IN', ml: 'ml-IN', od: 'od-IN', pa: 'pa-IN' };
// Sarvam Translate reaches the other scheduled languages. Bulbul does not speak them yet,
// so MITRA understands them and answers on screen.
export const SCREEN_ONLY_LANG = { as: 'as-IN', brx: 'brx-IN', doi: 'doi-IN', kok: 'kok-IN', ks: 'ks-IN', mai: 'mai-IN', mni: 'mni-IN', ne: 'ne-IN', sa: 'sa-IN', sat: 'sat-IN', sd: 'sd-IN', ur: 'ur-IN' };
const langCode = (lang) => SARVAM_LANG[lang] || SCREEN_ONLY_LANG[lang];

export const sarvamAvailable = () => Boolean(sarvamKey());

async function postJson(path, body, { timeoutMs = 12000, retries = 1, cache = true } = {}) {
  const text = JSON.stringify(body);
  const key = cache && ['/translate', '/text-to-speech', '/transliterate'].includes(path) ? cacheKey(path, text) : null;
  if (key) {
    const cached = await readVoiceCache(key);
    if (cached) { countCall(path, { cached: true, chars: 0 }); return JSON.parse(cached.toString('utf8')); }
  }
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(BASE + path, {
        method: 'POST', body: text, signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json', 'api-subscription-key': sarvamKey() },
      });
      const raw = Buffer.from(await res.arrayBuffer());
      countCall(path, { ms: Date.now() - started, ok: res.ok, status: res.status, chars: String(body.input || body.inputs?.[0] || '').length });
      if (res.ok) {
        if (key) await writeVoiceCache(key, raw);
        return JSON.parse(raw.toString('utf8'));
      }
      last = new Error(`Sarvam ${path} returned ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (error) { countCall(path, { ms: Date.now() - started, ok: false }); last = error; }
  }
  throw last;
}

// Sentence ends only: a '.' inside 17.7 or cybercrime.gov.in is not a full stop, and
// nothing is ever dropped, because text missing here would also escape the fence.
export function splitSentences(text) {
  const value = String(text);
  const parts = [];
  let start = 0;
  for (const end of value.matchAll(/[.!?।]+(?=\s|$)/g)) {
    parts.push(value.slice(start, end.index + end[0].length));
    start = end.index + end[0].length;
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

const translateOnce = async (text, lang, style) => {
  const wide = Boolean(SCREEN_ONLY_LANG[lang]);
  const data = await postJson('/translate', {
    input: text.replace(/\s*=\s*/g, ' is '), source_language_code: 'en-IN', target_language_code: langCode(lang),
    model: wide ? WIDE_TRANSLATE_MODEL : TRANSLATE_MODEL, mode: wide ? 'formal' : style, numerals_format: 'international', speaker_gender: 'Female', ...(wide ? {} : { enable_preprocessing: true }),
  }, { timeoutMs: TRANSLATE_BUDGET_MS, retries: 0 });
  return (data.translated_text || '').trim();
};

// `corrupt` is fault injection for the demo: it changes one digit in what the
// translator returned, so the audience can watch the fence reject the sentence.
const corruptFigure = (text) => {
  const [figure] = figuresIn(text);
  if (!figure) return text;
  const digit = figure.search(/[1-9]/);
  const changed = figure.slice(0, digit) + ((Number(figure[digit]) % 9) + 1) + figure.slice(digit + 1);
  return text.replace(/\d+(?:[.,]\d+)*/, changed);
};

// A caller is waiting, so translation has a hard budget. A sentence that misses it
// stays in English, which is safe: the figures in it are the engine's own.
const TRANSLATE_BUDGET_MS = 8000;

export async function translateFenced(english, lang, { corrupt = false } = {}) {
  const sentences = splitSentences(english);
  const deadline = Date.now() + TRANSLATE_BUDGET_MS;
  const lines = await Promise.all(sentences.map(async (sentence) => {
    const attempts = [];
    for (const style of SCREEN_ONLY_LANG[lang] ? ['formal'] : STYLES) {
      if (Date.now() >= deadline) { attempts.push({ style, ok: false, error: 'Out of time' }); break; }
      try {
        const raw = await translateOnce(sentence, lang, style);
        const out = corrupt && figuresIn(sentence).length ? corruptFigure(raw) : raw;
        const check = checkFigures(sentence, out);
        attempts.push({ style, ok: check.ok, missing: check.missing, added: check.added });
        if (out && check.ok) return { english: sentence, native: out, ok: true, style, figures: check.checked, attempts };
      } catch (error) { attempts.push({ style, ok: false, error: error.message }); }
    }
    return { english: sentence, native: sentence, ok: false, rejected: figuresIn(sentence).length > 0, figures: figuresIn(sentence), attempts };
  }));
  // The whole reply is checked as well, so a line lost anywhere can't pass unnoticed.
  const native = lines.map((line) => line.native).join(' ');
  if (!checkFigures(english, native).ok) {
    return { native: english, lines: lines.map((line) => (line.ok ? { ...line, native: line.english, ok: false, rejected: line.figures.length > 0 } : line)) };
  }
  return { native, lines };
}

export async function questionToEnglish(text, lang = null) {
  const wide = Boolean(SCREEN_ONLY_LANG[lang]);
  // A customer's own words are never written to the disk cache.
  const data = await postJson('/translate', { input: String(text).slice(0, 1000), source_language_code: wide ? SCREEN_ONLY_LANG[lang] : 'auto', target_language_code: 'en-IN', model: wide ? WIDE_TRANSLATE_MODEL : TRANSLATE_MODEL, numerals_format: 'international', ...(wide ? { mode: 'formal' } : {}) }, { timeoutMs: 6000, retries: 0, cache: false });
  const translated = (data.translated_text || '').trim() || text;
  const check = checkFigures(text, translated);
  return { text: check.ok ? translated : `${translated} ${figuresIn(text).join(' ')}`.trim(), figuresKept: check.ok };
}

export async function identifyLanguage(text) {
  const data = await postJson('/text-lid', { input: String(text).slice(0, 1000) }, { timeoutMs: 3000, retries: 0 });
  const short = (data.language_code || '').split('-')[0];
  return { lang: langCode(short) ? short : null };
}

// Native script to Roman letters, for people who speak a language but read it slowly.
export async function romanise(text, lang) {
  const data = await postJson('/transliterate', { input: String(text).slice(0, 1000), source_language_code: langCode(lang), target_language_code: 'en-IN', numerals_format: 'international', spoken_form: false }, { timeoutMs: 6000, retries: 0 });
  return (data.transliterated_text || '').trim();
}

// The same line over a live phone line: 8 kHz mu-law, first audio in about 200 ms.
export async function streamPhoneAudio(text, lang, onAudio, { speaker = 'neha', signal } = {}) {
  const res = await openSpeechStream(text, { lang, speaker, codec: 'mulaw', sampleRate: 8000, signal });
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onAudio(Buffer.from(value));
  }
}

// Telephony audio: 8 kHz WAV from Bulbul.
export async function speakWav(text, lang, { sampleRate = 8000, speaker = 'neha', pace = 1 } = {}) {
  const data = await postJson('/text-to-speech', {
    inputs: [speakable(text, lang).slice(0, 500)], target_language_code: SARVAM_LANG[lang] || 'en-IN', speaker, model: TTS_MODEL, pace,
    speech_sample_rate: sampleRate, enable_preprocessing: true,
  }, { timeoutMs: 15000 });
  return (data.audios || []).map((audio) => Buffer.from(audio, 'base64'));
}

// Bulbul over HTTP streaming: the first audio arrives in about 300 ms, against about
// 1.8 s for the same sentence over REST. Hands back the open response.
export async function openSpeechStream(text, { lang = 'en', speaker = 'neha', pace = 1, codec = 'mp3', sampleRate = 22050, signal } = {}) {
  const started = Date.now();
  const res = await watch('bulbul', () => fetch(`${BASE}/text-to-speech/stream`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'api-subscription-key': sarvamKey() },
    body: JSON.stringify({ text: speakable(text, lang).slice(0, 3500), language_code: SARVAM_LANG[lang] || 'en-IN', speaker, model: TTS_MODEL, pace, output_audio_codec: codec, speech_sample_rate: sampleRate, enable_preprocessing: true }),
  }));
  countCall('/text-to-speech/stream', { ms: Date.now() - started, ok: res.ok, status: res.status, chars: String(text).length });
  if (!res.ok) throw Object.assign(new Error(`Sarvam /text-to-speech/stream returned ${res.status}`), { status: res.status });
  return res;
}

export async function transcribeWav(wav, { lang = null, mime = 'audio/wav', name = 'speech.wav', mode = null, model = STT_MODEL, keyterms = true } = {}) {
  const form = new FormData();
  form.append('file', new Blob([wav], { type: mime }), name);
  form.append('model', model);
  form.append('language_code', lang ? langCode(lang) : 'unknown');
  if (mode) form.append('mode', mode);
  if (keyterms && model === 'saaras:v4') form.append('keyterms', JSON.stringify(KEYTERMS));
  const started = Date.now();
  const res = await watch('saaras', () => fetch(`${BASE}/speech-to-text`, { method: 'POST', body: form, headers: { 'api-subscription-key': sarvamKey() }, signal: AbortSignal.timeout(15000) }));
  countCall('/speech-to-text', { ms: Date.now() - started, ok: res.ok, status: res.status });
  if (!res.ok) throw new Error(`Sarvam /speech-to-text returned ${res.status}`);
  const data = await res.json();
  const short = (data.language_code || '').split('-')[0];
  return { transcript: (data.transcript || '').trim(), lang: langCode(short) ? short : null, raw: data.language_code || '', confidence: data.language_probability ?? 0 };
}
