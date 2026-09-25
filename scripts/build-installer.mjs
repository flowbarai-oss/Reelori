import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+(?:-(?:dev|preview|rc)(?:\.\d+)?)?$/.test(version))
  throw new Error('Version is unsuitable for Windows installer');
const suffix = process.env.REELORI_PACKAGE_SUFFIX?.trim() ?? '';
if (suffix && !/^[a-z0-9-]{1,30}$/.test(suffix)) throw new Error('Invalid package suffix');
const packageDir = path.join(root, 'dist', `reelori-${version}-win-x64${suffix ? '-' + suffix : ''}`);
const sums = (await readFile(path.join(packageDir, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n');
const files = [];
for (const line of sums) {
  const match = /^([a-f0-9]{64})  ([A-Za-z0-9._ /-]+)$/.exec(line);
  if (!match || match[2].includes('..')) throw new Error('Invalid package manifest');
  const file = path.join(packageDir, ...match[2].split('/'));
  const actual = createHash('sha256').update(await readFile(file)).digest('hex');
  if (actual !== match[1]) throw new Error(`Package checksum mismatch: ${match[2]}`);
  files.push(match[2]);
}
if (!files.includes('runtime/node.exe') || !files.includes('desktop/Reelori.exe') ||
    !files.includes('Reelori.ico') || !files.includes('LICENSE') ||
    !files.includes('vendor/ffmpeg/ffmpeg.exe') ||
    !files.includes('vendor/ffmpeg/LICENSE') ||
    !files.includes('vendor/ffmpeg/UPSTREAM-README.txt'))
  throw new Error('Package is incomplete');
const outputDir = path.join(root, 'dist', 'installers');
await mkdir(outputDir, { recursive: true });
const folders = new Set();
for (const name of files) {
  let dir = path.posix.dirname(name);
  while (dir !== '.') { folders.add(dir); dir = path.posix.dirname(dir); }
}
const windowsPath = (value) => value.replaceAll('/', '\\');
const versionRoot = `$INSTDIR\\versions\\${version}`;
const uninstall = [
  ...files.map((name) => `Delete "${versionRoot}\\${windowsPath(name)}"`),
  `Delete "${versionRoot}\\SHA256SUMS.txt"`,
  ...[...folders].sort((a, b) => b.length - a.length)
    .map((name) => `RMDir "${versionRoot}\\${windowsPath(name)}"`),
].join('\r\n') + '\r\n';
const uninstallFile = path.join(outputDir, `uninstall-${version}.nsh`);
await writeFile(uninstallFile, uninstall);
const output = path.join(outputDir, `reelori-${version}-setup.exe`);
const compiler = process.env.REELORI_MAKENSIS ?? path.join(root, 'dist', 'tools', 'nsis', 'makensis.exe');
await access(compiler);
const result = spawnSync(compiler, [
  `/DAPP_VERSION=${version}`, `/DPACKAGE_DIR=${packageDir}`,
  `/DOUTPUT_FILE=${output}`, `/DUNINSTALL_FILES=${uninstallFile}`,
  path.join(root, 'packaging', 'windows', 'Reelori.nsi'),
], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
if (result.status !== 0) throw new Error(`Installer compile failed:\n${result.stdout}\n${result.stderr}`);
console.log(`Windows installer: ${output}`);
