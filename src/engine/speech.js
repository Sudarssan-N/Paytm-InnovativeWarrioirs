// Voice layer — Sarvam AI first, Web Speech API as the fallback.
//
// Sarvam (Bulbul v3 TTS + Saaras v3 STT) is what makes MITRA actually usable
// in India: a real Tamil/Telugu/Kannada/Malayalam voice on every device, and
// a mic that identifies which language the customer spoke instead of making
// them pick one first. Without a Sarvam key everything silently falls back to
// the browser's own speech engine, so the demo never breaks.
import { hasSarvam, sarvamStreamUrl, synthesize, transcribe, getSarvamSpeaker } from './sarvam.js';
import { recordUtterance, canRecord } from './recorder.js';
import { prepareSpeechMotion, attachAudioSpeechMotion, beginTextSpeechMotion, stopSpeechMotion } from './speechMotion.js';

// speech-synth BCP-47 tags per language
const SPEECH_LANG = {
  en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN', te: 'te-IN', bn: 'bn-IN',
  mr: 'mr-IN', gu: 'gu-IN', kn: 'kn-IN', ml: 'ml-IN',
};

const VOICE_PREF = 'mitra_voice';

let voices = [];

// ── Web Speech fallback: rank installed voices, best-sounding first ──
// Higher score = more natural. Neural/online voices > enhanced > defaults.
function scoreVoice(v) {
  const name = v.name.toLowerCase();
  let s = 0;
  if (/natural|neural|online/.test(name)) s += 60;
  if (/premium|enhanced/.test(name)) s += 40;
  if (name.includes('google')) s += 30;
  if (v.lang === 'en-IN') s += 25;
  if (/en-GB|en-AU/.test(v.lang)) s += 10;
  if (v.lang.startsWith('en')) s += 10;
  if (/female|veena|kanya|isha|neerja|samantha|karen|tessa|moira|serena|sonia|libby|aria|ava|zira/.test(name)) s += 15;
  if (/male|daniel|rishi|alex|fred|eddy|reed|grandpa|rocko|bahh|albert|bad news|bells|boing|bubbles|cellos|jester|organ|trinoids|whisper|wobble|zarvox/.test(name)) s -= 40;
  return s;
}

