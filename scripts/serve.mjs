// Small static server for dist/ on node:http. For local checks only.
// Run: npm run serve (PORT=4173 by default). The site is served at / and also at
// /mosaic-snapshot/, the path it will have on the GitHub Pages preview.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = path.join(ROOT, 'dist');
export const PREVIEW_BASE = '/mosaic-snapshot';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

export function createStaticServer(dir = DIST) {
  return createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === PREVIEW_BASE) {
        res.writeHead(301, { Location: `${PREVIEW_BASE}/` });
        res.end();
        return;
      }
      if (pathname.startsWith(`${PREVIEW_BASE}/`)) pathname = pathname.slice(PREVIEW_BASE.length);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = path.normalize(path.join(dir, pathname));
      if (!file.startsWith(dir + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }
      const info = await stat(file).catch(() => null);
      if (!info || !info.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(await readFile(file));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(error));
    }
  });
}

export function startServer(port = 0, dir = DIST) {
  return new Promise((resolve, reject) => {
    const server = createStaticServer(dir);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolve({ server, port: actual, url: `http://127.0.0.1:${actual}` });
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 4173;
  const { url } = await startServer(port);
  console.log(`Serving dist/ at ${url}/ and ${url}${PREVIEW_BASE}/ (Ctrl+C to stop)`);
}
