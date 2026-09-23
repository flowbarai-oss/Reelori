import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWebServer } from '../scripts/serve-web.mjs';

async function listen(server: http.Server | net.Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}

test('production web server serves only release assets and proxies the local API', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'reelori-web-'));
  const api = http.createServer((req, res) => {
    assert.equal(req.headers.host, `127.0.0.1:${apiPort}`);
    assert.equal(req.headers.origin, `http://127.0.0.1:${webPort}`);
    res.setHeader('Set-Cookie', 'drama_session=test; HttpOnly; SameSite=Strict; Path=/');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ path: req.url, method: req.method }));
  });
  let apiPort = 0, webPort = 0;
  let web: http.Server | undefined;
  try {
    await mkdir(path.join(root, 'assets'));
    await writeFile(path.join(root, 'index.html'), '<html>reelori</html>');
    await writeFile(path.join(root, 'assets', 'app.js'), 'console.log(1)');
    apiPort = await listen(api);
    const reserve = net.createServer();
    webPort = await listen(reserve);
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    web = createWebServer({ root, apiPort, webPort });
    await new Promise<void>((resolve) => web!.listen(webPort, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${webPort}`;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /reelori/);
    const asset = await fetch(base + '/assets/app.js');
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /console/);
    const hidden = await fetch(base + '/package.json');
    assert.equal(hidden.status, 404);
    const crossed = await fetch(base + '/api/session', {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(crossed.status, 403);
    const proxied = await fetch(base + '/api/session', {
      headers: { Origin: base },
    });
    assert.equal(proxied.status, 200);
    assert.match(proxied.headers.get('set-cookie') ?? '', /HttpOnly/);
    assert.deepEqual(await proxied.json(), { path: '/api/session', method: 'GET' });
  } finally {
    await new Promise<void>((resolve) => web?.close(() => resolve()) ?? resolve());
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
