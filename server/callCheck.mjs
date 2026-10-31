// Saaras batch with speaker separation: who said what on a recorded sales call.
import { PROMISE_KINDS, PROMISE_LABEL } from '../src/journeys/engines/promises.js';
import { modelToolCall, sarvamKey } from './aiProxy.mjs';
import { bump, countCall, watch } from './ops.mjs';
import { questionToEnglish } from './sarvamServer.mjs';

const BASE = 'https://api.sarvam.ai/speech-to-text/job/v1';
const BUDGET_MS = 60_000;
const ALLOWED = { 'audio/mpeg': 'call.mp3', 'audio/mp3': 'call.mp3', 'audio/wav': 'call.wav', 'audio/x-wav': 'call.wav', 'audio/mp4': 'call.m4a', 'audio/x-m4a': 'call.m4a', 'audio/aac': 'call.aac', 'audio/ogg': 'call.ogg', 'audio/webm': 'call.webm' };
export const MAX_CALL_BYTES = 12_000_000;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const headers = () => ({ 'content-type': 'application/json', 'api-subscription-key': sarvamKey() });

async function jsonOrThrow(res, step) {
  if (!res.ok) throw Object.assign(new Error(`Sarvam ${step} returned ${res.status}`), { status: res.status === 429 ? 429 : 502 });
  return res.json();
}

export async function transcribeCall(buffer, { mime = 'audio/mpeg' } = {}) {
  const base = String(mime).split(';')[0].trim().toLowerCase();
  const name = ALLOWED[base];
  if (!name) throw Object.assign(new Error('Send the call as an MP3, WAV, M4A, AAC, OGG or WebM file'), { status: 415 });
  if (buffer.length > MAX_CALL_BYTES) throw Object.assign(new Error('That recording is larger than 12 MB'), { status: 413 });
  const started = Date.now();
  const job = await jsonOrThrow(await watch('saaras-batch', () => fetch(BASE, {
    method: 'POST', headers: headers(), signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ job_parameters: { model: 'saaras:v3', language_code: 'unknown', with_diarization: true, num_speakers: 2, with_timestamps: true } }),
  })), 'batch job');
  const upload = await jsonOrThrow(await fetch(`${BASE}/upload-files`, { method: 'POST', headers: headers(), body: JSON.stringify({ job_id: job.job_id, files: [name] }), signal: AbortSignal.timeout(15000) }), 'batch upload');
  const target = upload.upload_urls?.[name]?.file_url;
  if (!target) throw Object.assign(new Error('Sarvam gave no upload address'), { status: 502 });
  const stored = await fetch(target, { method: 'PUT', headers: { 'content-type': base, 'x-ms-blob-type': 'BlockBlob' }, body: buffer, signal: AbortSignal.timeout(30000) });
  if (!stored.ok) throw Object.assign(new Error(`The upload was refused (${stored.status})`), { status: 502 });
  await jsonOrThrow(await fetch(`${BASE}/${job.job_id}/start`, { method: 'POST', headers: headers(), signal: AbortSignal.timeout(15000) }), 'batch start');
  let state = null;
  while (Date.now() - started < BUDGET_MS) {
    await pause(900);
    const res = await fetch(`${BASE}/${job.job_id}/status`, { headers: headers(), signal: AbortSignal.timeout(8000) });
    if (!res.ok) continue;
    state = await res.json();
    if (['Completed', 'Failed'].includes(state.job_state)) break;
  }
  if (state?.job_state !== 'Completed') throw Object.assign(new Error(state?.error_message || 'Listening to the call took too long'), { status: 504 });
  const files = (state.job_details || []).flatMap((detail) => detail.outputs || []).map((output) => output.file_name);
  const links = await jsonOrThrow(await fetch(`${BASE}/download-files`, { method: 'POST', headers: headers(), body: JSON.stringify({ job_id: job.job_id, files }), signal: AbortSignal.timeout(15000) }), 'batch download');
  const link = Object.values(links.download_urls || {})[0]?.file_url;
  const body = await jsonOrThrow(await fetch(link, { signal: AbortSignal.timeout(15000) }), 'batch result');
  const entries = body.diarized_transcript?.entries || [];
  countCall('/speech-to-text/batch', { ms: Date.now() - started, ok: true, audioSeconds: entries.at(-1)?.end_time_seconds || 0 });
  bump('callsChecked');
  return {
    ms: Date.now() - started, language: body.language_code || null,
    turns: entries.map((entry, index) => ({ index, speaker: String(entry.speaker_id), text: String(entry.transcript || '').trim(), start: entry.start_time_seconds ?? null })).filter((turn) => turn.text),
  };
}

const REPORT_TOOL = [{
  type: 'function',
  function: {
    name: 'report_promises', description: 'Report who the sales agent is and each promise they made.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['agent_speaker', 'promises'],
      properties: {
        agent_speaker: { type: 'string', description: 'The speaker id of the agent selling the product' },
        promises: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['kind', 'quote'],
            properties: {
              kind: { type: 'string', enum: [...PROMISE_KINDS], description: Object.entries(PROMISE_LABEL).map(([id, label]) => `${id}: ${label}`).join('; ') },
              quote: { type: 'string', description: 'The agent\'s exact words, copied from the transcript, in the original language' },
            },
          },
        },
      },
    },
  },
}];

export async function findPromises(turns, signal) {
  const transcript = turns.map((turn) => `[speaker ${turn.speaker}] ${turn.text}`).join('\n');
  const call = await modelToolCall({
    signal,
    tools: REPORT_TOOL,
    messages: [
      { role: 'system', content: 'You read a recorded call between an Indian financial product agent and a customer. Find what the agent promised. Copy each promise word for word from the transcript. Never add, translate or change words. Report each kind at most once. Do not judge whether it is true.' },
      { role: 'user', content: transcript.slice(0, 12000) },
    ],
  });
  return { agent: String(call.arguments?.agent_speaker ?? ''), promises: (call.arguments?.promises || []).filter((item) => item && item.quote && item.kind) };
}

export const englishFor = async (text) => { try { return (await questionToEnglish(text)).text; } catch { return null; } };
