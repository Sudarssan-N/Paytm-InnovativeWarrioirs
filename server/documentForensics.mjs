// What a file says about itself: which program made it, when it was made and changed,
// how many times it was saved, and whether a digital signature still covers all of it.
// Read from the bytes, before anything is sent to Sarvam. Nothing here is stored.
//
// It reads plain PDF structure and the text tags in JPEG and PNG files. A PDF whose
// details sit in a compressed stream simply shows fewer details; that is not a warning.

// Programs that change how a paper looks. A bank or the tax portal does not use them.
const EDITORS = [
  [/photoshop/i, 'Adobe Photoshop'], [/\bgimp\b/i, 'GIMP'], [/canva/i, 'Canva'], [/ilovepdf/i, 'iLovePDF'], [/sejda/i, 'Sejda'],
  [/pdfescape/i, 'PDFescape'], [/smallpdf/i, 'Smallpdf'], [/pdf-?xchange/i, 'PDF-XChange Editor'], [/phantompdf|foxit pdf editor/i, 'Foxit PDF Editor'],
  [/\bnitro\b/i, 'Nitro PDF'], [/pdffiller/i, 'pdfFiller'], [/pdfelement|wondershare/i, 'PDFelement'], [/inkscape/i, 'Inkscape'],
  [/pixelmator/i, 'Pixelmator'], [/snapseed/i, 'Snapseed'], [/picsart/i, 'PicsArt'], [/\bpixlr\b/i, 'Pixlr'], [/\bfotor\b/i, 'Fotor'],
  [/lightroom/i, 'Adobe Lightroom'], [/photoroom/i, 'PhotoRoom'], [/affinity (photo|designer|publisher)/i, 'Affinity'], [/paint\.net/i, 'Paint.NET'],
  [/soda pdf/i, 'Soda PDF'], [/pdf ?candy/i, 'PDF Candy'], [/dochub/i, 'DocHub'], [/pdf ?buddy/i, 'PDF Buddy'], [/formswift/i, 'FormSwift'], [/apowerpdf/i, 'ApowerPDF'],
];
// Word processors and spreadsheets: fine for a letter, not how a bank makes a statement.
const OFFICE = [[/microsoft.{0,12}word/i, 'Microsoft Word'], [/microsoft.{0,12}excel/i, 'Microsoft Excel'], [/libreoffice|openoffice/i, 'LibreOffice'], [/wps (office|writer)/i, 'WPS Office'], [/^pages\b/i, 'Apple Pages'], [/google docs/i, 'Google Docs']];

const named = (list, ...texts) => { for (const text of texts.filter(Boolean)) for (const [re, name] of list) if (re.test(text)) return name; return null; };

// PDF strings are (literal) or <hex>, and UTF-16 when they start with a byte-order mark.
function pdfString(raw) {
  if (!raw) return null;
  let bytes;
  if (raw.startsWith('<')) bytes = Buffer.from(raw.slice(1, -1).replace(/\s/g, ''), 'hex');
  else {
    const body = raw.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] ?? (/^[0-7]+$/.test(c) ? String.fromCharCode(parseInt(c, 8)) : c)));
    bytes = Buffer.from(body, 'latin1');
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) { const swapped = Buffer.from(bytes.subarray(2)); swapped.swap16(); return swapped.toString('utf16le').trim(); }
  return bytes.toString('latin1').replace(/\0/g, '').trim() || null;
}

// The last value wins: an incremental save writes a newer Info dictionary after the old one.
function infoValue(text, key) {
  const re = new RegExp(`/${key}\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)`, 'g');
  let last = null;
  for (const m of text.matchAll(re)) last = m[1];
  return pdfString(last);
}
const xmpValue = (text, key) => text.match(new RegExp(`<${key}>([^<]{1,200})</${key}>`))?.[1]?.trim() || text.match(new RegExp(`${key}="([^"]{1,200})"`))?.[1]?.trim() || null;

// D:20261030211952+05'30' → an ISO time.
function pdfDate(value) {
  const m = String(value || '').match(/^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([+\-Z])?(\d{2})?'?(\d{2})?/);
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', sign, oh = '00', om = '00'] = m;
  const zone = !sign || sign === 'Z' ? 'Z' : `${sign}${oh}:${om}`;
  const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${zone}`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
const isoOrNull = (value) => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? new Date(ms).toISOString() : null; };

function pdfForensics(buffer) {
  const text = buffer.toString('latin1');
  const producer = infoValue(text, 'Producer') || xmpValue(text, 'pdf:Producer');
  const creator = infoValue(text, 'Creator') || xmpValue(text, 'xmp:CreatorTool');
  // Photoshop and others leave a history of every program that saved the file.
  const agents = [...text.matchAll(/stEvt:softwareAgent(?:>|=")([^<"]{1,120})/g)].map((m) => m[1]);
  const created = pdfDate(infoValue(text, 'CreationDate')) || isoOrNull(xmpValue(text, 'xmp:CreateDate'));
  const modified = pdfDate(infoValue(text, 'ModDate')) || isoOrNull(xmpValue(text, 'xmp:ModifyDate'));
  // A linearized file carries a second end marker by design.
  const saves = Math.max((text.match(/%%EOF/g) || []).length - (/\/Linearized\b/.test(text.slice(0, 2048)) ? 1 : 0), 1);
  const ranges = [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
  const last = ranges.at(-1);
  const signed = last ? { count: ranges.length, coversWhole: Number(last[1]) === 0 && Number(last[3]) + Number(last[4]) >= buffer.length - 2 } : null;
  return { format: 'pdf', producer, creator, created, modified, saves, signed, editor: named(EDITORS, producer, creator, ...agents), office: named(OFFICE, producer, creator) };
}

// JPEG and PNG keep the editing program as plain text near the start of the file:
// the EXIF Software tag, a PNG text chunk, or XMP.
function imageForensics(buffer) {
  const head = buffer.subarray(0, 262_144).toString('latin1');
  const software = head.match(/Software\0([\x20-\x7e]{2,80})/)?.[1] || xmpValue(head, 'xmp:CreatorTool') || null;
  const agents = [...head.matchAll(/stEvt:softwareAgent(?:>|=")([^<"]{1,120})/g)].map((m) => m[1]);
  return { format: 'image', software, saves: 1, signed: null, editor: named(EDITORS, software, ...agents) || named(EDITORS, head.replace(/[^\x20-\x7e]+/g, ' ')), office: null };
}

const MAGIC = [['pdf', (b) => b.subarray(0, 1024).toString('latin1').includes('%PDF-')], ['jpeg', (b) => b[0] === 0xff && b[1] === 0xd8], ['png', (b) => b.subarray(1, 4).toString('latin1') === 'PNG']];
const CLAIMED = { 'application/pdf': 'pdf', 'image/jpeg': 'jpeg', 'image/png': 'png' };

export function fileForensics(buffer, { mime = 'application/pdf' } = {}) {
  try {
    const actual = MAGIC.find(([, test]) => test(buffer))?.[0] || 'unknown';
    const claimed = CLAIMED[mime] || mime;
    const found = actual === 'pdf' ? pdfForensics(buffer) : actual === 'jpeg' || actual === 'png' ? imageForensics(buffer) : { format: 'unknown', saves: 1, signed: null, editor: null, office: null };
    const formatLabel = actual === 'unknown' ? 'file of unknown type' : actual === 'pdf' ? 'PDF' : `${actual.toUpperCase()} image`;
    return { ...found, mismatch: actual !== claimed, claimed: claimed.toUpperCase(), formatLabel };
  } catch {
    return null;
  }
}
