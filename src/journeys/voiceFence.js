// The figures fence checks text. This one checks sound. Bulbul read "APR 17.7%"
// as a date, "17 April, 7 percent", in ten languages, and the text fence passed
// because the text was right. So MITRA also listens to its own voice: Saaras hears
// the audio back in English, and every figure must be heard as it was written.
import { asciiDigits, figuresIn, numberWordsToDigits } from './money.js';

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const under100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const under1000 = (n) => (n < 100 ? under100(n) : `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${under100(n % 100)}` : ''}`);

// 192920 → "one lakh ninety two thousand nine hundred twenty".
export function spellIndian(value) {
  const [whole, fraction] = String(value).replace(/,/g, '').split('.');
  let n = Number(whole);
  const parts = [];
  for (const [size, name] of [[10000000, 'crore'], [100000, 'lakh'], [1000, 'thousand']]) {
    if (n >= size) { parts.push(`${under1000(Math.floor(n / size))} ${name}`); n %= size; }
  }
  if (n || !parts.length) parts.push(under1000(n));
  const spoken = parts.join(' ');
  return fraction ? `${spoken} point ${[...fraction].map((digit) => ONES[Number(digit)]).join(' ')}` : spoken;
}

// Bulbul drops the tens from a Kannada figure: ₹590 is spoken as five hundred, and
// ₹93,750 as 93,700, on every voice we tried. Written as English words, the way money
// is often said anyway, every figure comes through. The voice check guards the rest.
const SPELL_FIGURES = new Set(['kn']);

// What a person should hear, not what a screen should show. Letters spaced out
// are read as letters, so APR can't be taken for April next to a number.
export function speakable(text, lang = null) {
  const value = String(text ?? '').replace(/\bAPR\b/g, 'A P R');
  if (!SPELL_FIGURES.has(lang)) return value;
  return value
    .replace(/₹\s?(\d+(?:[.,]\d+)*)/g, (_, figure) => `${spellIndian(figure)} rupees`)
    .replace(/\d+(?:[.,]\d+)*/g, (figure) => spellIndian(figure));
}

export function heardFigures(heardEnglish) {
  return figuresIn(numberWordsToDigits(asciiDigits(heardEnglish).replace(/₹/g, ' ')));
}

export function checkSpoken(source, heardEnglish) {
  const expected = figuresIn(source);
  const heard = heardFigures(heardEnglish);
  const left = [...heard];
  const missing = expected.filter((figure) => {
    const at = left.indexOf(figure);
    if (at === -1) return true;
    left.splice(at, 1);
    return false;
  });
  const dateMisread = /\bapril\b/i.test(heardEnglish) && /\bAPR\b|A P R/.test(source);
  return { ok: !missing.length && !dateMisread, expected, heard, missing, dateMisread };
}
