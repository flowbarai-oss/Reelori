import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(await readFile(path.join(root, 'packaging/windows/ffmpeg-lock.json'), 'utf8'));
const ffmpegDir = path.join(root, 'dist', `reelori-${JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version}-win-x64`, 'vendor', 'ffmpeg');
const readme = await readFile(path.join(ffmpegDir, 'UPSTREAM-README.txt'), 'utf8');
const archive = path.join(root, 'dist/vendor-cache', lock.archive);
const binaryHash = createHash('sha256').update(await readFile(archive)).digest('hex');
if (binaryHash !== lock.sha256 || !readme.includes(`Source Code: https://github.com/FFmpeg/FFmpeg/commit/${lock.sourceCommit}`))
  throw new Error('FFmpeg binary and source reference do not match the pinned archive');
const coreSource = path.join(root, 'dist/vendor-cache', lock.sourceArchive);
try { await access(coreSource); }
catch {
  const response = await fetch(lock.sourceUrl, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`FFmpeg core source download failed: ${response.status}`);
  await writeFile(coreSource, Buffer.from(await response.arrayBuffer()), { flag: 'wx' });
}
const sourceHash = createHash('sha256').update(await readFile(coreSource)).digest('hex');
if (sourceHash !== lock.sourceSha256) throw new Error('FFmpeg core source archive SHA-256 mismatch');
const list = readme.match(/External libraries:\s*([\s\S]*?)\r?\n\r?\nExternal libraries providing hardware acceleration:/);
if (!list) throw new Error('External library inventory is missing');
const libraries = [...new Set(list[1].trim().split(/\s+/))].sort();
const versions = readme.split("release-essentials external libraries' versions:")[1] ?? '';
const versionRows = versions.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const inventory = {
  binaryArchive: lock.archive,
  binaryArchiveSha256: lock.sha256,
  ffmpegSourceCommit: lock.sourceCommit,
  ffmpegSourceUrl: `https://github.com/FFmpeg/FFmpeg/commit/${lock.sourceCommit}`,
  ffmpegCoreSourceArchive: lock.sourceArchive,
  ffmpegCoreSourceSha256: sourceHash,
  buildConfiguration: 'UPSTREAM-README.txt in the pinned binary archive',
  externalLibraries: libraries.map((name) => ({ name, sourceArchive: null, sourceSha256: null, buildRecipe: null })),
  upstreamVersionRows: versionRows,
  readyForBinaryPublication: false,
  reason: 'The static binary includes external libraries; their exact corresponding sources and build recipes are not assembled.',
};
const output = path.join(root, 'dist', `ffmpeg-source-audit-${lock.version}`);
await mkdir(output, { recursive: true });
await cp(coreSource, path.join(output, lock.sourceArchive));
await writeFile(path.join(output, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
await writeFile(path.join(output, 'README.md'), [
  `# FFmpeg ${lock.version} source audit`,
  '',
  `Binary archive SHA-256: \`${lock.sha256}\`.`,
  `FFmpeg core source commit: \`${lock.sourceCommit}\`.`,
  `Verified FFmpeg core source archive SHA-256: \`${sourceHash}\`.`,
  `External libraries listed by the upstream build: ${libraries.length}.`,
  '',
  'This inventory is an audit worksheet, not a corresponding-source offer.',
  'The exact source archives, patches, build scripts, and license texts for every statically linked component must be collected and reviewed before publishing the installer.',
  'The release gate remains closed until a complete source bundle is shipped beside the binary and its checksums are verified.',
  '',
].join('\n'));
console.log(JSON.stringify({ output, externalLibraries: libraries.length, readyForBinaryPublication: false }));
