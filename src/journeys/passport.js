// Journey Passport: one receipt per explanation, each sealed to the one before.
//
// A hash chain alone is tamper-evident only against someone who cannot rewrite
// the whole chain. Each seal is therefore also signed (Ed25519, on the server),
// and the customer keeps the latest hash. Editing one field breaks the hash;
// recomputing the whole chain breaks the signature.
//
// `sha256` is injected so the same verification runs in Node and in the browser.

export function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export async function sealPassport(chain, payload, { sha256, sign = null }) {
  const previous = chain.at(-1)?.hash || null;
  const body = { ...payload, sequence: chain.length + 1, previous };
  const hash = await sha256(stableJSON(body));
  const passport = { ...body, hash, signature: sign ? await sign(hash) : null };
  chain.push(passport);
  return passport;
}

// Walks the chain and reports the first failure with the reason, so a demo (or
// an auditor) can see exactly which receipt was altered and how.
export async function verifyChain(chain, { sha256, verifySignature = null }) {
  let previous = null;
  for (let index = 0; index < chain.length; index++) {
    const passport = chain[index];
    const { hash, signature, ...body } = passport;
    if (body.sequence !== index + 1) return fail(chain, index, 'sequence', `Expected receipt ${index + 1}, found ${body.sequence}`);
    if (body.previous !== previous) return fail(chain, index, 'link', 'This receipt does not point to the one before it');
    const expected = await sha256(stableJSON(body));
    if (expected !== hash) return { ...fail(chain, index, 'hash', 'A field was changed after this receipt was sealed'), expected, found: hash };
    if (verifySignature && !(await verifySignature(hash, signature))) return fail(chain, index, 'signature', 'The hash adds up, but the seal was not signed by MITRA');
    previous = hash;
  }
  return { valid: true, checked: chain.length, head: previous, signatureChecked: Boolean(verifySignature) };
}

function fail(chain, index, reason, detail) {
  return { valid: false, checked: index, brokenAt: chain[index]?.id || `#${index + 1}`, index, reason, detail };
}

export const shortHash = (hash) => (hash ? `${hash.slice(0, 4)}…${hash.slice(-4)}` : 'pending');

// Browser SHA-256, for the "verify it yourself" button. Node uses node:crypto.
export async function browserSha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
