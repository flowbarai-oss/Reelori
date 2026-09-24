// Run against a locally launched desktop candidate with --remote-debugging-port=9229.
// Exercises the packaged renderer without changing project data.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pages = await fetch('http://127.0.0.1:9229/json').then((response) => response.json());
const target = pages.find((page) => page.type === 'page' && page.url.startsWith('http://127.0.0.1:5179/'));
assert.ok(target, 'Packaged Reelori window is not open');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(check, label) {
  for (let i = 0; i < 40; i++) {
    if (await evaluate(check)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const state = await evaluate('({ hash: location.hash, text: document.body.innerText.slice(0, 240) })');
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}`);
}
try {
  await send('Page.enable');
  await send('Runtime.enable');
  await waitFor('document.readyState === "complete"', 'document');
  await evaluate('location.hash = ""');
  await waitFor(`[...document.querySelectorAll('button')]
    .some((button) => button.textContent.includes('开始我的故事'))`, 'home page');
  await evaluate('localStorage.setItem("reelori-project", "deleted-old-workspace-project")');
  await send('Page.reload', { ignoreCache: true });
  await waitFor('localStorage.getItem("reelori-project") === "sample"', 'stale project recovery');
  const startup = await evaluate(`({
    title: document.title,
    savedId: localStorage.getItem('reelori-project'),
    error: document.body.innerText.includes('项目不存在'),
    startButtonDisabled: [...document.querySelectorAll('button')]
      .find((button) => button.textContent.includes('开始我的故事'))?.disabled ?? null
  })`);
  assert.equal(startup.savedId, 'sample');
  assert.equal(startup.error, false);
  assert.equal(startup.startButtonDisabled, false);
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((item) => item.textContent.trim() === '进入工作台');
    if (!button) return { found: false };
    const before = location.hash;
    button.click();
    return { found: true, disabled: button.disabled, before, after: location.hash, html: button.outerHTML };
  })()`);
  assert.equal(clicked.found, true, 'Open studio button is missing');
  assert.equal(clicked.disabled, false, 'Open studio button is disabled');
  await waitFor('location.hash === "#storyboard"', 'storyboard navigation');
  const storyboard = await evaluate(`({
    hash: location.hash,
    hasProjectError: document.body.innerText.includes('项目不存在'),
    hasStoryboard: document.body.innerText.includes('分镜工作台'),
    brandWidth: document.querySelector('.sidebar .brand-mark')?.getBoundingClientRect().width
  })`);
  assert.equal(storyboard.hasProjectError, false);
  assert.equal(storyboard.hasStoryboard, true);
  assert.equal(storyboard.brandWidth, 29);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshot = path.join(root, 'dist', 'desktop-acceptance.png');
  await writeFile(screenshot, Buffer.from(shot.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
  });
  const mobile = await evaluate(`({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    brandWidth: document.querySelector('.sidebar .brand-mark')?.getBoundingClientRect().width
  })`);
  assert.equal(mobile.width, 390);
  assert.ok([0, 29].includes(mobile.brandWidth), 'Unexpected mobile logo size');
  assert.ok(mobile.scrollWidth <= 390, 'Mobile page overflows horizontally');
  await evaluate(`document.querySelector('button[aria-label="切换语言"]').click()`);
  await waitFor('document.documentElement.lang === "en"', 'English UI');
  const english = await evaluate(`({ lang: document.documentElement.lang,
    hasStoryboard: document.body.innerText.includes('Storyboard') })`);
  assert.equal(english.hasStoryboard, true);
  const mobileShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const mobileScreenshot = path.join(root, 'dist', 'desktop-acceptance-mobile.png');
  await writeFile(mobileScreenshot, Buffer.from(mobileShot.data, 'base64'));
  await evaluate(`document.querySelector('button[aria-label="Switch language"]').click()`);
  await send('Emulation.clearDeviceMetricsOverride');
  console.log(JSON.stringify({ startup, storyboard, screenshot, mobile, english, mobileScreenshot }, null, 2));
} finally {
  socket.close();
}
