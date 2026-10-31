import React, { useEffect, useId, useState } from 'react';
import { REST_MOUTH, subscribeSpeechMotion } from '../engine/speechMotion.js';
import { armPose, getCharacter, savedCharacter } from '../engine/characters.js';
import './avatar-motion.css';

function Arm({ side, gesture, elevation, color, skin, skinLight }) {
  const pose = armPose(gesture, elevation);
  return <g transform={side === 'left' ? 'translate(120 0) scale(-1 1)' : undefined}>
    <g transform="translate(82 96)">
      <g className="avatar-upper-arm" style={{ transform: `rotate(${pose.shoulder}deg)` }}>
        <path d="M0 0 L0 17" stroke={color} strokeWidth="14" strokeLinecap="round" />
        <g transform="translate(0 17)">
          <g className="avatar-forearm" style={{ transform: `rotate(${pose.elbow}deg)` }}>
            <path d="M0 0 L0 14" stroke={color} strokeWidth="11" strokeLinecap="round" />
            <path d="M0 11 L0 16" stroke="#f9eee2" strokeWidth="9" />
            <g transform="translate(0 19)">
              <g className={`avatar-hand avatar-hand-${pose.hand}`} style={{ transform: `rotate(${-pose.shoulder - pose.elbow}deg)` }}>
                {pose.hand === 'thumb' ? <>
                  <path d="M-5 5 L-5-5 Q-9-9-6-14 Q-3-16-2-12 L-1-6 L5-6 Q8-5 7-2 L6 6 Q0 8-5 5Z" fill={skinLight} stroke={skin} strokeWidth=".8" />
                  <path d="M1-2 L6-2 M0 1 L6 1 M0 4 L5 4" stroke={skin} strokeWidth=".7" strokeLinecap="round" />
                </> : pose.hand === 'point' ? <g transform="rotate(90)">
                  <path d="M-4 5 L-4-1 L-3-13 Q-1-16 1-13 L1-4 L5-3 Q8-2 7 2 L5 7 Z" fill={skinLight} stroke={skin} strokeWidth=".7" />
                  <path d="M2-1 L6 0 M2 2 L6 3" stroke={skin} strokeWidth=".7" />
                </g> : pose.hand === 'open' ? <g className={gesture === 'wave' ? 'avatar-waving-palm' : ''}>
                  <path d="M-5 7 Q-9 1-10-3 Q-9-6-7-3 L-5 0 L-6-11 Q-5-14-3-11 L-2-4 L-2-14 Q0-17 1-14 L1-4 L3-13 Q5-15 6-12 L4-3 L7-9 Q10-11 10-7 L7 4 Q4 10-5 7Z" fill={skinLight} stroke={skin} strokeWidth=".7" />
                  <path d="M-2 1 Q2-1 4 2" stroke={skin} strokeWidth=".7" fill="none" />
                </g> : <ellipse rx="5" ry="6" fill={skinLight} />}
              </g>
            </g>
          </g>
        </g>
      </g>
    </g>
  </g>;
}

