// What every game shares: lines translated behind the figures fence, MITRA's voice,
// small sound effects, and the receipt that records what the customer understood.
import { useEffect, useRef, useState } from 'react';
import { sarvamStreamUrl } from '../../engine/sarvam.js';
import { postJourney } from './useJourney.js';

export const GAME_LANGUAGES = [['en', 'English'], ['hi', 'हिन्दी'], ['ta', 'தமிழ்'], ['te', 'తెలుగు'], ['bn', 'বাংলা'], ['mr', 'मराठी'], ['gu', 'ગુજરાતી'], ['kn', 'ಕನ್ನಡ'], ['ml', 'മലയാളം'], ['od', 'ଓଡ଼ିଆ'], ['pa', 'ਪੰਜਾਬੀ']];

export async function translateLines(lang, lines) {
  if (lang === 'en') return lines;
  try {
    const out = await postJourney('/game/translate', { lang, lines });
    return { ...lines, ...out.lines };
  } catch { return lines; }
}

// English shows at once and is replaced as the translation lands.
export function useLines(lang, lines) {
  const [translated, setTranslated] = useState(lines);
  const signature = JSON.stringify(lines);
  useEffect(() => {
    let live = true;
    setTranslated(lines);
    translateLines(lang, lines).then((out) => { if (live) setTranslated(out); });
    return () => { live = false; };
  }, [lang, signature]); // eslint-disable-line react-hooks/exhaustive-deps
  return translated;
}

let voice = null;
export function stopLine() {
  if (voice) { voice.onended = null; voice.onerror = null; voice.pause(); voice.src = ''; voice = null; }
}

export function speakLine(text, lang, { muted = false, onEnd = () => {} } = {}) {
  stopLine();
  const url = muted ? null : sarvamStreamUrl(text, { lang });
  if (!url) { onEnd(false); return; }
  const el = new Audio(url);
  voice = el;
  el.onended = () => onEnd(true);
  el.onerror = () => onEnd(false);
  el.play().catch(() => onEnd(false));
}

let audio = null;
export function beep(frequency, seconds = 0.08, type = 'sine', gain = 0.05) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audio.createOscillator();
    const volume = audio.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    volume.gain.setValueAtTime(gain, audio.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + seconds);
    osc.connect(volume).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + seconds);
  } catch { /* a game without sound is still a game */ }
}

// Records what the customer understood. The server re-grades the answers itself.
export async function sealUnderstanding(sessionId, body) {
  const session = sessionId || (await postJourney('/session', { channel: 'app' })).state.sessionId;
  return postJourney(`/${session}/understanding`, body);
}

export const useLatest = (value) => {
  const ref = useRef(value);
  ref.current = value;
  return ref;
};
