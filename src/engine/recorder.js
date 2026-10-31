// Mic capture for Sarvam STT.
//
// The Web Speech API decides for itself when you've stopped talking; Sarvam
// takes a finished audio clip, so MITRA needs her own ears. This records
// webm/opus (what Chrome, Edge and Android give us, and a format Saaras
// accepts directly) and watches the waveform so a hands-free call can end
// the turn on silence instead of making the customer tap anything.

const SPEECH_RMS = 0.02;        // room tone and a speaker tail stay under this
const SILENCE_MS = 900;         // trailing quiet that ends a turn
const MIN_SPEECH_MS = 450;      // a short blip is not a question
const NO_SPEECH_TIMEOUT = 8000; // gave up waiting for the customer to start
const MAX_MS = 20000;           // hard stop, so a hot mic can't record forever

export const canRecord = () =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof window !== 'undefined' &&
  typeof window.MediaRecorder !== 'undefined';

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find((t) => window.MediaRecorder.isTypeSupported?.(t)) || '';
}

/**
 * Records one utterance and resolves with an audio Blob.
 * Returns a handle with .stop() (finish now, keep audio) and .abort() (discard).
 */
export function recordUtterance({ onStart, onLevel, onSilence, autoStop = true } = {}) {
  let stop = () => {};
  let abort = () => {};
  let aborted = false;

  const promise = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // abort() can land while the permission prompt is still open
    if (aborted) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('aborted');
    }

    const mimeType = pickMimeType();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const parts = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);

    // ── level metering / voice activity ──
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    let raf = 0;
    let spoke = false;
    let speechMs = 0;
    let quietSince = 0;
    let lastTick = Date.now();
    const startedAt = Date.now();

    const cleanup = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    };

    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      onLevel?.(Math.min(1, rms * 12)); // 0–1, for the mic animation

      const now = Date.now();
      const elapsed = now - lastTick;
      lastTick = now;
      if (rms > SPEECH_RMS) {
        speechMs += elapsed;
        quietSince = 0;
        if (speechMs >= MIN_SPEECH_MS) spoke = true;
      } else if (spoke) {
        if (!quietSince) quietSince = now;
        else if (autoStop && now - quietSince > SILENCE_MS) {
          onSilence?.();
          rec.state === 'recording' && rec.stop();
          return;
        }
      } else if (autoStop && now - startedAt > NO_SPEECH_TIMEOUT) {
        // never heard anything — end the turn rather than hang on the mic
        rec.state === 'recording' && rec.stop();
        return;
      }
      if (autoStop && now - startedAt > MAX_MS) {
        rec.state === 'recording' && rec.stop();
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const done = new Promise((resolve, reject) => {
      rec.onstop = () => {
        cleanup();
        if (aborted) return reject(new Error('aborted'));
        if (!spoke) return reject(new Error('no-speech'));
        resolve(new Blob(parts, { type: mimeType || 'audio/webm' }));
      };
      rec.onerror = (e) => {
        cleanup();
        reject(e.error || new Error('record-failed'));
      };
    });

    stop = () => rec.state === 'recording' && rec.stop();
    abort = () => {
      aborted = true;
      rec.state === 'recording' ? rec.stop() : cleanup();
    };

    rec.start();
    onStart?.();
    raf = requestAnimationFrame(tick);
    return done;
  })();

  return {
    result: promise,
    stop: () => stop(),
    abort: () => {
      aborted = true;
      abort();
    },
  };
}
