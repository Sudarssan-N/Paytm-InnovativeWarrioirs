// Disk cache for deterministic voice calls: the same text in the same voice gives
// the same audio. Warmed before a demo by scripts/warm-demo-cache.mjs. Entries expire,
// and with MITRA_CACHE_KEY set they are encrypted at rest: a reply can hold a figure
// that belongs to a customer.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIR = path.resolve(process.env.MITRA_DATA_DIR || path.join(process.cwd(), '.data'), 'voice-cache');
const ENABLED = process.env.MITRA_VOICE_CACHE !== 'off';
const MAX_AGE_MS = Number(process.env.MITRA_CACHE_DAYS || 30) * 86_400_000;
const KEY = process.env.MITRA_CACHE_KEY ? createHash('sha256').update(process.env.MITRA_CACHE_KEY).digest() : null;

export const cacheKey = (...parts) => createHash('sha256').update(parts.join('\u0000')).digest('hex');

function seal(data) {
  if (!KEY) return data;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function open(data) {
  if (!KEY) return data;
  const decipher = createDecipheriv('aes-256-gcm', KEY, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
}

export async function readVoiceCache(key) {
  if (!ENABLED) return null;
  const file = path.join(DIR, `${key}.json`);
  try {
    if (Date.now() - (await stat(file)).mtimeMs > MAX_AGE_MS) { await unlink(file).catch(() => {}); return null; }
    return open(await readFile(file));
  } catch { return null; }
}

export async function writeVoiceCache(key, data) {
  if (!ENABLED) return;
  try {
    await mkdir(DIR, { recursive: true });
    const temp = path.join(DIR, `${key}.${process.pid}.tmp`);
    await writeFile(temp, seal(Buffer.from(data)), { mode: 0o600 });
    await rename(temp, path.join(DIR, `${key}.json`));
  } catch { /* a cache that cannot write only costs a repeat call */ }
}
