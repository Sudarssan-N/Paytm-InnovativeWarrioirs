import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve(process.env.MITRA_DATA_DIR || path.join(process.cwd(), '.data'));
const DATA_FILE = path.join(DATA_DIR, 'mitra.json');
const EMPTY = {};
let queue = Promise.resolve();

async function load() {
  try {
    return { ...EMPTY, ...JSON.parse(await readFile(DATA_FILE, 'utf8')) };
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(EMPTY);
    throw error;
  }
}

async function save(db) {
  await mkdir(DATA_DIR, { recursive: true });
  const temp = `${DATA_FILE}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(db, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, DATA_FILE);
}

export function readStore(fn) {
  return queue.then(async () => fn(await load()));
}

export function updateStore(fn) {
  const operation = queue.then(async () => {
    const db = await load();
    const result = await fn(db);
    await save(db);
    return result;
  });
  queue = operation.catch(() => {});
  return operation;
}

export const newId = (prefix) => `${prefix}_${randomBytes(12).toString('hex')}`;
