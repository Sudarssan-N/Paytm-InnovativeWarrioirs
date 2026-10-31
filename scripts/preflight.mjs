// The morning check: every stage on the real services, in about a minute.
// Run before leaving, and again at the venue: npm run preflight
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const key = process.env.SARVAM_API_KEY || process.env.VITE_SARVAM_API_KEY;
const llm = process.env.DEEPSEEK_API_KEY || process.env.VITE_DEEPSEEK_API_KEY;
const API = process.argv[2] || 'http://127.0.0.1:8787';
let failed = 0;
const line = (ok, name, detail = '') => { if (ok === false) failed += 1; console.log(`${ok === null ? 'WARN' : ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const timed = async (fn) => { const started = Date.now(); const value = await fn(); return [value, Date.now() - started]; };
const post = async (url, body) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.title || `status ${res.status}`);
  return data;
};

line(Boolean(key), 'Sarvam key is set');
line(llm ? true : null, 'Router model key is set', llm ? '' : 'rules still work without it');

try {
  const [health] = await timed(async () => (await fetch(`${API}/api/health`)).json());
  line(health.status === 'ok', 'MITRA server is running', API);
} catch { line(false, 'MITRA server is running', `start it first: npm start, then open ${API}`); process.exit(1); }

try {
  const opened = await post(`${API}/api/journey/session`, {});
  const id = opened.state.sessionId;
  const [turn, ms] = await timed(() => post(`${API}/api/journey/${id}/turn`, { text: 'இந்த லோனுக்கு உண்மையான செலவு எவ்வளவு?' }));
  line(turn.reply.lang === 'ta' && turn.tool === 'explain_loan_offer', 'Tamil question reaches the lending engine', `${ms} ms`);
  line(turn.reply.native.includes('17.7') && !turn.reply.rejected, 'Reply is in Tamil and every figure survived', turn.reply.native.slice(0, 50));

  const [reply2] = await timed(() => post(`${API}/api/journey/${id}/turn`, { text: 'முன்கூட்டியே கடனை அடைத்தால் அபராதம் உண்டா?' }));
  line(reply2.tool === 'foreclosure_question', 'Foreclosure: refuses to guess', reply2.customer.english);

  const fault = await post(`${API}/api/journey/${id}/turn`, { text: 'What does this loan really cost?', tapped: true, chaos: 'mistranslate' });
  line(fault.reply.rejected > 0, 'Fence rejects a corrupted translation', `${fault.reply.rejected} sentences`);

  const [routed, routeMs] = await timed(() => post(`${API}/api/journey/${id}/turn`, { text: 'Is this deal as cheap as it looks to you?' }));
  const usedModel = routed.trace.some((event) => event.model);
  line(usedModel ? true : null, 'Router model picks a tool', usedModel ? `${routed.tool}, ${routeMs} ms` : 'model did not answer, so rules and menus are in use');

  const { chain } = routed.state;
  const clean = await post(`${API}/api/journey/verify`, { chain });
  line(clean.valid && clean.signatureChecked, 'Passport chain verifies and is signed', `${clean.checked} receipts`);
  const altered = structuredClone(chain);
  altered[1].result = 'edited';
  const broken = await post(`${API}/api/journey/verify`, { chain: altered });
  line(!broken.valid && broken.reason === 'hash', 'Changing one field is caught', broken.brokenAt);
} catch (error) { line(false, 'Journey API', error.message); }

if (key) {
  try {
    const [speech, ms] = await timed(() => post(`${API}/api/ai/sarvam/text-to-speech`, { inputs: [`Please explain this loan offer, check number ${Date.now() % 1000}.`], target_language_code: 'en-IN', speaker: 'neha', model: 'bulbul:v3', pace: 1, enable_preprocessing: true }));
    line(Boolean(speech.audios?.length) ? (ms < 5000 ? true : null) : false, 'Bulbul speech, uncached', `${ms} ms${ms >= 5000 ? ': slow, the cache and device voice will carry the demo' : ''}`);
    const wav = Buffer.from(speech.audios[0], 'base64');
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
    form.append('model', 'saaras:v4');
    form.append('language_code', 'unknown');
    const [heard, heardMs] = await timed(async () => (await fetch(`${API}/api/ai/sarvam/speech-to-text`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) })).json());
    line(/\bloan\b/i.test(heard.transcript || ''), 'Saaras speech to text', `${heardMs} ms, ${heard.language_code}: “${String(heard.transcript || '').slice(0, 60)}”`);
  } catch (error) { line(false, 'Voice', error.message); }
}

if (key) {
  try {
    const { state } = await post(`${API}/api/journey/session`, { customerId: 'ramesh' });
    const id = state.sessionId;
    const line = (ok, name, detail) => { console.log(`${ok === true ? 'PASS' : ok === null ? 'WARN' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`); if (ok === false) failed += 1; };
    const query = new URLSearchParams({ text: `Your EMI is ₹${9000 + (Date.now() % 900)} a month, and the APR is 17.7%.`, lang: 'hi', speaker: 'neha', pace: '1' });
    let started = Date.now();
    const said = await fetch(`${API}/api/voice/say?${query}`);
    const reader = said.body.getReader();
    await reader.read();
    const firstAudio = Date.now() - started;
    while (!(await reader.read()).done);
    line(said.ok, 'Streaming voice, uncached', `first audio in ${firstAudio} ms`);
    const check = await (await fetch(`${API}/api/voice/verify?${query}`)).json();
    line(check.checked && check.ok, 'Saaras hears the figures back', (check.figures || []).join(', '));
    const kfs = readFileSync('public/samples/sample-kfs.pdf').toString('base64');
    started = Date.now();
    const read = await post(`${API}/api/journey/${id}/document`, { name: 'sample-kfs.pdf', mime: 'application/pdf', data: kfs });
    line(read.card?.data?.usable === true, 'Sarvam Vision reads a KFS', `${read.card?.data?.rows?.length} fields in ${Date.now() - started} ms`);
    const loan = await post(`${API}/api/journey/${id}/document/confirm`, { accept: true });
    line(loan.card?.data?.aprPct === 18.2 && loan.card?.data?.statedApr === 17.2, 'The engine checks the lender’s APR', `page ${loan.card?.data?.statedApr}%, engine ${loan.card?.data?.aprPct}%`);
    started = Date.now();
    const call = await post(`${API}/api/journey/${id}/promise-check`, { name: 'sample.mp3', mime: 'audio/mpeg', data: readFileSync('public/samples/sample-agent-call.mp3').toString('base64') });
    line(call.card?.data?.total >= 4, 'Promise Check on a recorded call', `${call.card?.data?.broken} of ${call.card?.data?.total} do not match, ${Date.now() - started} ms`);
    const game = await post(`${API}/api/journey/${id}/understanding`, { game: 'scam', answers: [true, false, true, true, false, true, false, true, true, false] });
    line(game.grade?.correct === 10 && Boolean(game.passport), 'A game seals a graded receipt', game.passport?.id);
    const roman = await post(`${API}/api/journey/romanise`, { text: 'आपकी EMI ₹9,603 है।', lang: 'hi' });
    line(/9,603/.test(roman.roman || ''), 'Transliteration keeps the figure', roman.roman);
    const paytm = await (await fetch(`${API}/api/paytm/status`)).json();
    line(paytm.reachable ? (paytm.connected ? true : null) : false, 'Paytm MCP server', paytm.reachable ? (paytm.connected ? 'signed in' : 'answering, not signed in') : `not answering: ${paytm.lastError}`);
  } catch (error) { console.log(`FAIL  New features: ${error.message}`); failed += 1; }
}

try {
  const cached = readdirSync(path.resolve(process.env.MITRA_DATA_DIR || '.data', 'voice-cache')).length;
  line(cached > 100 ? true : null, 'Demo voice cache', `${cached} clips and translations${cached > 100 ? '' : ': run npm run warm'}`);
} catch { line(null, 'Demo voice cache', 'empty: run npm run warm'); }

const phone = await (await fetch(`${API}/api/phone/status`)).json();
line(phone.configured ? true : null, 'Real phone calling', phone.configured ? 'configured' : 'no Twilio account set, so the in-app call is the demo');

console.log(failed ? `\n${failed} check(s) failed.` : '\nReady.');
process.exit(failed ? 1 : 0);
