// TalkingHead (3D) integration — drives a Ready Player Me / Mixamo-rigged glTF
// avatar. Replaces every 2D SVG MITRA avatar in the app (see TalkingHeadAvatar.jsx).
//
// TalkingHead's own speakText/speakAudio lip-sync expects Google Cloud TTS or
// word-level timestamps, and only ships lip-sync language modules for a handful
// of languages (not Hindi/Tamil/Telugu/... which MITRA speaks via Sarvam). So we
// never call those methods — instead we drive the avatar's viseme blend shapes
// live from the same amplitude-based mouth signal that already animates the 2D
// SVG avatar (subscribeSpeechMotion in speechMotion.js), which works for every
// language and every audio source the app already uses. This is the officially
// documented "direct blend shape control" pattern (TalkingHead README, Appendix F):
// setting `head.mtAvatar[key].realtime` bypasses TalkingHead's own animation/
// smoothing so our values apply immediately, frame to frame.
import { subscribeSpeechMotion } from './speechMotion.js';
import { getAvatarMode } from './avatarMode.js';

export const AVATAR_URL = `${import.meta.env.BASE_URL}avatars/mitra.glb`;

export function supportsTalkingHead() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch {
    return false;
  }
}

// Nearly every screen mounts at least one TalkingHeadAvatar when 3D mode is
// on (the chat header alone guarantees it), so the "only pay for it if you
// use it" deferral this module already gets from being dynamically imported
// is mostly spent by the time the first instance mounts. What still matters
// is not re-paying the JS chunk (~975KB) and GLB (4.7MB) cost for every one
// of the 2-3 simultaneous instances a single screen can have (chat header +
// companion + a card), and not making whichever avatar happens to be first
// in the session (often the login screen) pay the *entire* cold-start cost
// alone. Kick both off into cache as soon as this module is first evaluated
// — but only when 3D mode is actually selected (default is 2D; prefetching
// ~5.6MB nobody's going to use is pure waste for the common case) — and
// reuse the TalkingHead class import across every loadTalkingHead call.
let talkingHeadModulePromise;
function importTalkingHead() {
  talkingHeadModulePromise ??= Promise.all([import('@met4citizen/talkinghead'), import('three')]).then(([th, THREE]) => {
    THREE.Cache.enabled = true; // share the parsed-texture/loader cache across every instance on the page
    return th;
  });
  return talkingHeadModulePromise;
}
if (typeof window !== 'undefined' && getAvatarMode() === '3d' && supportsTalkingHead()) {
  fetch(AVATAR_URL).catch(() => {}); // best-effort cache warm; loadTalkingHead's own fetch still handles failure
  importTalkingHead().catch(() => {}); // ditto for the JS chunk itself, not just the GLB bytes
}

// Browsers cap live WebGL contexts (observed directly: Chromium logs "Too many
// active WebGL contexts. Oldest context will be lost." once too many mount at
// once — the one it silently evicts then renders permanently blank, with no
// error the app can react to at the eviction site itself). Rather than let the
// browser pick an arbitrary victim, cap how many TalkingHead instances this
// app will create at once; anything past the cap fails fast so the caller
// falls back to the 2D SVG instead of risking a blank, evicted canvas.
//
// The app's normal steady state already runs 3 avatars at once (chat header +
// companion + a dashboard card), so a cap of 3 left zero headroom for a 4th
// ever mounting even briefly during navigation — the 2D fallback was showing
// up far more than intended. Real GPU-accelerated browsers comfortably support
// well more than that (commonly 8-16); 3 was only ever calibrated to this
// project's software-rendered (swiftshader) test sandbox, not real hardware.
const MAX_CONCURRENT_HEADS = 6;
let activeHeadCount = 0;

// happy/thinking/excited (MITRA) → neutral/happy/angry/sad/fear/disgust/love/sleep (TalkingHead)
const MOOD_MAP = { happy: 'happy', thinking: 'neutral', excited: 'happy' };
export const mapMood = (mood) => MOOD_MAP[mood] || 'neutral';

