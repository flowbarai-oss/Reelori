import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const nodeVersion = '24.21.0';
const archiveName = `node-v${nodeVersion}-win-x64.zip`;
const upstream = `https://nodejs.org/download/release/v${nodeVersion}`;
const cache = path.join(root, 'dist', 'vendor-cache');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const suffix = process.env.REELORI_PACKAGE_SUFFIX?.trim() ?? '';
if (suffix && !/^[a-z0-9-]{1,30}$/.test(suffix)) throw new Error('Invalid package suffix');
const output = path.join(root, 'dist', `reelori-${pkg.version}-win-x64${suffix ? '-' + suffix : ''}`);

async function download(url, file) {
  try { await access(file); return; } catch { /* fetch once */ }
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()), { flag: 'wx' });
}

await mkdir(cache, { recursive: true });
await download(`${upstream}/SHASUMS256.txt`, path.join(cache, 'SHASUMS256.txt'));
await download(`${upstream}/${archiveName}`, path.join(cache, archiveName));
const sums = await readFile(path.join(cache, 'SHASUMS256.txt'), 'utf8');
const match = sums.split(/\r?\n/).map((line) => line.match(/^([a-f0-9]{64})\s+(.+)$/))
  .find((row) => row?.[2] === archiveName);
if (!match) throw new Error('Official Node SHA-256 entry not found');
const bytes = await readFile(path.join(cache, archiveName));
const actual = createHash('sha256').update(bytes).digest('hex');
if (actual !== match[1]) throw new Error('Node archive SHA-256 mismatch');
const client = path.join(root, 'apps', 'web', 'dist', 'client', 'index.html');
await access(client); // npm run build must have completed first.
try { await access(output); throw new Error(`Release directory already exists: ${output}`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(path.join(output, 'runtime'), { recursive: true });
const extract = spawnSync('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', path.join(root, 'scripts', 'extract-node.ps1'),
  '-Archive', path.join(cache, archiveName),
  '-Destination', path.join(output, 'runtime'),
  '-Version', nodeVersion,
], { stdio: 'inherit' });
if (extract.status !== 0) throw new Error('Node runtime extraction failed');
for (const relative of ['apps/local-service', 'packages', 'apps/web/dist/client']) {
  await cp(path.join(root, relative), path.join(output, relative), { recursive: true });
}
await mkdir(path.join(output, 'scripts'), { recursive: true });
for (const name of ['start.mjs', 'serve-web.mjs', 'credentials.ps1'])
  await cp(path.join(root, 'scripts', name), path.join(output, 'scripts', name));
for (const name of ['LICENSE', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md'])
  await cp(path.join(root, name), path.join(output, name));
const bundledLicenses = [
  ['react', 'react'], ['react-dom', 'react-dom'], ['scheduler', 'scheduler'],
  ['@phosphor-icons/react', 'phosphor-icons-react'],
  ['@fontsource-variable/noto-sans-sc', 'noto-sans-sc'],
  ['@fontsource-variable/noto-serif-sc', 'noto-serif-sc'],
];
await mkdir(path.join(output, 'licenses', 'npm'), { recursive: true });
for (const [name, target] of bundledLicenses) {
  await cp(path.join(root, 'node_modules', ...name.split('/'), 'LICENSE'),
    path.join(output, 'licenses', 'npm', `${target}.txt`));
}
await cp(path.join(root, 'docs/release/README-public.md'), path.join(output, 'README.md'));
await mkdir(path.join(output, 'docs', 'release'), { recursive: true });
await cp(path.join(root, 'docs/release/QUICKSTART.md'), path.join(output, 'docs/release/QUICKSTART.md'));
await writeFile(path.join(output, 'package.json'), JSON.stringify({
  name: pkg.name, version: pkg.version, type: 'module', private: true,
}, null, 2) + '\n');
await writeFile(path.join(output, 'Start Reelori.cmd'), [
  '@echo off',
  'setlocal',
  'set "REELORI_DATA_DIR=%LOCALAPPDATA%\\Reelori\\data"',
  'set "REELORI_WORKSPACE_SELECTION_FILE=%LOCALAPPDATA%\\Reelori\\workspace-selection.json"',
  'set "REELORI_OPEN_BROWSER=1"',
  'cd /d "%~dp0"',
  '"%~dp0runtime\\node.exe" "%~dp0scripts\\start.mjs"',
  'exit /b %ERRORLEVEL%',
  '',
].join('\r\n'));
await writeFile(path.join(output, 'RELEASE-METADATA.json'), JSON.stringify({
  appVersion: pkg.version, nodeVersion, nodeArchive: archiveName,
  nodeArchiveSha256: actual, sourceCommit: process.env.REELORI_SOURCE_SHA ?? null,
  generatedAt: new Date().toISOString(),
}, null, 2) + '\n');
async function collectHashes(directory, prefix = '') {
  const { readdir } = await import('node:fs/promises');
  const items = await readdir(directory, { withFileTypes: true });
  const hashes = [];
  for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.posix.join(prefix, item.name);
    if (item.isDirectory()) hashes.push(...await collectHashes(path.join(directory, item.name), relative));
    else if (item.isFile() && relative !== 'SHA256SUMS.txt') {
      const digest = createHash('sha256').update(await readFile(path.join(directory, item.name))).digest('hex');
      hashes.push(`${digest}  ${relative}`);
    }
  }
  return hashes;
}
await writeFile(path.join(output, 'SHA256SUMS.txt'), (await collectHashes(output)).join('\n') + '\n');
console.log(`Windows portable directory: ${output}`);