function refreshVoices() {
  if (typeof window === 'undefined') return;
  voices = window.speechSynthesis?.getVoices?.() || [];
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

export function listVoices() {
  refreshVoices();
  return voices
    .filter((v) => v.lang.startsWith('en'))
    .sort((a, b) => scoreVoice(b) - scoreVoice(a));
}

// Best installed voice for any language code (hi, ta, te, bn, mr, gu, kn, ml…)
function voiceForLang(langCode) {
  refreshVoices();
  const prefix = (SPEECH_LANG[langCode] || 'en-IN').slice(0, 2);
  const pool = voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
  return (
    pool.find((v) => /natural|neural|online|google/i.test(v.name)) ||
    pool.find((v) => /female|lekha|swara|veena/i.test(v.name)) ||
    pool[0] ||
    null
  );
}

export const getPreferredVoiceName = () => localStorage.getItem(VOICE_PREF) || '';
export const setPreferredVoiceName = (name) => localStorage.setItem(VOICE_PREF, name);

// ── speaking speed ───────────────────────────────────────────
// One setting for both engines: Bulbul takes it as `pace`, the browser voice
// as `rate`. Bulbul accepts 0.3–3.0, but MITRA reads out rupee figures, so the
// range is kept to where numbers stay easy to follow.
const PACE_PREF = 'mitra_speech_pace';
const MIN_PACE = 0.7;
const MAX_PACE = 1.5;
export const DEFAULT_PACE = 1;
export const SPEECH_PACES = [
  { id: 'slow', label: 'Slow', pace: 0.85 },
  { id: 'normal', label: 'Normal', pace: DEFAULT_PACE },
  { id: 'brisk', label: 'Brisk', pace: 1.15 },
  { id: 'fast', label: 'Fast', pace: 1.3 },
];

export function clampPace(value) {
  const n = Number(value);
  if (value == null || value === '' || !Number.isFinite(n)) return DEFAULT_PACE;
  return Math.min(MAX_PACE, Math.max(MIN_PACE, n));
}

export function getSpeechPace() {
  try {
    return clampPace(localStorage.getItem(PACE_PREF));
  } catch {
    return DEFAULT_PACE;
  }
}

export function setSpeechPace(value) {
  try {
    localStorage.setItem(PACE_PREF, String(clampPace(value)));
  } catch { /* storage blocked — the choice just won't persist */ }
}

function currentVoice() {
  refreshVoices();
  const pref = getPreferredVoiceName();
  if (pref) {
    const match = voices.find((v) => v.name === pref);
    if (match) return match;
  }
  return listVoices()[0] || null;
}

// ── playback state ───────────────────────────────────────────
// One utterance at a time. `token` invalidates in-flight Sarvam requests when
// the customer interrupts, so a slow response can't speak over the next reply.
let audioEl = null;
let token = 0;

function stopAudio() {
  stopSpeechMotion();
  if (audioEl) {
    audioEl.pause();
    audioEl.src = '';
    audioEl = null;
  }
}

// Plays a *growing* list of clips back to back as one continuous reply.
// Long answers arrive batch by batch, so playback starts on the first batch
// while the rest are still being synthesized. `done()` says no more are
// coming, which is what lets the player know when the reply has truly ended.
function createPlayer({ onEnd, onPlaybackStart, onPlaybackFailure, myToken, motionText = () => '', motionRate = 1 }) {
  const urls = [];
  let i = 0;
  let playing = false;
  let complete = false;
  let playbackStarted = false;
  let playbackFailed = false;
  let finished = false;

  const finish = () => {
    if (finished || myToken !== token) return;
    finished = true;
    urls.forEach(URL.revokeObjectURL);
    audioEl = null;
    if (!playbackStarted && urls.length) {
      if (!playbackFailed) {
        playbackFailed = true;
        onPlaybackFailure?.();
      }
      return;
    }
    onEnd?.();
  };

  const step = () => {
    if (myToken !== token) return; // interrupted by the next utterance
    stopSpeechMotion();
    if (i >= urls.length) {
      playing = false;
      if (complete) finish();
      return; // more batches still landing — the next push resumes us
    }
    playing = true;
    const el = new Audio(urls[i++]);
    audioEl = el;
    const tracked = attachAudioSpeechMotion(el);
    let advanced = false;
    const next = () => { if (!advanced) { advanced = true; step(); } };
    el.onended = next;
    el.onerror = next; // a bad clip shouldn't strand the rest of the reply
    el.play()
      .then(() => {
        if (myToken !== token) { el.pause(); return; }
        if (advanced) return;
        if (!tracked) beginTextSpeechMotion(motionText(), motionRate);
        if (!playbackStarted) {
          playbackStarted = true;
          onPlaybackStart?.();
        }
      })
      .catch(next);
  };

  return {
    push(next) {
      urls.push(...next);
      if (!playing) step();
    },
    done() {
      complete = true;
      if (!playing) step();
    },
    discard() {
      urls.forEach(URL.revokeObjectURL);
    },
  };
}

function speakWebSpeech(text, { onStart, onEnd, lang, voiceGender, playful = false, pace = DEFAULT_PACE }) {
  if (!window.speechSynthesis) {
    onEnd?.();
    return false;
  }
  window.speechSynthesis.cancel();
  // strip emoji/markdown, and add gentle pauses at sentence breaks
  const clean = text
    .replace(/[*_#`]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/₹/g, lang === 'en' ? ' rupees ' : ' ₹ ')
    .replace(/\s+/g, ' ')
    .trim();
  const u = new SpeechSynthesisUtterance(clean);
  let v = lang === 'en' ? currentVoice() : voiceForLang(lang);
  if (voiceGender === 'boy') {
    refreshVoices();
    v = voices.find((voice) => voice.lang.startsWith(lang) && /\b(daniel|rishi|alex|david|mark|aaron|ravi|george|guy|male)\b/i.test(voice.name)) || v;
  }
  if (v) u.voice = v;
  u.lang = SPEECH_LANG[lang] || 'en-IN';
  u.rate = 0.98 * pace;
  u.pitch = playful ? 1.15 : voiceGender === 'boy' ? 1 : 1.04;
  const speechToken = token;
  let boundary;
  u.onstart = () => {
    if (speechToken !== token) return;
    boundary = beginTextSpeechMotion(clean, u.rate);
    onStart?.('device');
  };
  u.onboundary = (event) => { if (speechToken === token) boundary?.(event.charIndex); };
  u.onpause = () => { if (speechToken === token) stopSpeechMotion(); };
  u.onresume = (event) => {
    if (speechToken !== token) return;
    boundary = beginTextSpeechMotion(clean, u.rate);
    boundary(event.charIndex || 0);
  };
  const finish = () => { if (speechToken === token) { stopSpeechMotion(); onEnd?.(); } };
  u.onend = finish;
  u.onerror = finish;
  window.speechSynthesis.speak(u);
  return true;
}

/**
 * Speak a reply. Sarvam's Bulbul voice when a key is present, otherwise the
 * browser's. onStart fires when audio actually begins, so the avatar's mouth
 * only moves once there is sound, and receives the engine that produced it
 * ('sarvam' | 'device') so the UI can never claim the wrong one. onFallback
 * fires if we had to drop to the browser voice — the caller surfaces that
 * rather than letting MITRA silently turn robotic, which reads to the
 * customer as the product breaking.
 */
export function speak(text, { onStart, onEnd, onFallback, lang = 'en', speaker, voiceGender, playful = false, pace, engine = 'auto' } = {}) {
  stopSpeaking();
  prepareSpeechMotion();
  const myToken = ++token;
  if (!text?.trim()) {
    onEnd?.();
    return false;
  }
  // an explicit pace wins; otherwise the customer's saved speed applies
  const speed = pace == null ? getSpeechPace() : clampPace(pace);

  if (hasSarvam() && engine !== 'device') {
    const fallbackToDevice = () => {
      onFallback?.();
      speakWebSpeech(text, { onStart, onEnd, lang, voiceGender, playful, pace: speed });
    };
    let started = false;
    const player = createPlayer({
      onEnd,
      myToken,
      motionText: () => text,
      motionRate: speed,
      onPlaybackStart: () => {
        started = true;
        onStart?.('sarvam');
      },
      onPlaybackFailure: fallbackToDevice,
    });

    const streamUrl = sarvamStreamUrl(text, { lang, speaker: speaker || getSarvamSpeaker(), pace: speed });
    if (streamUrl) {
      player.push([streamUrl]);
      player.done();
      return true;
    }

    synthesize(text, {
      lang,
      speaker: speaker || getSarvamSpeaker(),
      pace: speed,
      onBatch: (urls) => {
        if (myToken !== token) {
          urls.forEach(URL.revokeObjectURL);
          return;
        }
        player.push(urls);
      },
    })
      .then((all) => {
        if (myToken !== token) {
          player.discard();
          return;
        }
        if (!all.length) throw new Error('empty-audio');
        player.done();
      })
      .catch(() => {
        if (myToken !== token) return;
        // Already speaking in Sarvam's voice — switching to the robotic one
        // mid-sentence is worse than just ending the reply there.
        if (started) {
          player.done();
          return;
        }
        player.discard();
        fallbackToDevice();
      });
    return true;
  }

  return speakWebSpeech(text, { onStart, onEnd, lang, voiceGender, playful, pace: speed });
}

/**
 * Speak a reply that is still being written. Sentences are pushed in as the
 * LLM streams them; each is synthesized in order and queued, so MITRA starts
 * talking while she is still composing rather than after.
 */
export function speakStream({ lang = 'en', onStart, onEnd, onFallback, pace } = {}) {
  stopSpeaking();
  prepareSpeechMotion();
  const myToken = ++token;
  // read once, so every sentence of one reply is spoken at the same speed
  const speed = pace == null ? getSpeechPace() : clampPace(pace);

  if (!hasSarvam()) {
    // browser voice can't stream — buffer and speak once at the end
    let buffered = '';
    return {
      push: (t) => { buffered += (buffered ? ' ' : '') + t; },
      end: () => speakWebSpeech(buffered, { onStart, onEnd, lang, pace: speed }),
    };
  }

  let started = false;
  let chain = Promise.resolve(); // serialises synthesis so audio stays in order
  let all = '';
  const player = createPlayer({ onEnd, myToken, motionText: () => all, motionRate: speed,
    onPlaybackStart: () => onStart?.('sarvam'),
  });

  return {
    push(sentence) {
      if (!sentence?.trim() || myToken !== token) return;
      all += (all ? ' ' : '') + sentence;
      chain = chain.then(async () => {
        if (myToken !== token) return;
        try {
          const urls = await synthesize(sentence, { lang, speaker: getSarvamSpeaker(), pace: speed });
          if (myToken !== token) {
            urls.forEach(URL.revokeObjectURL);
            return;
          }
          if (!started) {
            started = true;
          }
          player.push(urls);
        } catch {
          // one sentence failing shouldn't strand the rest of the reply
        }
      });
    },
    end() {
      chain = chain.then(() => {
        if (myToken !== token) return;
        if (started) {
          player.done();
          return;
        }
        // nothing ever synthesized — say the whole thing in the browser voice
        onFallback?.();
        speakWebSpeech(all, { onStart, onEnd, lang, pace: speed });
      });
    },
  };
}

export function stopSpeaking() {
  token++;
  stopAudio();
  window.speechSynthesis?.cancel();
}

function cleanSpeech(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097f\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// The call mic sits next to the speaker. A transcript that is just MITRA's
// own last line — or the "Hi" at the start of it — must not be asked back to her.
export function isAssistantEcho(heard, spoken) {
  const a = cleanSpeech(heard);
  const b = cleanSpeech(spoken);
  if (!a || !b || a === b) return a !== '' && a === b;
  if (/^(hi|hello|hey|namaste|good morning|good evening)$/.test(a) && b.includes(a)) return true;
  const aWords = a.split(' ').filter((word) => word.length > 2);
  const bWords = b.split(' ').filter((word) => word.length > 2);
  if (aWords.length < 4 || bWords.length < 4) return false;
  const heardWords = new Set(aWords);
  const overlap = bWords.filter((word) => heardWords.has(word)).length;
  return overlap / bWords.length >= 0.6;
}

// ── listening ────────────────────────────────────────────────
// Same call signature as before so callers don't care which engine ran:
//   listen({ onResult(text, detectedLang), onEnd, onError, lang })
// `lang: null` asks Sarvam to auto-detect — that's what lets a customer just
// start speaking Tamil and have MITRA answer in Tamil.
function listenWebSpeech({ onResult, onInterim, onEnd, onError, lang }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    onError?.('Voice input needs Chrome/Edge.');
    return null;
  }
  const rec = new SR();
  rec.lang = SPEECH_LANG[lang] || 'en-IN';
  rec.interimResults = !!onInterim;
  rec.maxAlternatives = 1;
  let delivered = false, aborted = false;
  rec.onresult = (e) => {
    if (aborted || delivered) return;
    let interim = '', final = '';
    for (let i = e.resultIndex || 0; i < e.results.length; i++) {
      if (e.results[i].isFinal !== false) final += `${e.results[i][0].transcript} `;
      else interim += e.results[i][0].transcript;
    }
    onInterim?.(interim);
    if (final.trim()) { delivered = true; onResult?.(final.trim(), null); }
  };
  rec.onend = () => { if (!aborted) onEnd?.(); };
  rec.onerror = (e) => { if (!aborted) onError?.(e.error); };
  rec.start();
  return { stop: () => rec.stop(), abort: () => { aborted = true; rec.abort(); } };
}

export function listen({ onResult, onInterim, onEnd, onError, onLevel, onTranscribing, lang = 'en', autoDetect = true }) {
  if (!hasSarvam() || !canRecord()) {
    return listenWebSpeech({ onResult, onInterim, onEnd, onError, lang });
  }

  const session = recordUtterance({ onLevel });
  let finished = false, aborted = false;

  session.result
    .then(async (blob) => {
      if (aborted) return;
      onEnd?.();          // mic is closed; we're on to transcription
      onTranscribing?.(true);
      // autoDetect leaves language_code as 'unknown' so Saaras identifies it
      const { transcript, detected, confidence } = await transcribe(blob, {
        lang: autoDetect ? null : lang,
      });
      if (aborted) return;
      onTranscribing?.(false);
      finished = true;
      if (!transcript) {
        onError?.('no-speech');
        return;
      }
      // only trust a confident detection — a shaky one would flip MITRA's
      // language mid-conversation for no good reason
      onResult?.(transcript, confidence >= 0.6 ? detected : null);
    })
    .catch((err) => {
      if (aborted) return;
      onTranscribing?.(false);
      if (finished) return;
      const msg = err?.message || 'mic-failed';
      onEnd?.();
      if (msg !== 'aborted') onError?.(msg);
    });

  // matches the Web Speech recognition handle the callers already use
  return { stop: () => session.stop(), abort: () => { aborted = true; session.abort(); } };
}
