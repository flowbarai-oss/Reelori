import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const suffix = process.env.REELORI_PUBLIC_SUFFIX?.trim() ?? '';
if (suffix && !/^[a-z0-9-]{1,30}$/.test(suffix)) throw new Error('Invalid public snapshot suffix');
const destination = path.join(root, 'dist', `public-source${suffix ? '-' + suffix : ''}`);
try { await access(destination); throw new Error(`Public snapshot already exists: ${destination}`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const entries = [
  '.github', '.gitignore', '.dockerignore', 'Dockerfile', 'LICENSE',
  'SECURITY.md', 'CODE_OF_CONDUCT.md', 'CONTRIBUTING.md',
  'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', 'tsconfig.json',
  'apps/desktop', 'apps/local-service', 'apps/web/src', 'apps/web/worker', 'apps/web/tests',
  'apps/web/scripts', 'apps/web/vite.config.mjs', 'apps/web/package.json',
  'apps/web/index.html', 'apps/web/.openai/hosting.json', 'apps/web/.npmrc',
  'packages', 'public/assets', 'tests',
  'scripts/credentials.ps1', 'scripts/dev.mjs', 'scripts/extract-node.ps1',
  'scripts/extract-ffmpeg.ps1',
  'scripts/audit-ffmpeg-sources.mjs', 'scripts/verify-windows-release.mjs',
  'scripts/sign-windows-artifact.ps1', 'scripts/verify-windows-installer.ps1',
  'scripts/apply-windows-update.ps1',
  'scripts/package-windows.mjs', 'scripts/serve-web.mjs',
  'scripts/serve-web.d.mts', 'scripts/start.mjs', 'scripts/workspace-switch.mjs',
  'scripts/scan-secrets.mjs',
  'scripts/export-public.mjs',
  'scripts/build-installer.mjs', 'scripts/desktop-acceptance.mjs',
  'scripts/generate-reelori-icon.py', 'packaging/windows',
  'docs/FLOWBAR-SETUP.md', 'docs/design/ASSET-PROVENANCE.md',
  'docs/release/QUICKSTART.md', 'docs/release/README-public.md',
  'docs/release/FFMPEG-WINDOWS-20260925.md',
  'docs/release/WINDOWS-UPDATE-AND-SIGNING.md',
  'docs/release/FILM-CAPACITY-20260925.md',
  'docs/release/SERIES-SCENE-CAST-20260925.md',
  'docs/release/H3-REFERENCE-PREVIEW9-20260925.md',
  'docs/validation/H3-REFERENCE-IMAGE-LIVE-20260925.md',
];
await mkdir(destination, { recursive: true });
for (const relative of entries) {
  const source = path.join(root, relative);
  const target = path.join(destination, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, errorOnExist: true, force: false });
}
const guide = await readFile(path.join(root, 'docs/release/README-public.md'), 'utf8');
const readme = guide.replace(/\]\(([^)]+)\)/g, (link, target) => {
  if (/^(?:https?:|mailto:|#)/i.test(target)) return link;
  const resolved = path.resolve(root, 'docs/release', target);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Public README link escapes repository: ${target}`);
  }
  return `](${relative.split(path.sep).join('/')})`;
});
if (!readme.includes('local-first')) throw new Error('Public README validation failed');
await writeFile(path.join(destination, 'README.md'), readme);
console.log(`Public source snapshot: ${destination}`);
