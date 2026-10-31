// Readies Kal Ka Ghar for the stage: translates every line and stores MITRA's voice for
// each spoken one, paced under Sarvam's 60 requests a minute.
//   node --env-file=.env scripts/warm-ghar.mjs [langs] [api]
const memory = new Map();
globalThis.localStorage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: (key) => memory.delete(key) };
const { DEFAULT_SPEAKER, speechify } = await import('../src/engine/sarvam.js');
const { defaultScene, quizFor, spanLabel, TERM_UI } = await import('../src/journeys/game/termScene.js');
const { voiceLines } = await import('../src/journeys/game/termGame.js');

const LANGS = (process.argv[2] || 'en,hi,ta').split(',');
const API = process.argv[3] || 'http://127.0.0.1:8787';
const scene = defaultScene();
const spoken = voiceLines(scene);
const written = [...Object.values(TERM_UI), scene.assumption, spanLabel(scene.without.months), spanLabel(scene.with.months), ...quizFor(scene).flatMap((question) => [question.q, ...question.options])];
const pause = () => new Promise((resolve) => setTimeout(resolve, 1100));

async function translate(lang, line) {
  if (lang === 'en') return line;
  const res = await fetch(`${API}/api/journey/game/translate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang, lines: { line } }) });
  await pause();
  return res.ok ? (await res.json()).lines.line : line;
}

for (const lang of LANGS) {
  let same = 0;
  for (const line of written) if (lang !== 'en' && await translate(lang, line) === line) same += 1;
  let voiced = 0;
  for (const line of Object.values(spoken)) {
    const said = await translate(lang, line);
    if (lang !== 'en' && said === line) same += 1;
    const query = new URLSearchParams({ text: speechify(said, lang), lang, speaker: DEFAULT_SPEAKER, pace: '1' });
    const res = await fetch(`${API}/api/voice/say?${query}`);
    await res.arrayBuffer();
    if (res.ok) voiced += 1;
    await pause();
  }
  console.log(`${lang}: ${written.length + Object.keys(spoken).length} lines, ${same} still in English, ${voiced}/${Object.keys(spoken).length} voiced`);
}
process.exit(0);
