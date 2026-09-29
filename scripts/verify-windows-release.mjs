import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(root, 'packaging/windows/ffmpeg-lock.json'), 'utf8'));
const sourceDir = process.env.REELORI_FFMPEG_SOURCE_BUNDLE;
const signer = process.env.REELORI_SIGN_CERT_THUMBPRINT;
if (!sourceDir || !path.isAbsolute(sourceDir)) throw new Error('Absolute FFmpeg corresponding-source bundle path is required');
if (!signer || !/^[a-f0-9]{40,64}$/i.test(signer)) throw new Error('Pinned code-signing certificate thumbprint is required');
const inventory = JSON.parse(await readFile(path.join(sourceDir, 'inventory.json'), 'utf8'));
if (inventory.binaryArchiveSha256 !== lock.sha256 ||
    inventory.ffmpegSourceCommit !== lock.sourceCommit ||
    inventory.ffmpegCoreSourceSha256 !== lock.sourceSha256 ||
    !Array.isArray(inventory.externalLibraries) || inventory.externalLibraries.length < 40)
  throw new Error('FFmpeg source inventory does not match the bundled binary');
async function verifyMember(name, sha256) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(name) ||
      name.includes('..') || name.startsWith('/') ||
      typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256))
    throw new Error('Invalid source bundle member');
  const actual = createHash('sha256').update(await readFile(path.join(sourceDir, name))).digest('hex');
  if (actual !== sha256.toLowerCase()) throw new Error(`Source member hash mismatch: ${name}`);
}
async function requireTextMember(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(name) ||
      name.includes('..') || name.startsWith('/')) throw new Error('Invalid source documentation path');
  const value = await readFile(path.join(sourceDir, name), 'utf8');
  if (!value.trim()) throw new Error(`Empty source documentation: ${name}`);
}
await verifyMember(inventory.ffmpegCoreSourceArchive, inventory.ffmpegCoreSourceSha256);
for (const library of inventory.externalLibraries) {
  if (!library.sourceArchive || !library.sourceSha256 || !library.buildRecipe || !library.licenseText)
    throw new Error(`Incomplete corresponding source for ${library.name}`);
  await verifyMember(library.sourceArchive, library.sourceSha256);
  await requireTextMember(library.buildRecipe);
  await requireTextMember(library.licenseText);
}
if (inventory.readyForBinaryPublication !== true)
  throw new Error('Source bundle has not been marked reviewed for binary publication');
if (typeof inventory.reviewedBy !== 'string' || !inventory.reviewedBy.trim() ||
    typeof inventory.reviewedAt !== 'string' || !Number.isFinite(Date.parse(inventory.reviewedAt)) ||
    typeof inventory.buildInstructions !== 'string' || !inventory.buildInstructions.trim())
  throw new Error('Corresponding-source review and build instructions are missing');
await requireTextMember(inventory.buildInstructions);
const packageDir = path.join(root, 'dist', `reelori-${pkg.version}-win-x64`);
const metadata = JSON.parse(await readFile(path.join(packageDir, 'RELEASE-METADATA.json'), 'utf8'));
if (metadata.appVersion !== pkg.version || metadata.codeSigningThumbprint?.toLowerCase() !== signer.toLowerCase())
  throw new Error('Packaged desktop identity does not match the intended signed release');
const manifest = await readFile(path.join(packageDir, 'SHA256SUMS.txt'), 'utf8');
const desktopEntry = manifest.split(/\r?\n/).find((line) => line.endsWith('  desktop/Reelori.exe'));
if (!desktopEntry || !/^[a-f0-9]{64}  desktop\/Reelori\.exe$/.test(desktopEntry))
  throw new Error('Packaged desktop executable is absent from the manifest');
const desktop = path.join(packageDir, 'desktop/Reelori.exe');
const desktopHash = createHash('sha256').update(await readFile(desktop)).digest('hex');
if (desktopHash !== desktopEntry.slice(0, 64)) throw new Error('Packaged desktop executable hash mismatch');
const installer = path.join(root, 'dist/installers', `reelori-${pkg.version}-setup.exe`);
const hash = createHash('sha256').update(await readFile(installer)).digest('hex');
for (const [kind, artifact, sha256] of [
  ['Installer', installer, hash], ['Desktop executable', desktop, desktopHash],
]) {
  const signed = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(root, 'scripts/verify-windows-installer.ps1'),
    '-Installer', artifact, '-ExpectedSha256', sha256,
    '-TrustedThumbprint', signer, '-RequirePublicTrust',
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (signed.status !== 0) throw new Error(`${kind} signature gate failed:\n${signed.stdout}\n${signed.stderr}`);
}
console.log(JSON.stringify({ version: pkg.version, installerSha256: hash, signer, sourceBundle: sourceDir, status: 'release-gates-passed' }));
