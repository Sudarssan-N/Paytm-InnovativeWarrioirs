// Number, date and figure helpers shared by every journey engine.
// Pure JavaScript: runs on the server, in the browser and under node:test.

export const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export const pct = (n, digits = 1) => {
  const fixed = Number(n).toFixed(digits);
  return `${fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed}%`;
};

const DAY_MS = 86_400_000;
const asDate = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);

export const isoDate = (date) => new Date(date).toISOString().slice(0, 10);
export const addDays = (iso, days) => isoDate(asDate(iso).getTime() + days * DAY_MS);
export const daysBetween = (from, to) => Math.round((asDate(to) - asDate(from)) / DAY_MS);

export function fmtDate(iso) {
  return asDate(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// ── reading a number out of what the customer said ──────────────
const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { hundred: 100, thousand: 1000, k: 1000, lakh: 100000, lakhs: 100000, lac: 100000, lacs: 100000, crore: 10000000, crores: 10000000, million: 1000000 };

// "forty five thousand" → 45000. Returns null when no number word is present.
function wordsToNumber(text) {
  const tokens = String(text).toLowerCase().replace(/[-,.?!;:]/g, ' ').split(/\s+/).filter(Boolean);
  let total = 0, current = 0, seen = false;
  for (const token of tokens) {
    if (token in ONES) { current += ONES[token]; seen = true; }
    else if (token in TENS) { current += TENS[token]; seen = true; }
    else if (token in SCALES && seen) {
      const scale = SCALES[token];
      if (scale === 100) current *= 100;
      else { total += (current || 1) * scale; current = 0; }
    } else if (seen && token !== 'and') break;
  }
  return seen ? total + current : null;
}

const isNumberWord = (word) => word in ONES || word in TENS || (word in SCALES && word !== 'k');
const bare = (token = '') => token.toLowerCase().replace(/^[^\p{L}\p{N}₹]+|[^\p{L}\p{N}%]+$/gu, '');
const trailing = (token = '') => token.match(/[.,;:?!]+$/)?.[0] || '';
const NEXT_IS_A_UNIT = /^(%|percent|per|years?|yrs?|months?|mos?|emis?|days?)$/;

// Speech arrives as words: "fourteen percent", "one lakh ninety two thousand".
// Every spoken number becomes digits, so a figure said aloud reads like one typed.
export function numberWordsToDigits(text) {
  const tokens = String(text ?? '').replace(/(\p{L})-(\p{L})/gu, '$1 $2').split(/\s+/).filter(Boolean);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const word = bare(tokens[i]);
    const next = bare(tokens[i + 1]);
    const digits = word.match(/^₹?(\d[\d,]*(?:\.\d+)?)$/);
    if (digits && next in SCALES && !trailing(tokens[i])) {
      out.push(`${Math.round(Number(digits[1].replace(/,/g, '')) * SCALES[next])}${trailing(tokens[i + 1])}`);
      i += 2;
      continue;
    }
    if (word === 'a' && next in SCALES && next !== 'k') {
      out.push(`${SCALES[next]}${trailing(tokens[i + 1])}`);
      i += 2;
      continue;
    }
    if (!(word in ONES || word in TENS)) { out.push(tokens[i]); i += 1; continue; }
    let j = i;
    const words = [];
    while (j < tokens.length) {
      const current = bare(tokens[j]);
      if (isNumberWord(current)) words.push(current);
      else if (!(current === 'and' && words.length && isNumberWord(bare(tokens[j + 1])))) break;
      j += 1;
      if (trailing(tokens[j - 1])) break;
    }
    // "five lakh three years": the three belongs to the years, not to the lakh.
    const lastBig = words.findLastIndex((item) => SCALES[item] >= 1000);
    if (lastBig !== -1 && lastBig < words.length - 1 && !trailing(tokens[j - 1]) && NEXT_IS_A_UNIT.test(bare(tokens[j]))
      && !words.slice(lastBig + 1).includes('hundred')) {
      const peel = words.length - 1 - lastBig;
      j -= peel;
      words.length = lastBig + 1;
    }
    let value = String(wordsToNumber(words.join(' ')));
    let end = tokens[j - 1];
    if (!trailing(end) && bare(tokens[j]) === 'point' && ONES[bare(tokens[j + 1])] < 10) {
      let k = j + 1, fraction = '';
      while (k < tokens.length && ONES[bare(tokens[k])] < 10) {
        fraction += ONES[bare(tokens[k])];
        k += 1;
        if (trailing(tokens[k - 1])) break;
      }
      value += `.${fraction}`;
      end = tokens[k - 1];
      j = k;
    }
    out.push(`${value}${trailing(end)}`);
    i = j;
  }
  return out.join(' ');
}

// An amount in rupees from free speech: "45,000", "₹45000", "45k", "2.5 lakh",
// "forty five thousand". Returns null rather than guess.
export function parseAmount(text) {
  const value = String(text || '').toLowerCase().replace(/rs\.?|rupees?|₹/g, ' ');
  const digits = value.match(/(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|crores?|million)?\b/);
  if (digits) {
    const n = Number(digits[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    return Math.round(n * (digits[2] ? SCALES[digits[2]] : 1));
  }
  return wordsToNumber(value);
}

// The terms of a loan the customer describes in their own words. Read
// deterministically, so a model never supplies them. Any field may be null.
export function parseLoanTerms(text) {
  let rest = numberWordsToDigits(asciiDigits(text)).toLowerCase();
  const take = (re) => {
    const found = rest.match(re);
    if (found) rest = rest.replace(found[0], ' ');
    return found;
  };
  take(/\bemi\b\s*(?:is|of|=|:)?\s*₹?\s*\d[\d,]*/); // a stated EMI is not the amount borrowed
  const fee = take(/(?:(?:processing )?fee|charges?)\D{0,15}(\d[\d,]*)/);
  const rate = take(/(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)/);
  const tenure = take(/(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mos?|emis?)\b/);
  const amount = /\d|\b(lakhs?|lacs?|crores?|thousand)\b/.test(rest) ? parseAmount(rest) : null;
  const principal = amount && amount >= 1000 ? amount : null;
  const months = tenure ? Math.round(Number(tenure[1]) * (/^y/.test(tenure[2]) ? 12 : 1)) : null;
  return {
    principal, ratePct: rate ? Number(rate[1]) : null, months, fee: fee ? Number(fee[1].replace(/,/g, '')) : null,
    mentioned: Boolean(principal || rate || tenure),
  };
}

// How many people depend on the customer: "my wife and two kids" → 3.
export function parseDependants(text) {
  const value = String(text || '').toLowerCase();
  if (/\b(no one|nobody|none|no dependants?|just me|only me)\b/.test(value)) return 0;
  let count = 0, matched = false;
  if (/\b(wife|husband|spouse)\b/.test(value)) { count += 1; matched = true; }
  if (/\b(parents)\b/.test(value)) { count += 2; matched = true; }
  else if (/\b(mother|father|mom|dad|amma|appa)\b/.test(value)) { count += 1; matched = true; }
  const number = value.match(/\b(\d{1,2})\b/)?.[1] ?? wordsToNumber(value);
  if (number != null) { count += Number(number); matched = true; }
  else if (/\b(son|daughter|child|kid)\b/.test(value)) { count += 1; matched = true; }
  return matched ? count : null;
}

const YES = /\b(yes|yeah|yep|ok|okay|sure|please do|go ahead|fine|agreed|i agree|you may|you can|haan|ha|han|ji|theek|sari|aam)\b|ஆம்|சரி|हाँ|हां|ठीक/i;
const NO = /\b(no|nope|don'?t|do not|not now|never|nahi|nahin|venda|illai)\b|இல்லை|வேண்டாம்|नहीं|ना\b/i;

export function parseYesNo(text) {
  const value = String(text || '');
  if (NO.test(value)) return false;
  if (YES.test(value)) return true;
  return null;
}

// ── the figures fence ───────────────────────────────────────────
// Native digits count as the same figure as their ASCII form, so a translator
// that writes Devanagari numerals is not a false alarm.
const NATIVE_DIGITS = [0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0B66, 0x0BE6, 0x0C66, 0x0CE6, 0x0D66];

export function asciiDigits(text) {
  return String(text ?? '').replace(/[०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯]/g, (ch) => {
    const code = ch.codePointAt(0);
    const zero = NATIVE_DIGITS.find((base) => code >= base && code <= base + 9);
    return String(code - zero);
  });
}

export const figuresIn = (text) => (asciiDigits(text).match(/\d+(?:[.,]\d+)*/g) || []).map((item) => item.replace(/,/g, ''));
const percentagesIn = (text) => Array.from(asciiDigits(text).matchAll(/(\d+(?:[.,]\d+)*)\s*%/g), (m) => m[1].replace(/,/g, ''));

// Word order changes between languages, so quantities compare as a multiset.
// A percentage must stay a percentage, so an amount can't become a rate.
export function checkFigures(source, translated) {
  const from = figuresIn(source), to = figuresIn(translated);
  const remaining = [...to];
  const missing = from.filter((figure) => {
    const at = remaining.indexOf(figure);
    if (at === -1) return true;
    remaining.splice(at, 1);
    return false;
  });
  const pctFrom = percentagesIn(source).sort(), pctTo = percentagesIn(translated).sort();
  const percentOk = pctFrom.length === pctTo.length && pctFrom.every((value, index) => value === pctTo[index]);
  return { ok: !missing.length && !remaining.length && percentOk, missing, added: remaining, checked: from };
}

// Every figure the reply states must already exist in what the engine computed
// (or the customer's own words). Small counts are exempt: "two plans" restates
// a fact, it is not a new number. This is the check that keeps the language
// model — and any future template — from inventing a rupee.
export function assertGrounded(reply, computed, customerWords = '') {
  const allowed = new Set([...figuresIn(JSON.stringify(computed)), ...figuresIn(customerWords)]);
  const invented = figuresIn(reply).filter((figure) => !allowed.has(figure) && !/^\d$/.test(figure));
  return { ok: !invented.length, invented };
}
