// ─────────────────────────────────────────────────────────────
// Which language did the customer just write in?
//
// Used by MITRA's Auto language mode, so a question typed in Tamil is
// answered (and spoken) in Tamil, and the next one typed in Hindi is
// answered in Hindi. Spoken questions don't need this: Saaras reports the
// language it heard.
//
// Most Indian scripts belong to exactly one of MITRA's languages, so the
// script alone answers it, instantly and offline. Two cases need Sarvam's
// language identifier: Devanagari (Hindi or Marathi) and Latin text, which
// may be English or romanised Hindi ("SIP kitna karna chahiye").
// ─────────────────────────────────────────────────────────────

const SCRIPTS = [
  [/[஀-௿]/, 'ta'],
  [/[ఀ-౿]/, 'te'],
  [/[ಀ-೿]/, 'kn'],
  [/[ഀ-ൿ]/, 'ml'],
  [/[ঀ-৿]/, 'bn'],
  [/[઀-૿]/, 'gu'],
  [/[଀-୿]/, 'od'],
  [/[਀-੿]/, 'pa'],
  [/[؀-ۿ]/, 'ur'],
  [/[ꯀ-꯿]/, 'mni'],
  [/[᱐-᱿]/, 'sat'],
];
const DEVANAGARI = /[ऀ-ॿ]/;
const SUPPORTED = new Set(['en', 'hi', 'ta', 'te', 'bn', 'mr', 'gu', 'kn', 'ml', 'od', 'pa', 'as', 'brx', 'doi', 'kok', 'ks', 'mai', 'mni', 'ne', 'sa', 'sat', 'sd', 'ur']);

// The script's language, 'deva' when it could be Hindi or Marathi, or
// 'latin' for text with no Indian script at all.
export function scriptLanguage(text) {
  const value = String(text || '');
  for (const [pattern, code] of SCRIPTS) if (pattern.test(value)) return code;
  if (DEVANAGARI.test(value)) return 'deva';
  return 'latin';
}

const wordCount = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

// `identify(text)` resolves to { lang } from Sarvam's language identifier, or
// is null when Sarvam isn't available. Returns { lang, romanized }, where
// `romanized` means an Indian language typed in Latin letters.
export async function detectLanguage(text, { identify = null } = {}) {
  const script = scriptLanguage(text);
  if (script !== 'deva' && script !== 'latin') return { lang: script, romanized: false };
  if (script === 'deva') {
    try {
      const found = identify ? (await identify(text))?.lang : null;
      return { lang: found && found !== 'en' && SUPPORTED.has(found) ? found : 'hi', romanized: false };
    } catch { return { lang: 'hi', romanized: false }; }
  }
  // One or two Latin words ("ok", "thanks", "SIP?") are too short to call;
  // treat them as English rather than flip the conversation's language.
  if (!identify || wordCount(text) < 3) return { lang: 'en', romanized: false };
  try {
    const found = (await identify(text))?.lang;
    return found && found !== 'en' && SUPPORTED.has(found) ? { lang: found, romanized: true } : { lang: 'en', romanized: false };
  } catch { return { lang: 'en', romanized: false }; }
}
