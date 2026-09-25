const { app, BrowserWindow, dialog, Menu, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const root = process.env.REELORI_APP_ROOT || path.resolve(__dirname, '../../..');
const apiPort = 4312;
const webPort = 5179;
const origin = `http://127.0.0.1:${webPort}`;
const runtime = path.join(root, 'runtime', 'node.exe');
const bundledFfmpeg = path.join(root, 'vendor', 'ffmpeg', 'ffmpeg.exe');
const icon = path.join(root, 'Reelori.ico');
const children = [];
let window = null;

function occupied(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1500, () => { socket.destroy(); resolve(true); });
  });
}

function ready() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    function check() {
      if (children.some((child) => child.exitCode !== null || child.signalCode !== null))
        return reject(new Error('本机服务启动失败，请关闭其他 Reelori 窗口后重试。'));
      const request = http.get(`${origin}/api/session`, (response) => {
        response.resume();
        if (response.statusCode === 200) return resolve();
        retry();
      });
      request.on('error', retry);
      request.setTimeout(1500, () => request.destroy());
    }
    function retry() {
      if (Date.now() > deadline) return reject(new Error('本机服务启动超时。'));
      setTimeout(check, 250);
    }
    check();
  });
}

function allowedExternal(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      (url.hostname === 'flowbarai.com' ||
       url.hostname === 'gen.flowbarai.com' ||
       (url.hostname === 'github.com' &&
        (url.pathname === '/flowbarai-oss/Reelori' ||
         url.pathname.startsWith('/flowbarai-oss/Reelori/'))));
  } catch { return false; }
}

async function start() {
  if (!existsSync(bundledFfmpeg))
    throw new Error('安装包缺少 FFmpeg，请重新下载完整的 Reelori 安装包。');
  if (await occupied(apiPort) || await occupied(webPort) ||
      await occupied(4311) || await occupied(5178))
    throw new Error('已有 Reelori 本机服务或占用端口的程序在运行，请关闭后重试。');

  const local = process.env.LOCALAPPDATA || app.getPath('userData');
  const env = {
    ...process.env,
    REELORI_DATA_DIR: path.join(local, 'Reelori', 'data'),
    REELORI_WORKSPACE_SELECTION_FILE: path.join(local, 'Reelori', 'workspace-selection.json'),
    REELORI_PORT: String(apiPort),
    REELORI_WEB_PORT: String(webPort),
    REELORI_OPEN_BROWSER: '0',
    REELORI_FFMPEG: bundledFfmpeg,
  };
  children.push(spawn(runtime, ['apps/local-service/server.ts'],
    { cwd: root, env, windowsHide: true, stdio: 'ignore' }));
  children.push(spawn(runtime, ['scripts/serve-web.mjs'],
    { cwd: root, env, windowsHide: true, stdio: 'ignore' }));
  await ready();

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#111412',
    title: '幕芽 Reelori',
    icon,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  window.once('ready-to-show', () => window?.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(origin + '/')) return;
    event.preventDefault();
    if (allowedExternal(url)) void shell.openExternal(url);
  });
  await window.loadURL(origin);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
  });
  app.whenReady().then(start).catch((error) => {
    dialog.showErrorBox('幕芽 Reelori 无法启动', error.message);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) child.kill();
  });
}
