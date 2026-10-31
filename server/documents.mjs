// Sarvam Vision reads a document the customer shares. The file is not kept: only its
// fingerprint and the figures the customer confirms go on the receipt.
import { createHash } from 'node:crypto';
import { LOAN_DOCUMENT_SCHEMA } from '../src/journeys/documentRead.js';
import { sarvamKey } from './aiProxy.mjs';
import { bump, countCall, watch } from './ops.mjs';

const BASE = 'https://api.sarvam.ai/doc-ai/v1/job';
const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const READ_BUDGET_MS = 45_000;
export const MAX_DOCUMENT_BYTES = 10_000_000;

const headers = () => ({ 'api-subscription-key': sarvamKey() });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const fingerprint = (buffer) => createHash('sha256').update(buffer).digest('hex');

export async function readLoanDocument(buffer, { name = 'document.pdf', mime = 'application/pdf' } = {}) {
  if (!ALLOWED.has(mime)) throw Object.assign(new Error('Send a PDF, JPG or PNG'), { status: 415 });
  if (buffer.length > MAX_DOCUMENT_BYTES) throw Object.assign(new Error('That file is larger than 10 MB'), { status: 413 });
  const started = Date.now();
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), name.replace(/[^\w.-]/g, '_').slice(-60) || 'document.pdf');
  form.append('schema', JSON.stringify(LOAN_DOCUMENT_SCHEMA));
  form.append('output_format', 'json');
  const submitted = await watch('vision', () => fetch(`${BASE}/extract`, { method: 'POST', headers: headers(), body: form, signal: AbortSignal.timeout(20_000) }));
  if (!submitted.ok) {
    const detail = await submitted.json().catch(() => ({}));
    throw Object.assign(new Error(detail.message || `Sarvam Vision returned ${submitted.status}`), { status: submitted.status === 429 ? 429 : 502 });
  }
  const { job_id: id } = await submitted.json();
  let status = null;
  while (Date.now() - started < READ_BUDGET_MS) {
    await pause(700);
    const res = await fetch(`${BASE}/${id}/status`, { headers: headers(), signal: AbortSignal.timeout(8000) });
    if (!res.ok) continue;
    status = await res.json();
    if (['completed', 'partially_completed', 'failed', 'rejected'].includes(status.status)) break;
  }
  if (!['completed', 'partially_completed'].includes(status?.status)) {
    throw Object.assign(new Error(status?.status ? `The document could not be read (${status.status})` : 'Reading the document took too long'), { status: 504 });
  }
  const results = await fetch(`${BASE}/${id}/results`, { headers: headers(), signal: AbortSignal.timeout(10_000) });
  if (!results.ok) throw Object.assign(new Error(`Sarvam Vision results returned ${results.status}`), { status: 502 });
  const out = await results.json();
  countCall('/doc-ai/extract', { ms: Date.now() - started, ok: true });
  bump('documentsRead');
  return { result: out.result, annotations: out.annotations, pages: out.usage?.pages_total ?? null, ms: Date.now() - started, partial: status.status === 'partially_completed' };
}