// wave/thumbs-up/point-left/point-right/listen/explain/idle (MITRA) → TalkingHead's
// built-in gestures: handup, index, ok, thumbup, thumbdown, side, shrug, namaste.
// 'namaste' fits MITRA's greeting far better than a generic wave. 'explain' is an
// open-hand "talking you through it" pose for while she's actively speaking with
// no more specific gesture active — without it she just goes still/idle the moment
// she starts answering, which reads as far less alive than the 2D avatar was.
const GESTURE_MAP = {
  wave: { name: 'namaste' },
  'thumbs-up': { name: 'thumbup' },
  'point-left': { name: 'index', mirror: true },
  'point-right': { name: 'index' },
  listen: { name: 'handup' },
  explain: { name: 'side' },
};
export function applyGesture(head, gesture) {
  const mapped = GESTURE_MAP[gesture];
  if (!mapped) { head.stopGesture(); return; }
  head.playGesture(mapped.name, 3, !!mapped.mirror);
}

// The GLB's outfit ("Wolf3D_Outfit_Top"/"_Bottom") is a generic RPM fabric
// texture, not a saree — draping an actual saree needs modeled garment
// geometry no code change can add. This is the closest honest substitute:
// retint the existing outfit meshes to MITRA's own brand colors (the same
// orange/green already used for MITRA elsewhere in this app).
const OUTFIT_ORANGE = '#ff8a3c';
const OUTFIT_TEAL = '#087d70';
const OUTFIT_COLORS = { Wolf3D_Outfit_Top: OUTFIT_ORANGE, Wolf3D_Outfit_Bottom: OUTFIT_TEAL };

function applyBrandOutfit(head) {
  head.scene?.traverse((object) => {
    const color = OUTFIT_COLORS[object.name];
    if (!color || !object.isMesh) return;
    (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => {
      if (!material) return;
      // Flat brand color instead of the original fabric texture. TalkingHead's
      // scene lighting is tuned very bright (direct light intensity 30) for
      // photographed fabric with naturally low diffuse reflectance; a flat,
      // saturated hex color as a lit diffuse surface blows out to near-white
      // under that light. So the color is driven entirely through emissive
      // (unlit, unaffected by scene light intensity) with diffuse zeroed out
      // — reads as a crisp, correct brand color regardless of scene lighting.
      material.map = null;
      material.metalnessMap = null;
      material.roughnessMap = null;
      material.metalness = 0;
      material.roughness = 1;
      material.color?.set('#000000');
      material.emissive?.set(color);
      if (material.emissiveIntensity !== undefined) material.emissiveIntensity = 1;
      material.needsUpdate = true;
    });
  });
}

