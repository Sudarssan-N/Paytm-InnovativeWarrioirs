// The call loop: MITRA speaks, listens, hears the turn end, and answers. All the
// reasoning is on the server; this hook only moves audio and text and keeps the
// screen in step. Voice failures never end the journey: typing and tapping still work.
import { useCallback, useEffect, useRef, useState } from 'react';
import { recordUtterance, canRecord } from '../../engine/recorder.js';
import { sarvamStreamUrl, transcribe, verifySpoken } from '../../engine/sarvam.js';
import { isAssistantEcho, speak, stopSpeaking } from '../../engine/speech.js';
import { scriptLanguage } from '../../engine/languageDetect.js';

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/journey${path}`, {
    method, headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.title || `Request failed (${res.status})`);
  return data;
}

export const postJourney = (path, body = {}) => api(path, { method: 'POST', body });
export const getJourney = (path) => api(path);

// How long a caller can be left in silence before MITRA uses the device voice
// instead of waiting for the neural one. A slow reply still lands in the cache.
const VOICE_BUDGET_MS = 6000;
export const postRomanise = (text, lang) => postJourney('/romanise', { text, lang });

const SPOKEN = new Set(['en', 'hi', 'ta', 'te', 'bn', 'mr', 'gu', 'kn', 'ml', 'od', 'pa']);

const voiceFor = (text, lang) => {
  const script = scriptLanguage(text);
  if (script === 'latin') return 'en';
  if (script === 'deva') return ['hi', 'mr'].includes(lang) ? lang : 'hi';
  return script;
};

export function useJourney({ modelOff, chaos, consumeChaos, handsFree, setVoiceNote }) {
  const [status, setStatus] = useState('idle');
  const [state, setState] = useState(null);
  const [messages, setMessages] = useState([]);
  const [cards, setCards] = useState([]);
  const [chips, setChips] = useState([]);
  const [trace, setTrace] = useState([]);
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [voiceOn, setVoiceOn] = useState(true);
  const [error, setError] = useState('');

  const recorder = useRef(null);
  const sessionId = useRef(null);
  const lastSpoken = useRef('');
  const live = useRef(false);
  const statusRef = useRef('idle');
  const voiceOnRef = useRef(true);
  const handsFreeRef = useRef(handsFree);
  const modelOffRef = useRef(modelOff);
  const chaosRef = useRef(chaos);
  const traceTimers = useRef([]);
  const seenNotifications = useRef(new Set());
  const listenRef = useRef(() => {});
  const voiceTimer = useRef(null);
  const watchTimer = useRef(null);

  useEffect(() => { handsFreeRef.current = handsFree; }, [handsFree]);
  useEffect(() => { modelOffRef.current = modelOff; }, [modelOff]);
  useEffect(() => { chaosRef.current = chaos; }, [chaos]);
  useEffect(() => { voiceOnRef.current = voiceOn; }, [voiceOn]);

  const setPhase = (next) => { statusRef.current = next; setStatus(next); };

  const addMessage = (message) => setMessages((items) => [...items, { id: `${Date.now()}-${items.length}`, ...message }]);

  // The trace is revealed step by step, so the audience can follow the pipeline.
  const revealTrace = (events) => {
    traceTimers.current.forEach(clearTimeout);
    traceTimers.current = [];
    setTrace([]);
    events.forEach((event, index) => {
      traceTimers.current.push(setTimeout(() => setTrace((items) => [...items, event]), 90 * index));
    });
  };

  const afterSpeech = useCallback(() => {
    if (!live.current) return;
    if (handsFreeRef.current && canRecord() && !modelOffRef.current) listenRef.current();
    else setPhase('your-turn');
  }, []);

  const say = useCallback((reply) => {
    lastSpoken.current = reply.native;
    clearTimeout(voiceTimer.current);
    if (!voiceOnRef.current) { afterSpeech(); return; }
    if (!SPOKEN.has(reply.lang)) { setVoiceNote('MITRA understands this language and answers on screen. Spoken answers in it are coming.'); afterSpeech(); return; }
    setPhase('preparing');
    const lang = voiceFor(reply.native, reply.lang);
    // The banner is about now, not about the whole call: neural speech clears it.
    const started = (engine) => { clearTimeout(voiceTimer.current); if (engine === 'sarvam') setVoiceNote(''); setPhase('speaking'); };
    const onFallback = () => setVoiceNote('The neural voice is slow right now, so MITRA is using this device’s voice.');
    speak(reply.native, { lang, onStart: started, onEnd: afterSpeech, onFallback });
    // Two models check each other: Saaras listens to what Bulbul just said.
    if (/\d/.test(reply.native) && sarvamStreamUrl(reply.native, { lang })) {
      verifySpoken(reply.native, { lang }).then((out) => {
        if (!out.checked || lastSpoken.current !== reply.native) return;
        setTrace((items) => [...items, {
          kind: 'voice', ok: out.ok,
          label: out.ok ? `Saaras listened back: all ${out.figures.length} figures heard as written` : 'Voice check could not confirm a figure. The screen has it right',
          detail: out.ok ? out.figures.join(', ') : `Not confirmed: ${out.missing.join(', ') || 'a figure read as a date'}. Heard: “${out.heard}”`,
        }]);
      }).catch(() => {});
    }
    voiceTimer.current = setTimeout(() => {
      if (statusRef.current !== 'preparing') return;
      onFallback();
      speak(reply.native, { lang, engine: 'device', onStart: started, onEnd: afterSpeech });
    }, VOICE_BUDGET_MS);
  }, [afterSpeech, setVoiceNote]);

  const apply = useCallback((turn) => {
    setState(turn.state);
    setChips(turn.chips || []);
    if (turn.card) setCards((items) => [...items, { ...turn.card, agent: turn.agent, tool: turn.tool, key: `${items.length}` }]);
    revealTrace(turn.trace || []);
    addMessage({ from: 'mitra', native: turn.reply.native, english: turn.reply.english, lang: turn.reply.lang, rejected: turn.reply.rejected });
    say(turn.reply);
  }, [say]);

  // The customer's own paper. Read by Sarvam Vision, then read back for them to confirm.
  const readDocument = useCallback(async (file) => {
    if (!sessionId.current) return;
    stopSpeaking();
    setPhase('thinking');
    setError('');
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not open that file'));
        reader.readAsDataURL(file);
      });
      const turn = await postJourney(`/${sessionId.current}/document`, { name: file.name, mime: file.type, data });
      addMessage({ from: 'customer', native: `📄 ${file.name}`, lang: null });
      apply(turn);
    } catch (problem) {
      setError(problem.message);
      setPhase('your-turn');
    }
  }, [apply]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkCall = useCallback(async (file) => {
    if (!sessionId.current) return;
    stopSpeaking();
    setPhase('thinking');
    setError('');
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not open that file'));
        reader.readAsDataURL(file);
      });
      const turn = await postJourney(`/${sessionId.current}/promise-check`, { name: file.name, mime: file.type, data });
      addMessage({ from: 'customer', native: `🎙 ${file.name}`, lang: null });
      apply(turn);
    } catch (problem) {
      setError(problem.message);
      setPhase('your-turn');
    }
  }, [apply]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmDocument = useCallback(async (accept) => {
    if (!sessionId.current) return;
    stopSpeaking();
    setPhase('thinking');
    try {
      apply(await postJourney(`/${sessionId.current}/document/confirm`, { accept }));
    } catch (problem) {
      setError(problem.message);
      setPhase('your-turn');
    }
  }, [apply]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(async (text, { tapped = false, spoken = null } = {}) => {
    const words = String(text || '').trim();
    if (!words || !sessionId.current) return;
    recorder.current?.abort?.();
    clearTimeout(voiceTimer.current);
    stopSpeaking();
    setError('');
    setPhase('thinking');
    const pendingId = `${Date.now()}-c`;
    setMessages((items) => [...items, { id: pendingId, from: 'customer', native: words }]);
    const fault = chaosRef.current;
    try {
      const turn = await postJourney(`/${sessionId.current}/turn`, { text: words, tapped, spoken, modelOff: modelOffRef.current, chaos: fault ? 'mistranslate' : undefined });
      if (fault) consumeChaos?.();
      if (!live.current) return;
      setMessages((items) => items.map((item) => (item.id === pendingId ? { ...item, english: turn.customer.english, lang: turn.customer.lang, confidence: turn.customer.confidence, method: turn.customer.method } : item)));
      apply(turn);
    } catch (problem) {
      setError(problem.message);
      setPhase('your-turn');
    }
  }, [apply, consumeChaos]);

  const listen = useCallback(() => {
    if (!live.current || statusRef.current === 'listening') return;
    clearTimeout(voiceTimer.current);
    if (!canRecord()) { setPhase('your-turn'); setVoiceNote('This browser cannot record. Type or tap instead.'); return; }
    stopSpeaking();
    setPhase('listening');
    const session = recordUtterance({ onLevel: setLevel });
    recorder.current = session;
    session.result
      .then(async (blob) => {
        setLevel(0);
        if (!live.current) return;
        setPhase('transcribing');
        const heard = await transcribe(blob);
        if (!live.current) return;
        if (!heard.transcript || isAssistantEcho(heard.transcript, lastSpoken.current)) { listen(); return; }
        const spoken = heard.detected && heard.confidence >= 0.6 ? { lang: heard.detected, confidence: heard.confidence, raw: heard.detectedRaw } : null;
        await send(heard.transcript, { spoken });
      })
      .catch((problem) => {
        setLevel(0);
        if (!live.current || problem?.message === 'aborted') return;
        if (problem?.message !== 'no-speech') setVoiceNote(`Microphone: ${problem?.message || 'could not record'}. Type or tap instead.`);
        setPhase('your-turn');
      });
  }, [send, setVoiceNote]);

  useEffect(() => { listenRef.current = listen; }, [listen]);

  const start = useCallback(async ({ customerId = 'ramesh', channel = 'call' } = {}) => {
    setError('');
    setPhase('opening');
    setMessages([]); setCards([]); setTrace([]); setChips([]); setSecs(0);
    seenNotifications.current = new Set();
    live.current = true;
    try {
      const opening = await postJourney('/session', { customerId, channel });
      sessionId.current = opening.state.sessionId;
      apply(opening);
    } catch (problem) {
      live.current = false;
      setError(`Could not reach the MITRA server. ${problem.message}`);
      setPhase('idle');
    }
  }, [apply]);

  // Watch a call happening on a real phone: the same screen, driven by the server.
  const watchPhone = useCallback(() => {
    setError('');
    setMessages([]); setCards([]); setTrace([]); setChips([]); setSecs(0);
    live.current = true;
    setPhase('watching');
    const startedAt = Date.now();
    let lastKey = null, active = null;
    clearInterval(watchTimer.current);
    watchTimer.current = setInterval(async () => {
      try {
        const phone = await getJourney('/phone-status');
        if (phone.latestSession && (phone.latestSession !== active) && Date.parse(phone.latestStartedAt) >= startedAt - 5000) active = phone.latestSession;
        if (!active) return;
        const next = await getJourney(`/${active}/state`);
        setState(next);
        setMessages(next.messages.map((item, index) => ({ ...item, id: `w${index}` })));
        setTrace(next.lastTrace);
        if (next.lastCard && next.lastCard.key !== lastKey) { lastKey = next.lastCard.key; setCards((items) => [...items, next.lastCard]); }
      } catch { /* the next poll will catch up */ }
    }, 1500);
  }, []);

  const end = useCallback(() => {
    clearInterval(watchTimer.current);
    live.current = false;
    recorder.current?.abort?.();
    clearTimeout(voiceTimer.current);
    stopSpeaking();
    traceTimers.current.forEach(clearTimeout);
    setLevel(0);
    setPhase('ended');
  }, []);

  const toggleVoice = useCallback(() => {
    setVoiceOn((value) => {
      if (value) stopSpeaking();
      return !value;
    });
    if (['speaking', 'preparing'].includes(statusRef.current)) { clearTimeout(voiceTimer.current); afterSpeech(); }
  }, [afterSpeech]);

  const micPress = useCallback(() => {
    if (statusRef.current === 'listening') { recorder.current?.stop?.(); return; }
    listen();
  }, [listen]);

  useEffect(() => {
    if (!['preparing', 'speaking', 'listening', 'transcribing', 'thinking', 'your-turn', 'watching'].includes(status)) return undefined;
    const timer = setInterval(() => setSecs((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [status]);

  // A case resolved at the expert's desk comes back into the customer's call.
  useEffect(() => {
    if (!state?.sessionId) return undefined;
    const timer = setInterval(async () => {
      if (!live.current) return;
      try {
        const next = await getJourney(`/${state.sessionId}/state`);
        setState(next);
        const fresh = (next.notifications || []).filter((item) => !seenNotifications.current.has(item.id));
        if (!fresh.length) return;
        fresh.forEach((item) => seenNotifications.current.add(item.id));
        fresh.forEach((item) => addMessage({ from: 'mitra', native: item.native, english: item.english, lang: item.lang, followUp: true }));
        if (['your-turn', 'ended'].includes(statusRef.current)) say(fresh.at(-1));
        postJourney(`/${state.sessionId}/notifications/seen`).catch(() => {});
      } catch { /* the next poll will catch up */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [state?.sessionId, say]);

  useEffect(() => () => { live.current = false; clearInterval(watchTimer.current); recorder.current?.abort?.(); stopSpeaking(); traceTimers.current.forEach(clearTimeout); }, []);

  return { readDocument, confirmDocument, checkCall, status, state, setState, messages, cards, chips, trace, secs, level, voiceOn, error, start, end, send, micPress, toggleVoice, watchPhone };
}
