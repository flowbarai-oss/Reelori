import { spawn } from 'node:child_process';
import http from 'node:http';

const webPort = Number(process.env.REELORI_WEB_PORT ?? 5178);
const apiPort = Number(process.env.REELORI_PORT ?? 4311);
if (![webPort, apiPort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535))
  throw new Error('Invalid local port');

const children = [
  spawn(process.execPath, ['apps/local-service/server.ts'], { stdio: 'inherit' }),
  spawn(process.execPath, ['scripts/serve-web.mjs'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 500);
}
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', (code) => { if (!stopping) stop(code ?? 1); });
}
if (process.env.REELORI_OPEN_BROWSER === '1' && process.platform === 'win32') {
  let attempts = 0;
  const ready = setInterval(() => {
    if (stopping || ++attempts > 40) return clearInterval(ready);
    const request = http.get(`http://127.0.0.1:${webPort}/api/session`, (response) => {
      response.resume();
      if (response.statusCode !== 200) return;
      clearInterval(ready);
      const opener = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Start-Process 'http://127.0.0.1:${webPort}/'`,
      ], { stdio: 'ignore', windowsHide: true });
      opener.unref();
    });
    request.on('error', () => {});
    request.setTimeout(1000, () => request.destroy());
  }, 500);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
