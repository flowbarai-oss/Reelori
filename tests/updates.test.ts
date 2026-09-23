import test from 'node:test';
import assert from 'node:assert/strict';
import { checkForUpdate, newerVersion } from '../packages/core/updates.ts';

test('update comparison respects preview versions', () => {
  assert.equal(newerVersion('0.4.0-dev', 'v0.4.0-preview.1'), true);
  assert.equal(newerVersion('0.4.0-preview.2', 'v0.4.0-preview.1'), false);
  assert.equal(newerVersion('0.4.0', 'v0.4.0-rc.1'), false);
  assert.equal(newerVersion('0.4.0', 'arbitrary'), false);
});

test('update check accepts only a valid public release tag and constructs its own URL', async () => {
  const fake = async (_url: unknown, options: any) => {
    assert.equal(options.headers['User-Agent'], 'Reelori-local-update-check');
    return new Response(JSON.stringify({ tag_name: 'v0.4.0-preview.1', html_url: 'https://evil.example' }),
      { status: 200 });
  };
  const result = await checkForUpdate('0.4.0-dev', fake as typeof fetch);
  assert.equal(result.status, 'available');
  assert.equal(result.url, 'https://github.com/flowbarai-oss/Reelori/releases/tag/v0.4.0-preview.1');
  const missing = await checkForUpdate('0.4.0-dev', (async () => new Response('', { status: 404 })) as typeof fetch);
  assert.equal(missing.status, 'unpublished');
});
