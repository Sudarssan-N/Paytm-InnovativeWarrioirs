// Shared speech animation. Neural audio uses its measured waveform; device
// speech uses text articulation, corrected by word-boundary events when available.
const listeners = new Set();
export const REST_MOUTH = Object.freeze({ open: 0, round: 0, wide: 0, active: false });
let snapshot = REST_MOUTH;
let stopDriver = () => {};
let context;
let motionGeneration = 0;

export function subscribeSpeechMotion(listener) {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}
function emit(value) { snapshot = value; listeners.forEach((listener) => listener(value)); }
export function stopSpeechMotion() {
  motionGeneration++;
  stopDriver();
  stopDriver = () => {};
  emit(REST_MOUTH);
}

export function mouthFromWaveform(samples, previous = 0) {
  if (!samples.length) return 0;
  const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  const target = Math.min(1, Math.max(0, (rms - .012) * 7));
  // A quick release closes the mouth through pauses rather than holding it open.
  return target < .02 ? 0 : previous + (target - previous) * .65;
}

export function mouthForLetter(letter) {
  const c = (letter || '').toLowerCase();
  if (!c || /[\s.,!?;:mbp]/.test(c)) return { open: 0, round: 0, wide: 0 };
  if (/[ou]/.test(c)) return { open: .65, round: .9, wide: 0 };
  if (/[ae]/.test(c)) return { open: c === 'a' ? .9 : .6, round: 0, wide: .8 };
  if (/[iy]/.test(c)) return { open: .35, round: 0, wide: 1 };
  return { open: .3, round: .15, wide: .2 };
}

// Call from the user's Play/Send event, before any network await, to unlock
// WebAudio. If unavailable, normal media playback remains untouched.
export function prepareSpeechMotion() {
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    if (!context || context.state === 'closed') context = new Ctor();
    if (context.state === 'suspended') context.resume().catch(() => {});
  } catch { /* voice remains available without waveform animation */ }
}

export function beginTextSpeechMotion(text, rate = 1) {
  stopSpeechMotion();
  let index = 0;
  let start = performance.now();
  let frame;
  let last = 0;
  const tick = (now) => {
    if (now - last > 45) {
      last = now;
      const cursor = Math.min(text.length - 1, index + Math.floor((now - start) / (65 / rate)));
      emit({ ...mouthForLetter(text[cursor]), active: true });
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  stopDriver = () => cancelAnimationFrame(frame);
  const generation = motionGeneration;
  return (charIndex) => {
    if (motionGeneration !== generation) return;
    index = charIndex;
    start = performance.now();
  };
}

export function attachAudioSpeechMotion(element) {
  stopSpeechMotion();
  // Do not route audio through a suspended context: that would mute it.
  if (!context || context.state !== 'running') return false;
  let source;
  let analyser;
  let frame;
  try {
    source = context.createMediaElementSource(element);
    analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    analyser.connect(context.destination);
    const samples = new Float32Array(analyser.fftSize);
    let open = 0;
    let last = 0;
    const tick = (now) => {
      if (now - last > 40) {
        last = now;
        analyser.getFloatTimeDomainData(samples);
        open = element.paused ? 0 : mouthFromWaveform(samples, open);
        emit({ open, round: Math.max(0, .7 - open), wide: open, active: !element.paused });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    stopDriver = () => { cancelAnimationFrame(frame); source.disconnect(); analyser.disconnect(); };
    return true;
  } catch {
    // If source creation succeeded, preserve audible output even when the
    // optional analyser setup failed.
    source?.disconnect();
    if (source) {
      source.connect(context.destination);
      stopDriver = () => source.disconnect();
    }
    return false;
  }
}
