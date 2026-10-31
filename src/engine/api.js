import { setAiStatus } from './aiTransport.js';

// Provider availability is public, so it needs no session.
export async function loadAiStatus() {
  try {
    const response = await fetch('/api/ai/status', { signal: AbortSignal.timeout(5000) });
    if (response.ok) setAiStatus(await response.json());
  } catch { setAiStatus(null); }
}
