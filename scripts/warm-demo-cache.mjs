// Plays the demo conversations through the real API, then stores the speech for
// every reply. On stage those lines start instantly and survive the Wi-Fi going down.
// Run the night before: npm run warm. MITRA_NOW fixes dates to the day of the demo.
//   node --env-file=.env scripts/warm-demo-cache.mjs [http://127.0.0.1:8787]

const memory = new Map();
globalThis.localStorage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: (key) => memory.delete(key) };
const { speechify, DEFAULT_SPEAKER } = await import('../src/engine/sarvam.js');
const { scriptLanguage } = await import('../src/engine/languageDetect.js');
const { SAMPLE_MESSAGES } = await import('../src/journeys/sampleData.js');

const API = process.argv[2] || 'http://127.0.0.1:8787';
const KEY = process.env.SARVAM_API_KEY || process.env.VITE_SARVAM_API_KEY;
if (!KEY) { console.error('Set SARVAM_API_KEY in .env first.'); process.exit(1); }

const post = async (path, body = {}) => {
  const res = await fetch(`${API}/api/journey${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
};

const SCRIPTS = [
  { customerId: 'ramesh', name: 'Tamil loan call', lines: [
    ['இந்த லோனுக்கு உண்மையான செலவு எவ்வளவு?'], ['என் மாத வருமானம் 45,000 ரூபாய்'], ['முன்கூட்டியே கடனை அடைத்தால் அபராதம் உண்டா?'], ['ஆம், கேளுங்கள்'],
    ['What does this loan really cost?', true], ['Can I close the loan early without a penalty?', true], ['Yes, ask an expert', true], ['I will take this loan', true], ['I have signed the loan', true], ['That is all, thank you', true],
  ] },
  { customerId: 'ramesh', name: 'Tamil insurance, claim and scam', lines: [
    ['எனக்கு எவ்வளவு இன்சூரன்ஸ் தேவை?'], ['என் மாத வருமானம் 45,000 ரூபாய்'], ['என் மனைவி மற்றும் இரண்டு குழந்தைகள்'], ['10 லட்சம்'], ['3 லட்சம்'],
    ['Explain the plans in simple words', true], ['My claim was cut, why?', true], ['Draft the grievance', true], ['No, not now', true], ['Is this message a scam?', true],
    [SAMPLE_MESSAGES.loanScam, true], [SAMPLE_MESSAGES.collect, true],
  ] },
  { customerId: 'ramesh', name: 'Hindi', lines: [
    ['इस लोन की असली लागत कितनी है?'], ['मेरी मासिक आय 45,000 रुपये है'], ['मुझे कितना बीमा चाहिए?'], ['हाँ'], ['मेरी पत्नी और दो बच्चे'], ['10 लाख'], ['3 लाख'],
    ['My claim was cut, why?', true], ['Draft the grievance', true], ['Yes, ask an expert', true],
  ] },
  { customerId: 'ramesh', name: 'English, the full path', lines: [
    ['What does this loan really cost?'], ['45,000 a month'], ['Can I close the loan early without a penalty?'], ['Yes, ask an expert'], ['How much insurance do I need?'], ['Yes, go ahead'], ['My wife and two kids'], ['₹10 lakh'], ['₹3 lakh from my employer'],
    ['Explain the plans in simple words'], ['I bought the family floater'], ['My claim was cut, why?'], ['Draft the grievance'], ['No, not now'], ['How do I file a claim?'], ['I have the discharge summary and bills'],
    [SAMPLE_MESSAGES.loanScam], [SAMPLE_MESSAGES.collect], ['Someone is on the phone telling me to share the OTP right now, I am scared'], ['Withdraw my income consent'], ['That is all, thank you'],
  ] },
  { customerId: 'lakshmi', name: 'Soundbox merchant, Tamil', lines: [
    ['என் கடைக்கு சரக்கு வாங்க பணம் வேண்டும்'], ['ஆம்'], ['Yes, send it to the lender', true], ['That is all, thank you', true],
  ] },
  { customerId: 'lakshmi', name: 'Soundbox merchant, English', lines: [
    ['I need money for stock for my shop'], ['Yes, go ahead'], ['Yes, send it to the lender'],
  ] },
  { customerId: 'ramesh', name: 'Telugu', lines: [['ఈ లోన్ నిజమైన ఖర్చు ఎంత?']] },
  { customerId: 'ramesh', name: 'Bengali', lines: [['এই লোনের আসল খরচ কত?']] },
  { customerId: 'ramesh', name: 'Marathi', lines: [['या कर्जाचा खरा खर्च किती आहे?']] },
  { customerId: 'ramesh', name: 'Gujarati', lines: [['આ લોનનો સાચો ખર્ચ કેટલો છે?']] },
  { customerId: 'ramesh', name: 'Kannada', lines: [['ಈ ಸಾಲದ ನಿಜವಾದ ವೆಚ್ಚ ಎಷ್ಟು?']] },
  { customerId: 'ramesh', name: 'Malayalam', lines: [['ഈ ലോണിന്റെ യഥാർത്ഥ ചെലവ് എത്രയാണ്?']] },
  { customerId: 'ramesh', name: 'Odia', lines: [['ଏହି ଋଣର ପ୍ରକୃତ ଖର୍ଚ୍ଚ କେତେ?']] },
  { customerId: 'ramesh', name: 'Punjabi', lines: [['ਇਸ ਲੋਨ ਦੀ ਅਸਲ ਲਾਗਤ ਕਿੰਨੀ ਹੈ?']] },
];

const voiceFor = (text, lang) => {
  const script = scriptLanguage(text);
  if (script === 'latin') return 'en';
  if (script === 'deva') return ['hi', 'mr'].includes(lang) ? lang : 'hi';
  return script;
};

// The same request the browser makes, so the server finds it in the cache.
const pending = new Map();
const collect = (reply) => {
  const lang = voiceFor(reply.native, reply.lang);
  const query = new URLSearchParams({ text: speechify(reply.native, lang), lang, speaker: DEFAULT_SPEAKER, pace: '1' });
  pending.set(query.toString(), { lang, text: reply.native });
};

let failures = 0;
for (const script of SCRIPTS) {
  const opening = await post('/session', { customerId: script.customerId });
  collect(opening.reply);
  for (const [text, tapped] of script.lines) {
    const turn = await post(`/${opening.state.sessionId}/turn`, { text, tapped: Boolean(tapped) });
    collect(turn.reply);
    // The runbook's expert note, so the follow-up in the demo is instant as well.
    if (turn.handoff && script.name === 'Tamil loan call') {
      const out = await post(`/desk/${turn.handoff.id}/resolve`, { outcome: 'resolved', notes: 'The lender confirms a 2% charge before 12 EMIs and none after.' });
      const followUp = out.state.notifications.at(-1);
      collect({ native: followUp.native, lang: followUp.lang });
    }
    const rejected = turn.reply.rejected ? ` (${turn.reply.rejected} sentences left in English)` : '';
    if (rejected) failures += 1;
    console.log(`  ${script.name}: ${turn.tool} [${turn.reply.lang}]${rejected}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

console.log(`\nStoring speech for ${pending.size} replies…`);
let stored = 0, failed = 0, wrong = 0;
for (const query of pending.keys()) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(`${API}/api/voice/say?${query}`, { signal: AbortSignal.timeout(90000) });
      if (res.status === 429 || res.status === 504) { await new Promise((resolve) => setTimeout(resolve, 4000 * (attempt + 1))); throw new Error('rate limited'); }
      if (!res.ok) throw new Error(`status ${res.status}`);
      await res.arrayBuffer();
      const check = await (await fetch(`${API}/api/voice/verify?${query}`, { signal: AbortSignal.timeout(90000) })).json();
      if (check.checked && !check.ok) { wrong += 1; console.log(`\n  voice check failed: ${pending.get(query).text.slice(0, 90)}\n     not heard: ${check.missing?.join(', ')} | ${String(check.heard).slice(0, 120)}`); }
      stored += 1;
      process.stdout.write('.');
      break;
    } catch (error) {
      if (attempt === 5) { failed += 1; console.log(`\n  could not store a reply: ${error.message}`); }
    }
  }
}
console.log(`\nDone. Stored ${stored}, failed ${failed}. Voice check failures: ${wrong}. Sentences left in English: ${failures}.`);
process.exit(failed ? 1 : 0);
