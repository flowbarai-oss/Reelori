import assert from 'node:assert/strict';
import test from 'node:test';
import { selectWindowsRelease } from '../packages/core/windows-update-release.ts';

const hash = 'a'.repeat(64);
function release() {
  const tag = 'v0.4.0';
  const root = `https://github.com/flowbarai-oss/Reelori/releases/download/${tag}/`;
  return {
    tag_name: tag, draft: false, prerelease: false,
    assets: [
      { name: 'reelori-0.4.0-setup.exe', browser_download_url: root + 'reelori-0.4.0-setup.exe',
        digest: `sha256:${hash}`, size: 180_000_000, state: 'uploaded' },
      { name: 'ffmpeg-9.0.2-corresponding-source.tar.gz', browser_download_url: root + 'ffmpeg-9.0.2-corresponding-source.tar.gz',
        digest: `sha256:${hash}`, size: 70_000_000, state: 'uploaded' },
    ],
  };
}

test('online Windows update needs the exact official installer and GPL source assets', () => {
  const input = release();
  const plan = selectWindowsRelease('0.4.0-preview.14', '9.0.2', input);
  assert.equal(plan?.version, '0.4.0');
  assert.equal(plan?.installerSha256, hash);
  assert.equal(plan?.sourceSha256, hash);
  assert.equal(selectWindowsRelease('0.4.0', '9.0.2', input), null);
  input.assets.pop();
  assert.equal(selectWindowsRelease('0.4.0-preview.14', '9.0.2', input), null);
});

test('online Windows update rejects substituted URLs, missing digests and previews', () => {
  const input = release();
  input.assets[0].browser_download_url = 'https://example.invalid/reelori.exe';
  assert.equal(selectWindowsRelease('0.4.0-preview.14', '9.0.2', input), null);
  input.assets[0].browser_download_url = 'https://github.com/flowbarai-oss/Reelori/releases/download/v0.4.0/reelori-0.4.0-setup.exe';
  input.assets[0].digest = '';
  assert.equal(selectWindowsRelease('0.4.0-preview.14', '9.0.2', input), null);
  input.assets[0].digest = `sha256:${hash}`;
  input.prerelease = true;
  assert.equal(selectWindowsRelease('0.4.0-preview.14', '9.0.2', input), null);
  input.prerelease = false;
  input.assets.push({ ...input.assets[0] });
  assert.equal(selectWindowsRelease('0.4.0-preview.14', '9.0.2', input), null);
  input.assets.pop();
  input.assets[0].size = 700_000_000;
  assert.equal(selectWindowsRelease('0.4.0-preview.14', '9.0.2', input), null);
});
