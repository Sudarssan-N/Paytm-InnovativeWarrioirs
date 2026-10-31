// Serves the built web app from the API process, so one `node server/index.mjs`
// is the whole product on a demo laptop or a single container.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.csv': 'text/csv' };

export async function serveStatic(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  let file = path.resolve(ROOT, relative);
  if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) { res.writeHead(403); return res.end(); }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
  } catch {
    file = path.join(ROOT, 'index.html');
    try { await stat(file); } catch { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Run `npm run build` first, or use `npm run dev`.'); }
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600' });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
  return undefined;
}
