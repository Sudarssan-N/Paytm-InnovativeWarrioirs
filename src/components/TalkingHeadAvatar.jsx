import React, { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import {
  supportsTalkingHead, loadTalkingHead, disposeTalkingHead,
  driveTalkingHeadMouth, restTalkingHeadMouth, applyGesture, mapMood,
} from '../engine/talkingHeadMotion.js';
import { getAvatarMode } from '../engine/avatarMode.js';
import './talking-head-avatar.css';

// Drop-in replacement for <Avatar ... /> — every MITRA avatar in the app, from
// the 42px chat header icon up to the three full-size "stage" moments (live
// call, floating companion, presenter). Renders the original 2D SVG avatar
// (a) as the deliberately-chosen mode when Settings has "2D" selected, (b) as
// a brief loading placeholder while the 3D engine starts up, and (c) as the
// permanent fallback on devices without WebGL — there's no dead space or hard
// failure if the 3D engine can't start, and 2D stays a first-class, fully
// featured mode of its own, not just a degraded stand-in for 3D.
export default function TalkingHeadAvatar({
  speaking = false, mood = 'happy', size = 270, gesture = 'idle', gaze = 'center', character, stage = false, elevation = 0,
}) {
  const containerRef = useRef(null);
  const headRef = useRef(null);
  const unsubscribeRef = useRef(null);
  const [mode, setMode] = useState(getAvatarMode);
  const use3D = mode === '3d' && supportsTalkingHead();
  const [status, setStatus] = useState(use3D ? 'loading' : 'unsupported');

  // The device-wide 2D/3D preference (Settings) can change while an avatar is
  // already mounted — every instance on the page needs to react together.
  useEffect(() => {
    const onModeChange = (event) => setMode(event.detail);
    window.addEventListener('mitra-avatar-mode', onModeChange);
    return () => window.removeEventListener('mitra-avatar-mode', onModeChange);
  }, []);

  // Loads (or tears down) the 3D engine whenever `use3D` flips — on mount, and
  // whenever the mode setting is toggled at runtime. Guards against React
  // StrictMode's double-invoke and fast unmounts (e.g. leaving the call screen
  // before the GLB finishes loading, or switching back to 2D mid-load) by
  // disposing immediately if the load resolves after it's no longer wanted.
  useEffect(() => {
    if (!use3D) { setStatus('unsupported'); return undefined; }
    let cancelled = false;
    let retries = 0;
    const controller = new AbortController();

    // A lost context is often transient GPU/browser-context pressure from
    // OTHER avatars on the page, not a real "this device can't do WebGL"
    // failure — permanently giving up on the very avatar the user is
    // actively looking at (e.g. mid live-call) reads as broken. Retry with
    // exponential backoff (giving other instances a chance to have released
    // their own contexts) before actually falling back. React StrictMode's
    // dev-only double-invoke (see loadTalkingHead's own comment) causes
    // meaningfully more of this transient churn than production ever will,
    // so this is deliberately patient — real devices should rarely need more
    // than the first retry or two; this just also rides out dev-mode noise.
    const MAX_RETRIES = 4;
    const retryDelay = () => Math.min(500 * 2 ** retries, 4000);

    const attempt = () => {
      loadTalkingHead(containerRef.current, {
        mood,
        stage,
        signal: controller.signal,
        onContextLost: () => {
          if (cancelled) return;
          disposeTalkingHead(headRef.current);
          headRef.current = null;
          if (retries < MAX_RETRIES) {
            const delay = retryDelay();
            retries++;
            console.warn(`[MITRA avatar] WebGL context lost, retrying in ${delay}ms (${retries}/${MAX_RETRIES})`);
            // Deliberately not setting status back to 'loading' here. If we'd
            // already reached 'ready' once, doing so would swap the canvas
            // out for the 2D SVG and then immediately back again once the
            // retry lands — a visible flicker between two very different-
            // looking avatars. dispose() already removed the dead canvas
            // (head.dispose() calls domElement.remove()), so the container
            // just sits empty — visually just the page background showing
            // through, same as any transparent part of the canvas already
            // looks — until the retry's new canvas repopulates it. If this
            // is the very first load (never reached 'ready'), status is
            // already 'loading' and the 2D SVG is correctly still showing.
            setTimeout(() => { if (!cancelled) attempt(); }, delay);
          } else {
            console.warn('[MITRA avatar] WebGL context lost repeatedly, falling back to 2D');
            setStatus('unsupported');
          }
        },
      }).then((head) => {
        if (cancelled) { disposeTalkingHead(head); return; }
        headRef.current = head;
        applyGesture(head, gesture);
        setStatus('ready');
        // A fresh retry budget for the *next* loss, not a one-time total for
        // this component's whole lifetime — otherwise a component that had,
        // say, 4 transient losses early on (StrictMode churn near mount) would
        // have none left for a genuine loss much later and give up for good.
        retries = 0;
      }).catch((error) => {
        // 'talkinghead-aborted' fires on every StrictMode phantom-mount cleanup
        // in dev — routine, not worth logging. 'talkinghead-budget-exceeded'
        // means too many avatars are mounted at once (see MAX_CONCURRENT_HEADS)
        // — expected under load, not a hard failure, so this stays a 2D fallback
        // rather than a broken state either way.
        if (error?.message !== 'talkinghead-aborted') {
          console.warn('[MITRA avatar] 3D avatar unavailable, using 2D fallback', error);
        }
        if (!cancelled) setStatus('unsupported');
      });
    };
    attempt();

    return () => {
      cancelled = true;
      controller.abort();
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      disposeTalkingHead(headRef.current);
      headRef.current = null;
    };
    // mood/stage/gesture are deliberately not in this dep list: they're only
    // used for the *initial* load, and separate effects below handle every
    // later prop change without tearing the engine down and rebuilding it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [use3D]);

  // status==='ready' alone doesn't guarantee headRef.current is still set: it's
  // a ref (mutates synchronously, e.g. from onContextLost above) while status
  // is state (updates on React's own schedule), so another effect can observe
  // a "ready" status from a not-yet-processed render after the ref was already
  // cleared. Every effect below re-checks the ref itself rather than trusting
  // status as a proxy for it.
  useEffect(() => {
    if (status !== 'ready' || !headRef.current) return;
    headRef.current.setMood(mapMood(mood));
  }, [mood, status]);

  useEffect(() => {
    if (status !== 'ready' || !headRef.current) return;
    applyGesture(headRef.current, gesture);
  }, [gesture, status]);

  useEffect(() => {
    if (status !== 'ready' || !headRef.current) return;
    const head = headRef.current;
    const container = containerRef.current;
    if (gaze === 'center') { head.lookAtCamera(600); return; }
    const rect = container.getBoundingClientRect();
    const x = gaze === 'left' ? rect.left : rect.right;
    head.lookAt(x, rect.top + rect.height / 2, 600);
  }, [gaze, status]);

  // Same subscribe-only-while-speaking pattern Avatar.jsx uses for the 2D mouth.
  useEffect(() => {
    if (status !== 'ready' || !headRef.current) return undefined;
    const head = headRef.current;
    if (!speaking) { restTalkingHeadMouth(head); return undefined; }
    unsubscribeRef.current = driveTalkingHeadMouth(head);
    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [speaking, status]);

  return (
    <span
      className={`mitra-avatar mitra-avatar-3d ${speaking ? 'is-speaking' : ''}`}
      role="img"
      aria-label={`MITRA, your animated guide${gesture !== 'idle' ? `, ${gesture.replaceAll('-', ' ')}` : ''}`}
      style={{ width: size, height: size }}
    >
      <div ref={containerRef} className="mitra-avatar-3d-canvas" hidden={status !== 'ready'} />
      {status !== 'ready' && (
        // Deliberately chosen 2D mode gets the real `speaking` value, exactly
        // as the standalone 2D avatar always has — full mouth animation and
        // speaking-ring included. A transitional 3D-loading/retry fallback
        // (use3D true, status not yet ready) suppresses it instead: the ring
        // flashing on then abruptly vanishing when the 3D avatar takes over a
        // moment later reads as a glitch, not a feature.
        <Avatar speaking={use3D ? false : speaking} mood={mood} size={size} gesture={gesture} gaze={gaze} character={character} stage={stage} elevation={elevation} />
      )}
    </span>
  );
}