// MITRA — an expressive avatar with gaze and pointing gestures.
// She blinks naturally, lip-syncs while speaking, breathes at rest and uses
// subtle expression changes without relying on a heavyweight video avatar.
export default function Avatar({ speaking = false, mood = 'happy', size = 108, gesture = 'idle', gaze = 'center', character, stage = false, elevation = 0 }) {
  const [blink, setBlink] = useState(false);
  const [mouth, setMouth] = useState(REST_MOUTH);
  const [selected, setSelected] = useState(savedCharacter);
  const person = getCharacter(character || selected);
  const playful = person.style === 'playful';
  const girl = person.gender === 'girl';
  const rawId = useId();
  const svgId = rawId.replace(/:/g, '');

  useEffect(() => {
    let t, next;
    const schedule = () => { next = setTimeout(() => {
      setBlink(true);
      t = setTimeout(() => { setBlink(false); schedule(); }, 135);
    }, 2400 + Math.random() * 3000); };
    schedule();
    return () => { clearTimeout(next); clearTimeout(t); };
  }, []);

  useEffect(() => {
    if (!speaking) { setMouth(REST_MOUTH); return undefined; }
    return subscribeSpeechMotion(setMouth);
  }, [speaking]);
  useEffect(() => {
    const update = (event) => setSelected(event.detail);
    window.addEventListener('mitra-character', update);
    return () => window.removeEventListener('mitra-character', update);
  }, []);

  const browLift = mood === 'excited' ? -2 : mood === 'thinking' ? 1.5 : 0;
  const eyeShift = gaze === 'right' ? 1.9 : gaze === 'left' ? -1.9 : 0;
  const mouthOpen = speaking ? mouth.open : 0;
  const mouthWidth = 6 + mouth.wide * 2 - mouth.round * 2;
  const rightGesture = gesture === 'point-left' ? 'idle' : gesture;
  const leftGesture = gesture === 'point-left' ? 'point-right' : 'idle';

  return (
    <span
      className={`mitra-avatar mitra-avatar-${mood} mitra-gesture-${gesture} ${stage ? 'avatar-stage' : ''} ${playful ? 'avatar-playful' : ''} ${speaking ? 'is-speaking' : ''}`}
      role="img"
      aria-label={`${person.name}, your animated MITRA guide${gesture !== 'idle' ? `, ${gesture.replaceAll('-', ' ')}` : ''}`}
      style={{ width: size, height: size }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox={stage ? '-18 0 156 145' : '0 0 120 120'} width="100%" height="100%" aria-hidden="true" focusable="false">
        <defs>
        <radialGradient id={`${svgId}-bg`} cx="50%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#f2fcf7" />
          <stop offset="100%" stopColor="#c3e5d7" />
        </radialGradient>
        <linearGradient id={`${svgId}-skin`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={person.skinLight} />
          <stop offset="100%" stopColor={person.skin} />
        </linearGradient>
        <linearGradient id={`${svgId}-hair`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={person.hair} />
          <stop offset="100%" stopColor="#201b1a" />
        </linearGradient>
        <linearGradient id={`${svgId}-coat`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={person.color} />
          <stop offset="100%" stopColor={person.color} />
        </linearGradient>
        <filter id={`${svgId}-soft-shadow`} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.2" floodColor="#2b1810" floodOpacity="0.18" />
        </filter>
        </defs>

        {/* backdrop + speaking ring */}
        <circle cx="60" cy="60" r="57" fill={`url(#${svgId}-bg)`} />
        <circle
          cx="60" cy="60" r="57" fill="none"
          stroke={speaking ? '#ff8a3c' : 'rgba(255,255,255,0.22)'}
          strokeWidth={speaking ? 2.5 : 1.2}
          strokeDasharray={speaking ? '10 7' : '0'}
        >
          {speaking && !stage && (
            <animateTransform attributeName="transform" type="rotate" from="0 60 60" to="360 60 60" dur="7s" repeatCount="indefinite" />
          )}
        </circle>

        <g className="mitra-character" filter={`url(#${svgId}-soft-shadow)`}>
        {/* Character variations retain the original MITRA vector face. */}
        {girl && <>
          <ellipse cx={playful ? 82 : 60} cy={playful ? 45 : 17} rx={playful ? 14 : 12} ry={playful ? 28 : 9} fill={`url(#${svgId}-hair)`} />
          {playful && <circle cx="84" cy="30" r="4" fill="#f2be4b" />}
        </>}

        {/* hair behind face (falls to shoulders) */}
        {girl && <path d="M32 52 Q30 22 60 20 Q90 22 88 52 L88 76 Q88 84 82 86 L80 60 L40 60 L38 86 Q32 84 32 76 Z" fill={`url(#${svgId}-hair)`} />}

        {/* shoulders / teal blazer */}
        <path className="mitra-torso" d="M23 120 Q22 99 42 90 L60 86 L78 90 Q98 99 97 120 Q61 128 23 120Z" fill={`url(#${svgId}-coat)`} />
        {!playful ? <>
        {/* blouse v-neck */}
        <path d="M50 91 L60 104 L70 91 L60 87 Z" fill="#f0eee6" />
        {/* lapels */}
        <path d="M50 91 L60 104 L52 110 L44 92 Z" fill="#000000" opacity="0.55" />
        <path d="M70 91 L60 104 L68 110 L76 92 Z" fill="#000000" opacity="0.55" />
        {/* pocket square */}
        <rect x="82" y="106" width="8" height="7" rx="1.5" fill="#ff8a3c" transform="rotate(-6 86 109)" />
        </> : <>
          <path d="M45 90 Q60 110 75 90" fill="none" stroke="#fff6e8" strokeWidth="4" />
          <path d="M49 96 L49 109 M70 96 L70 109" stroke="#fff6e8" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M52 115 Q60 112 68 115" stroke="#ffffff55" strokeWidth="2" fill="none" />
          <circle cx="60" cy="109" r="4" fill="#f4c85c" />
        </>}

        <Arm side="left" gesture={leftGesture} elevation={elevation} color={person.color} skin={person.skin} skinLight={person.skinLight} />
        <Arm side="right" gesture={rightGesture} elevation={elevation} color={person.color} skin={person.skin} skinLight={person.skinLight} />
        <g className="avatar-head" style={{ transformOrigin: '60px 83px', transform: `rotate(${gesture === 'listen' ? -7 : gaze === 'left' ? -3 : gaze === 'right' ? 3 : 0}deg)` }}>
        {/* neck */}
        <path d="M53 76 L53 90 Q60 95 67 90 L67 76 Z" fill={person.skin} />

        {/* ears + studs */}
        <ellipse cx="34.5" cy="58" rx="4" ry="5.5" fill={person.skin} />
        <ellipse cx="85.5" cy="58" rx="4" ry="5.5" fill={person.skin} />
        {girl && <><circle cx="34.5" cy="61.5" r="1.8" fill="#d9a441" /><circle cx="85.5" cy="61.5" r="1.8" fill="#d9a441" /></>}

        {/* face */}
        <path d="M36 50 Q36 26 60 26 Q84 26 84 50 Q84 66 76 74 Q68 81 60 81 Q52 81 44 74 Q36 66 36 50 Z" fill={`url(#${svgId}-skin)`} />
        <ellipse cx="51" cy="47" rx="9" ry="15" fill="#fff" opacity="0.08" transform="rotate(12 51 47)" />

        {/* front hair — side-swept with middle part */}
        <path d={girl ? "M36 52 Q34 24 60 23 Q86 24 84 52 Q84 40 76 34 Q70 41 60 40 Q50 41 44 34 Q36 40 36 52 Z" : "M34 54 L31 35 Q27 23 39 26 Q35 15 49 22 Q58 10 66 22 Q86 14 88 35 L85 55 L79 37 Q63 44 49 34 Q39 38 34 54Z"} fill={`url(#${svgId}-hair)`} />
        <path d="M46 30 Q54 25 60 26" stroke="#6b5343" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.6" />

        {/* bindi */}
        {girl && !playful && <circle cx="60" cy="43.5" r="1.3" fill="#b8443c" />}

        {/* brows — soft, rounded */}
        <path d={`M44 ${48.5 + browLift} Q48.5 ${46 + browLift} 53 ${48.2 + browLift}`} stroke="#5a4335" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <path d={`M67 ${48.2 + browLift} Q71.5 ${46 + browLift} 76 ${48.5 + browLift}`} stroke="#5a4335" strokeWidth="2.2" fill="none" strokeLinecap="round" />

        {/* eyes */}
        <g transform={playful ? "translate(60 56) scale(1.12 1.2) translate(-60 -56)" : undefined}>
        {blink ? (
          <>
            <path d="M44 56 Q48.5 58.4 53 56" stroke="#5a4335" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M67 56 Q71.5 58.4 76 56" stroke="#5a4335" strokeWidth="2" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <>
            {/* whites */}
            <path d="M43.5 56 Q48.5 51 53.5 56 Q48.5 60 43.5 56 Z" fill="#fff" />
            <path d="M66.5 56 Q71.5 51 76.5 56 Q71.5 60 66.5 56 Z" fill="#fff" />
            {/* warm brown iris + pupil + sparkle */}
            <circle cx={48.7 + eyeShift} cy="55.8" r="2.7" fill="#6d4c33" />
            <circle cx={71.7 + eyeShift} cy="55.8" r="2.7" fill="#6d4c33" />
            <circle cx={48.7 + eyeShift} cy="55.8" r="1.25" fill="#2a1a10" />
            <circle cx={71.7 + eyeShift} cy="55.8" r="1.25" fill="#2a1a10" />
            <circle cx={49.6 + eyeShift} cy="54.8" r="0.85" fill="#fff" />
            <circle cx={72.6 + eyeShift} cy="54.8" r="0.85" fill="#fff" />
            {/* soft upper lash line */}
            <path d="M44 54.6 Q48.5 50.6 53 54.6" stroke="#3f2e22" strokeWidth="1.7" fill="none" strokeLinecap="round" />
            <path d="M67 54.6 Q71.5 50.6 76 54.6" stroke="#3f2e22" strokeWidth="1.7" fill="none" strokeLinecap="round" />
          </>
        )}

        </g>
        {/* nose — barely there */}
        <path d="M59.2 62 Q58.4 65.5 60.8 66.3" stroke="#dfa578" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M57.8 67 Q60 68 62.2 67" stroke="#cc916d" strokeWidth="0.65" fill="none" strokeLinecap="round" opacity="0.55" />

        {/* blush */}
        <ellipse cx="43" cy="66" rx="4.6" ry="2.6" fill="#f2a58d" opacity="0.35" />
        <ellipse cx="77" cy="66" rx="4.6" ry="2.6" fill="#f2a58d" opacity="0.35" />

        {/* Continuous mouth opening is driven by speech playback. */}
        <g data-mouth-open={mouthOpen.toFixed(2)}>
          {mouthOpen > .055 ? <>
            <ellipse cx="60" cy="74" rx={mouthWidth} ry={1 + mouthOpen * 5.5} fill="#663429" />
            <path d={`M${60-mouthWidth+1} 72.5 Q60 74 ${60+mouthWidth-1} 72.5`} stroke="#fff4e5" strokeWidth="1.7" fill="none" strokeLinecap="round" />
            {mouthOpen > .45 && <ellipse cx="60" cy={75 + mouthOpen * 2} rx="3.2" ry="1.4" fill="#d67a72" />}
          </> : <>
            <path d={mood === 'thinking' ? 'M54 75 Q60 76 66 74' : 'M52 73 Q60 81 68 73'} stroke="#8e483d" strokeWidth="2" fill="none" strokeLinecap="round" />
            {mood === 'excited' && <path d="M54 75 Q60 79 66 75" stroke="#fff4e5" strokeWidth="2.2" fill="none" />}
          </>}
        </g>
        </g>
        </g>
      </svg>
    </span>
  );
}
