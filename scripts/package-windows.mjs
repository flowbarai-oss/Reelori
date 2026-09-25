import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, access, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const nodeVersion = '24.21.0';
const archiveName = `node-v${nodeVersion}-win-x64.zip`;
const upstream = `https://nodejs.org/download/release/v${nodeVersion}`;
const cache = path.join(root, 'dist', 'vendor-cache');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const ffmpegLock = JSON.parse(await readFile(path.join(root, 'packaging', 'windows', 'ffmpeg-lock.json'), 'utf8'));
if (!/^9\.0\.2$/.test(ffmpegLock.version) ||
    !/^[a-f0-9]{64}$/.test(ffmpegLock.sha256) ||
    ffmpegLock.archive !== 'ffmpeg-9.0.2-essentials_build.zip' ||
    ffmpegLock.url !== 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip' ||
    ffmpegLock.license !== 'GPL-3.0-or-later')
  throw new Error('Invalid pinned FFmpeg build');
const electronVersion = pkg.devDependencies.electron;
if (!/^\d+\.\d+\.\d+$/.test(electronVersion)) throw new Error('Electron version must be pinned');
const suffix = process.env.REELORI_PACKAGE_SUFFIX?.trim() ?? '';
if (suffix && !/^[a-z0-9-]{1,30}$/.test(suffix)) throw new Error('Invalid package suffix');
const output = path.join(root, 'dist', `reelori-${pkg.version}-win-x64${suffix ? '-' + suffix : ''}`);

async function download(url, file, timeoutMs = 180000) {
  try { await access(file); return; } catch { /* fetch once */ }
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
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
const ffmpegArchivePath = path.join(cache, ffmpegLock.archive);
await download(ffmpegLock.url, ffmpegArchivePath, 20 * 60 * 1000);
const ffmpegArchiveHash = createHash('sha256')
  .update(await readFile(ffmpegArchivePath)).digest('hex');
if (ffmpegArchiveHash !== ffmpegLock.sha256)
  throw new Error('Pinned FFmpeg archive SHA-256 mismatch');
const client = path.join(root, 'apps', 'web', 'dist', 'client', 'index.html');
await access(client); // npm run build must have completed first.
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
await access(path.join(electronDist, 'electron.exe'));
const installedElectronVersion = (await readFile(path.join(electronDist, 'version'), 'utf8')).trim().replace(/^v/, '');
if (installedElectronVersion !== electronVersion) throw new Error('Electron runtime version mismatch');
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
const ffmpegDir = path.join(output, 'vendor', 'ffmpeg');
const ffmpegExtract = spawnSync('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', path.join(root, 'scripts', 'extract-ffmpeg.ps1'),
  '-Archive', ffmpegArchivePath, '-Destination', ffmpegDir,
], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
if (ffmpegExtract.status !== 0)
  throw new Error('FFmpeg extraction failed: ' + ffmpegExtract.stdout + ffmpegExtract.stderr);
const ffmpegExecutable = path.join(ffmpegDir, 'ffmpeg.exe');
const ffmpegVersion = spawnSync(ffmpegExecutable, ['-version'],
  { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
if (ffmpegVersion.status !== 0 ||
    !ffmpegVersion.stdout.includes('ffmpeg version 9.0.2-essentials_build') ||
    !ffmpegVersion.stdout.includes('--enable-libx264') ||
    !ffmpegVersion.stdout.includes('--enable-gpl') ||
    !ffmpegVersion.stdout.includes('--enable-version3') ||
    ffmpegVersion.stdout.includes('--enable-nonfree'))
  throw new Error('Pinned FFmpeg build or license configuration is unexpected');
await writeFile(path.join(ffmpegDir, 'SOURCE-PROVENANCE.txt'), [
  'FFmpeg binary source: ' + ffmpegLock.url,
  'Archive SHA-256: ' + ffmpegArchiveHash,
  'FFmpeg source commit: https://github.com/FFmpeg/FFmpeg/commit/' + ffmpegLock.sourceCommit,
  'Build information: ' + ffmpegLock.buildPage,
  'License: ' + ffmpegLock.license,
  'Upstream build configuration and external library versions: UPSTREAM-README.txt',
  'Public binary release requires a corresponding source bundle and license review.',
  '',
].join('\n'));
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
await cp(electronDist, path.join(output, 'desktop'), { recursive: true });
await rename(path.join(output, 'desktop', 'electron.exe'), path.join(output, 'desktop', 'Reelori.exe'));
await mkdir(path.join(output, 'desktop', 'resources', 'app'), { recursive: true });
await cp(path.join(root, 'apps', 'desktop', 'main.cjs'), path.join(output, 'desktop', 'resources', 'app', 'main.cjs'));
await writeFile(path.join(output, 'desktop', 'resources', 'app', 'package.json'), JSON.stringify({
  name: 'reelori-desktop', productName: '幕芽 Reelori', version: pkg.version, main: 'main.cjs',
}, null, 2) + '\n');
await cp(path.join(root, 'packaging', 'windows', 'Reelori.ico'), path.join(output, 'Reelori.ico'));
await writeFile(path.join(output, 'package.json'), JSON.stringify({
  name: pkg.name, version: pkg.version, type: 'module', private: true,
}, null, 2) + '\n');
await writeFile(path.join(output, 'Start Reelori.cmd'), [
  '@echo off',
  'setlocal',
  'cd /d "%~dp0"',
  '"%~dp0desktop\\Reelori.exe"',
  'exit /b %ERRORLEVEL%',
  '',
].join('\r\n'));
await writeFile(path.join(output, 'RELEASE-METADATA.json'), JSON.stringify({
  appVersion: pkg.version, nodeVersion, electronVersion, nodeArchive: archiveName,
  nodeArchiveSha256: actual, sourceCommit: process.env.REELORI_SOURCE_SHA ?? null,
  ffmpegVersion: ffmpegLock.version, ffmpegLicense: ffmpegLock.license,
  ffmpegArchiveSha256: ffmpegArchiveHash,
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
