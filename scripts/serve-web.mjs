import http from 'node:http';
import path from 'node:path';
import { lstat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../apps/web/dist/client/', import.meta.url));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

export function createWebServer({ root = defaultRoot, apiPort = 4311, webPort = 5178 } = {}) {
  const staticRoot = path.resolve(root);
  const hosts = new Set([`127.0.0.1:${webPort}`, `localhost:${webPort}`]);
  const origins = new Set([...hosts].map((host) => `http://${host}`));
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!hosts.has(req.headers.host ?? '') ||
        (req.headers.origin && !origins.has(req.headers.origin)) ||
        req.headers['sec-fetch-site'] === 'cross-site') {
      res.writeHead(403).end();
      return;
    }
    let pathname;
    try { pathname = new URL(req.url ?? '/', 'http://localhost').pathname; }
    catch { res.writeHead(400).end(); return; }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const headers = { ...req.headers, host: `127.0.0.1:${apiPort}` };
      const upstream = http.request({
        host: '127.0.0.1', port: apiPort, path: req.url, method: req.method,
        headers, timeout: 120000,
      }, (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      });
      upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Local service unavailable');
      });
      req.pipe(upstream);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let name;
    try { name = decodeURIComponent(pathname); }
    catch { res.writeHead(400).end(); return; }
    // The SPA has one document plus Vite's immutable assets. No arbitrary files
    // from the release directory or its parents are made addressable.
    if (name === '/') name = '/index.html';
    if (name !== '/index.html' && !/^\/assets\/[A-Za-z0-9._-]+$/.test(name)) {
      res.writeHead(404).end();
      return;
    }
    const target = path.join(staticRoot, name.slice(1));
    try {
      const item = await lstat(target);
      if (!item.isFile() || item.isSymbolicLink()) throw new Error('not a regular file');
      const bytes = await readFile(target);
      res.writeHead(200, {
        'Content-Type': mime[path.extname(target)] ?? 'application/octet-stream',
        'Cache-Control': name === '/index.html' ? 'no-store' : 'public, max-age=31536000, immutable',
        'Content-Length': bytes.length,
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.REELORI_WEB_PORT ?? 5178);
  const apiPort = Number(process.env.REELORI_PORT ?? 4311);
  if (![port, apiPort].every((value) => Number.isInteger(value) && value > 0 && value <= 65535))
    throw new Error('Invalid local port');
  createWebServer({ webPort: port, apiPort }).listen(port, '127.0.0.1', () => {
    console.log(`Reelori http://127.0.0.1:${port}`);
  });
}