// One TalkingHead instance per mounted component (each needs its own scene/
// WebGL context/blend shape state), but the underlying module + Three.js chunk
// (~600KB+) is fetched once and reused via importTalkingHead()'s cached promise.
// `stage` picks a closer head-and-shoulders framing for the small, non-"stage"
// spots (chat header, nav, onboarding, ...) versus the fuller upper-body framing
// used at MITRA's three full-size stage moments.
// `onContextLost` is called if the browser forcibly evicts this instance's
// WebGL context later in its life (see MAX_CONCURRENT_HEADS above) — the
// caller should treat that as a signal to fall back to the 2D SVG, since a
// lost context renders nothing from then on. `signal` lets the caller abort a
// load already in flight — critical under React StrictMode, whose dev-only
// double-mount briefly creates a "phantom" instance for every component that
// otherwise wouldn't release its budget slot until its full load (import +
// construct + showAvatar) finished, starving the real instance mounting right
// behind it of a slot it should have gotten immediately.
export async function loadTalkingHead(container, { mood = 'happy', stage = false, onContextLost, signal } = {}) {
  const abortedError = () => new Error('talkinghead-aborted');
  if (signal?.aborted) throw abortedError();
  // React 18 StrictMode's dev-only double-invoke runs a component's mount,
  // its cleanup, and its second mount all synchronously within one commit —
  // so a "phantom" first-mount call reaches this exact point, synchronously,
  // before its own cleanup has had any chance to fire and abort it. Yielding
  // one macrotask here lets that (synchronous) cleanup run first, so a
  // phantom instance's `signal` is already aborted by the time it would
  // otherwise have claimed — and never released in time — a budget slot.
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (signal?.aborted) throw abortedError();
  if (activeHeadCount >= MAX_CONCURRENT_HEADS) {
    throw new Error('talkinghead-budget-exceeded');
  }
  activeHeadCount++; // reserved synchronously (post-yield), so concurrent callers can't both slip past the check
  let head;
  try {
    const { TalkingHead } = await importTalkingHead();
    if (signal?.aborted) throw abortedError();
    head = new TalkingHead(container, {
      lipsyncModules: [], // lip-sync is driven live from waveform amplitude, not text
      cameraView: stage ? 'upper' : 'head',
      avatarMood: mapMood(mood),
    });
    await head.showAvatar({ url: AVATAR_URL, body: 'F', avatarMood: mapMood(mood) });
    if (signal?.aborted) throw abortedError();
    applyBrandOutfit(head);
    // showAvatar() resolves once the scene graph is built, not once a frame has
    // actually painted — swapping the 2D fallback for the canvas immediately
    // left a real, visible gap where the canvas was "ready" but still blank.
    // A fixed frame-tick count isn't reliable here: the very first render() a
    // freshly-created WebGLRenderer ever does can itself be slow (shader
    // compilation, texture upload), especially for whichever avatar happens to
    // be the first one created in the whole session (e.g. the login screen,
    // paying the *entire* cold-start cost — JS chunk fetch, GLB parse, first
    // compile — alone). So wait for actual evidence of real painted frames via
    // the renderer's own frame counter, not just N ticks of the clock, capped
    // by a timeout so a renderer that never manages to paint doesn't hang the
    // caller forever.
    await new Promise((resolve) => {
      const renderer = head.renderer;
      const targetFrame = (renderer?.info.render.frame || 0) + 3;
      const deadline = performance.now() + 4000;
      const check = () => {
        if (!renderer || renderer.info.render.frame >= targetFrame || performance.now() > deadline) { resolve(); return; }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    if (signal?.aborted) throw abortedError();
    head.renderer?.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault(); // allow a future context restore attempt instead of a hard browser-level failure
      onContextLost?.();
    });
    return head;
  } catch (error) {
    activeHeadCount--;
    try { head?.dispose(); } catch { /* best-effort cleanup of a partial instance */ }
    throw error;
  }
}

// Oculus viseme blend shape keys TalkingHead's avatars ship with.
const VISEME_KEYS = ['viseme_aa', 'viseme_E', 'viseme_O', 'viseme_U', 'viseme_PP'];

function setRealtime(head, key, value) {
  const shape = head.mtAvatar?.[key];
  if (!shape) return;
  shape.realtime = value;
  shape.needsUpdate = true;
}

// Releases the viseme blend shapes back to TalkingHead's own idle animation.
export function restTalkingHeadMouth(head) {
  VISEME_KEYS.forEach((key) => setRealtime(head, key, null));
}

// Subscribes to the shared mouth-shape signal and pushes it into the mounted
// avatar's viseme blend shapes each tick. Mirrors Avatar.jsx's own pattern:
// call this only while speaking is true, and call restTalkingHeadMouth when it
// stops. Returns an unsubscribe function.
export function driveTalkingHeadMouth(head) {
  return subscribeSpeechMotion(({ open, round, wide, active }) => {
    if (!active) { restTalkingHeadMouth(head); return; }
    setRealtime(head, 'viseme_aa', open * (1 - round));
    setRealtime(head, 'viseme_O', open * round);
    setRealtime(head, 'viseme_U', round * (1 - open));
    setRealtime(head, 'viseme_E', wide * (1 - round) * 0.6);
    setRealtime(head, 'viseme_PP', open < 0.05 ? 0.3 : 0);
  });
}

// head.dispose() (not just stop()) — it also tears down the renderer, WebGL
// context and audio nodes, which matters here since the avatar mounts/unmounts
// repeatedly as the user moves between call/chat/presenter views.
export function disposeTalkingHead(head) {
  if (!head) return;
  try { restTalkingHeadMouth(head); } catch { /* avatar already torn down */ }
  try { head.dispose(); } catch { /* already disposed */ }
  // Guard against a double-release (e.g. React StrictMode's double-invoked
  // cleanup calling dispose twice on the same instance) undercounting the budget.
  if (!head.__slotReleased) { head.__slotReleased = true; activeHeadCount--; }
}
