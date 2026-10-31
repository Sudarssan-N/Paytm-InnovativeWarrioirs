// Is the onboarding call ready? Checks the settings and the key against Sarvam.
// It places no call and spends nothing: npm run check:call
import { agentSettings } from '../server/agentCall.mjs';

const settings = agentSettings();
if (!settings.configured) {
  console.log(`FAIL  Missing from .env: ${settings.missing.join(', ')}`);
  process.exit(1);
}
const now = Date.now();
const query = new URLSearchParams({ start_datetime: new Date(now - 3600_000).toISOString(), end_datetime: new Date(now).toISOString(), limit: '1' });
const res = await fetch(`${settings.base}/analytics/v1/${settings.org}/${settings.workspace}/${settings.appId}/attempts?${query}`, { headers: { 'x-api-key': settings.key }, signal: AbortSignal.timeout(15000) });
if (!res.ok) {
  const meaning = { 401: 'Sarvam does not accept this key for this organisation', 403: 'this key may not use this workspace', 404: 'the organisation, workspace or agent id is wrong', 422: 'the organisation, workspace or agent id is wrong' }[res.status] || 'see the Sarvam dashboard';
  console.log(`FAIL  Sarvam answered ${res.status}: ${meaning}`);
  process.exit(1);
}
console.log(`PASS  Key, organisation, workspace and agent all work. Calls go out from ${settings.agentNumber} on agent version ${settings.appVersion}.`);
console.log(settings.publicHost ? `PASS  Results also arrive by webhook at ${settings.publicHost}` : 'WARN  PUBLIC_HOST is not set, so results arrive by polling, about a minute after each call. That is fine.');
