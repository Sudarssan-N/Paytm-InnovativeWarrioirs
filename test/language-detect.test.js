import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, scriptLanguage } from '../src/engine/languageDetect.js';

test('a distinctive script identifies the language without a network call', async () => {
  const identify = async () => { throw new Error('should not be called'); };
  assert.deepEqual(await detectLanguage('என் சேமிப்பு எவ்வளவு?', { identify }), { lang: 'ta', romanized: false });
  assert.equal(scriptLanguage('నా పొదుపు ఎంత?'), 'te');
  assert.equal(scriptLanguage('ನನ್ನ ಉಳಿತಾಯ ಎಷ್ಟು?'), 'kn');
  assert.equal(scriptLanguage('എന്റെ സമ്പാദ്യം എത്ര?'), 'ml');
  assert.equal(scriptLanguage('আমার সঞ্চয় কত?'), 'bn');
  assert.equal(scriptLanguage('મારી બચત કેટલી છે?'), 'gu');
});

test('Devanagari asks the identifier to split Hindi from Marathi, defaulting to Hindi', async () => {
  assert.equal((await detectLanguage('माझी बचत किती आहे?', { identify: async () => ({ lang: 'mr' }) })).lang, 'mr');
  assert.equal((await detectLanguage('मेरी बचत कितनी है?', { identify: async () => ({ lang: 'hi' }) })).lang, 'hi');
  assert.equal((await detectLanguage('मेरी बचत कितनी है?', { identify: async () => { throw new Error('down'); } })).lang, 'hi');
  assert.equal((await detectLanguage('मेरी बचत कितनी है?')).lang, 'hi');
});

test('Latin text is English unless the identifier recognises a romanised Indian language', async () => {
  assert.deepEqual(await detectLanguage('SIP kitna karna chahiye', { identify: async () => ({ lang: 'hi' }) }), { lang: 'hi', romanized: true });
  assert.deepEqual(await detectLanguage('How much should I save?', { identify: async () => ({ lang: 'en' }) }), { lang: 'en', romanized: false });
  assert.equal((await detectLanguage('ok thanks', { identify: async () => ({ lang: 'hi' }) })).lang, 'en', 'too short to switch language');
  assert.equal((await detectLanguage('mera paisa kahan lagaun', { identify: null })).lang, 'en', 'no identifier: stay in English');
  assert.equal((await detectLanguage('this is fine really', { identify: async () => ({ lang: 'fr' }) })).lang, 'en', 'unsupported languages are ignored');
});

test('translation survives Sarvam’s "=" filter and 1000-character limit, keeping only failing lines in English', async () => {
  const mem = new Map([['mitra_sarvam_key', 'test-key']]);
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const realFetch = globalThis.fetch;
  const inputs = [];
  const modes = [];
  // Fake Mayura: rejects "=" and inputs over 1000 chars, refuses one poison line, otherwise tags the text.
  globalThis.fetch = async (url, options) => {
    const { input } = JSON.parse(options.body);
    inputs.push(input);
    const { mode } = JSON.parse(options.body);
    modes.push(mode);
    const bad = input.includes('=') || input.length > 1000 || input.includes('POISON') || (input.includes('DROPS') && mode === 'modern-colloquial');
    return new Response(JSON.stringify(bad ? { error: { message: 'Input contains potentially unsafe content.' } } : { translated_text: `[ta] ${input}` }), { status: bad ? 400 : 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { translateSarvam, splitLong } = await import('../src/engine/sarvam.js');
    const longLine = 'This sentence is about your savings and goals. '.repeat(40).trim();
    assert.ok(splitLong(longLine, 300).every((c) => c.length <= 300));
    assert.equal(splitLong('short line').length, 1);

    const out = await translateSarvam('Target is 6 months = Rs 3,79,750.\n• POISON line stays.\n• Last line.', 'ta');
    assert.ok(inputs.every((i) => !i.includes('=') && i.length <= 1000), 'no "=" and nothing over the limit is ever sent');
    assert.deepEqual(out.split('\n'), [
      '[ta] Target is 6 months is Rs 3,79,750.',
      '• POISON line stays.',
      '• [ta] Last line.',
    ], 'lines and bullets keep their layout; a failing line stays in English');

    modes.length = 0;
    const retried = await translateSarvam('This line DROPS a clause in one style.', 'ta');
    assert.equal(retried, '[ta] This line DROPS a clause in one style.', 'a line that fails in one style is retried in another');
    assert.deepEqual(modes, ['modern-colloquial', 'classic-colloquial']);

    const big = await translateSarvam(`Intro line.\n${longLine}\n• Bullet.`, 'ta');
    assert.equal(big.split('\n').length, 3);
    assert.ok((big.split('\n')[1].match(/\[ta\]/g) || []).length > 1, 'an over-long line is translated in several pieces');
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.localStorage;
  }
});
