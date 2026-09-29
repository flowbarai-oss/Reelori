import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { open, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { selectWindowsRelease } from './windows-update-release.ts';
import type { WindowsReleasePlan } from './windows-update-release.ts';
import { newerVersion } from './updates.ts';

const releaseApi = 'https://api.github.com/repos/flowbarai-oss/Reelori/releases/latest';
const allowedAssetHosts = new Set([
  'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com',
]);
const maxReleaseBytes = 128 * 1024;
const maxInstallerBytes = 600_000_000;
const versionPattern = /^\d+\.\d+\.\d+(?:-(?:dev|preview|rc)(?:\.\d+)?)?$/;

type InstalledContext = {
  version: string;
  root: string;
  updates: string;
  signer: string;
  ffmpegVersion: string;
  verifier: string;
  helper: string;
};

async function* chunksOf(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return;
      yield chunk.value;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function installedWindowsUpdateContext(): Promise<InstalledContext | null> {
  if (process.platform !== 'win32' || process.env.REELORI_PACKAGED !== '1' ||
      !process.env.LOCALAPPDATA || !process.env.REELORI_APP_ROOT) return null;
  const program = path.join(process.env.LOCALAPPDATA, 'Programs', 'Reelori');
  let version: string;
  try { version = (await readFile(path.join(program, 'current.txt'), 'utf8')).trim(); }
  catch { return null; }
  if (!versionPattern.test(version)) return null;
  const root = path.join(program, 'versions', version);
  if (path.resolve(process.env.REELORI_APP_ROOT).toLowerCase() !== path.resolve(root).toLowerCase())
    return null;
  let metadata: Record<string, unknown>;
  try { metadata = JSON.parse(await readFile(path.join(root, 'RELEASE-METADATA.json'), 'utf8')); }
  catch { return null; }
  if (metadata.appVersion !== version ||
      typeof metadata.codeSigningThumbprint !== 'string' ||
      !/^[a-f0-9]{40,64}$/i.test(metadata.codeSigningThumbprint) ||
      typeof metadata.ffmpegVersion !== 'string' ||
      !/^\d+\.\d+\.\d+$/.test(metadata.ffmpegVersion)) return null;
  const verifier = path.join(root, 'scripts', 'verify-windows-installer.ps1');
  const helper = path.join(root, 'scripts', 'apply-windows-update.ps1');
  try { await stat(verifier); await stat(helper); }
  catch { return null; }
  return {
    version, root, updates: path.join(process.env.LOCALAPPDATA, 'Reelori', 'updates'),
    signer: metadata.codeSigningThumbprint, ffmpegVersion: metadata.ffmpegVersion,
    verifier, helper,
  };
}

async function limitedJson(response: Response) {
  if (!response.ok || !response.body) throw new Error('Official release metadata unavailable');
  const size = Number(response.headers.get('content-length') ?? 0);
  if (size > maxReleaseBytes) throw new Error('Official release metadata is too large');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of chunksOf(response.body)) {
    total += chunk.byteLength;
    if (total > maxReleaseBytes) throw new Error('Official release metadata is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function checkAssetUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password ||
      (url.port && url.port !== '443') || !allowedAssetHosts.has(url.hostname))
    throw new Error('Release asset redirected to an untrusted host');
  return url;
}

async function fetchAsset(url: string, fetcher: typeof fetch) {
  let next = checkAssetUrl(url);
  for (let index = 0; index < 6; index++) {
    const response = await fetcher(next, {
      redirect: 'manual', headers: { 'User-Agent': 'Reelori-signed-windows-updater' },
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Release asset redirect has no location');
      next = checkAssetUrl(new URL(location, next).toString());
      continue;
    }
    if (!response.ok || !response.body) throw new Error('Official installer download failed');
    return response;
  }
  throw new Error('Too many release asset redirects');
}

function verifySignedInstaller(context: InstalledContext, installer: string, sha256: string) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', context.verifier, '-Installer', installer,
    '-ExpectedSha256', sha256, '-TrustedThumbprint', context.signer,
    '-RequirePublicTrust',
  ], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 });
  if (result.status !== 0) throw new Error('Downloaded installer did not pass code-signature verification');
}

