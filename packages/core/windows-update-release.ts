import { newerVersion } from './updates.ts';

const releaseRoot = 'https://github.com/flowbarai-oss/Reelori/releases/download/';
const sha256 = /^sha256:([a-f0-9]{64})$/i;

type Asset = {
  name?: unknown;
  browser_download_url?: unknown;
  digest?: unknown;
  size?: unknown;
  state?: unknown;
};

export type WindowsReleasePlan = {
  version: string;
  tag: string;
  installerName: string;
  installerUrl: string;
  installerSha256: string;
  installerBytes: number;
  sourceName: string;
  sourceUrl: string;
  sourceSha256: string;
};

function assetNamed(assets: Asset[], tag: string, name: string) {
  const matches = assets.filter((item) => item?.name === name);
  if (matches.length !== 1) return null;
  const asset = matches[0];
  const digest = typeof asset.digest === 'string' ? sha256.exec(asset.digest) : null;
  const expectedUrl = `${releaseRoot}${tag}/${name}`;
  if (asset.state !== 'uploaded' || !digest ||
      asset.browser_download_url !== expectedUrl ||
      !Number.isSafeInteger(asset.size) || Number(asset.size) <= 0)
    return null;
  return { url: expectedUrl, hash: digest[1].toLowerCase(), bytes: Number(asset.size) };
}

export function selectWindowsRelease(current: string, ffmpegVersion: string, input: unknown): WindowsReleasePlan | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const release = input as Record<string, unknown>;
  const tag = release.tag_name;
  if (release.draft !== false || release.prerelease !== false ||
      typeof tag !== 'string' || !/^v?\d+\.\d+\.\d+$/.test(tag) ||
      !newerVersion(current, tag) || !/^\d+\.\d+\.\d+$/.test(ffmpegVersion) ||
      !Array.isArray(release.assets) || release.assets.length > 100)
    return null;
  const version = tag.replace(/^v/, '');
  const assets = release.assets as Asset[];
  const installerName = `reelori-${version}-setup.exe`;
  const sourceName = `ffmpeg-${ffmpegVersion}-corresponding-source.tar.gz`;
  const installer = assetNamed(assets, tag, installerName);
  const source = assetNamed(assets, tag, sourceName);
  if (!installer || !source || installer.bytes < 10_000_000 ||
      installer.bytes > 600_000_000 || source.bytes < 1_000_000 ||
      source.bytes > 2_000_000_000)
    return null;
  return {
    version, tag, installerName, installerUrl: installer.url,
    installerSha256: installer.hash, installerBytes: installer.bytes,
    sourceName, sourceUrl: source.url, sourceSha256: source.hash,
  };
}