async function downloadInstaller(plan: WindowsReleasePlan, context: InstalledContext, fetcher: typeof fetch) {
  const final = path.join(context.updates,
    `reelori-${plan.version}-${plan.installerSha256.slice(0, 16)}-setup.exe`);
  try {
    const existing = await stat(final);
    if (existing.size === plan.installerBytes) {
      verifySignedInstaller(context, final, plan.installerSha256);
      return final;
    }
    throw new Error('Existing staged installer has unexpected size');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = path.join(context.updates, `.download-${randomUUID()}.exe`);
  const response = await fetchAsset(plan.installerUrl, fetcher);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > maxInstallerBytes || (contentLength && contentLength !== plan.installerBytes))
    throw new Error('Release installer download size changed');
  let handle;
  try {
    handle = await open(temporary, 'wx');
    const hash = createHash('sha256');
    let total = 0;
    for await (const chunk of chunksOf(response.body!)) {
      total += chunk.byteLength;
      if (total > maxInstallerBytes || total > plan.installerBytes)
        throw new Error('Release installer exceeded its declared size');
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        const written = await handle.write(chunk, offset, chunk.byteLength - offset);
        if (written.bytesWritten <= 0) throw new Error('Installer download write failed');
        offset += written.bytesWritten;
      }
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (total !== plan.installerBytes || hash.digest('hex') !== plan.installerSha256)
      throw new Error('Release installer SHA-256 or size mismatch');
    verifySignedInstaller(context, temporary, plan.installerSha256);
    await rename(temporary, final);
    return final;
  } finally {
    if (handle) await handle.close();
    await rm(temporary, { force: true });
  }
}

export async function stageOfficialWindowsUpdate(fetcher: typeof fetch = fetch) {
  const context = await installedWindowsUpdateContext();
  if (!context) throw new Error('Online installation requires a production-signed installed Reelori');
  const release = await fetcher(releaseApi, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Reelori-signed-windows-updater' },
    redirect: 'error', signal: AbortSignal.timeout(8000),
  });
  const plan = selectWindowsRelease(context.version, context.ffmpegVersion, await limitedJson(release));
  if (!plan) throw new Error('No eligible signed Windows release with corresponding FFmpeg source was found');
  await mkdir(context.updates, { recursive: true });
  const installer = await downloadInstaller(plan, context, fetcher);
  const pending = {
    from: context.version, to: plan.version, installer, sha256: plan.installerSha256,
    signer: context.signer, sourceUrl: plan.sourceUrl, sourceSha256: plan.sourceSha256,
    preparedAt: new Date().toISOString(),
  };
  await writeFile(path.join(context.updates, 'pending-update.json'), JSON.stringify(pending, null, 2) + '\n', { flag: 'w' });
  return { version: plan.version, sourceUrl: plan.sourceUrl, sha256: plan.installerSha256 };
}

export async function launchStagedWindowsUpdate() {
  const context = await installedWindowsUpdateContext();
  const desktopPid = Number(process.env.REELORI_DESKTOP_PID);
  if (!context || !Number.isSafeInteger(desktopPid) || desktopPid <= 0 ||
      !process.connected || !process.send)
    throw new Error('Online installation requires a production-signed desktop session');
  const pending = JSON.parse(await readFile(path.join(context.updates, 'pending-update.json'), 'utf8')) as Record<string, unknown>;
  if (pending.from !== context.version || typeof pending.to !== 'string' ||
      !versionPattern.test(pending.to) || !newerVersion(context.version, pending.to) ||
      typeof pending.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(pending.sha256) ||
      pending.signer !== context.signer || typeof pending.installer !== 'string')
    throw new Error('Prepared update no longer matches this installation');
  const installer = path.resolve(pending.installer);
  if (!installer.toLowerCase().startsWith(path.resolve(context.updates).toLowerCase() + path.sep) ||
      path.basename(installer) !== `reelori-${pending.to}-${pending.sha256.slice(0, 16)}-setup.exe`)
    throw new Error('Prepared update installer path is invalid');
  verifySignedInstaller(context, installer, pending.sha256);
  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', context.helper, '-Installer', installer, '-ExpectedSha256', pending.sha256,
    '-TrustedThumbprint', context.signer, '-Version', pending.to,
    '-WaitProcessId', String(desktopPid),
  ], { detached: true, windowsHide: true, stdio: 'ignore' });
  child.once('error', () => { /* prevent an unhandled late spawn error */ });
  if (!child.pid) throw new Error('Could not start the Windows update worker');
  child.unref();
  return { version: pending.to, desktopPid };
}
