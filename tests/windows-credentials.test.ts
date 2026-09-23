import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

test('Windows credentials are encrypted for the current user and can be removed',
  { skip: process.platform !== 'win32' }, () => {
    const home = mkdtempSync(path.join(tmpdir(), 'reelori-dpapi-'));
    const script = fileURLToPath(new URL('../scripts/credentials.ps1', import.meta.url));
    const sample = 'example-only-not-a-real-key-123456';
    const run = (action: string, input?: string) => spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Action', action, '-Provider', 'flowbar',
    ], { env: { ...process.env, LOCALAPPDATA: home }, input, encoding: 'utf8', windowsHide: true });
    try {
      const stored = run('set-stdin', sample);
      assert.equal(stored.status, 0, stored.stderr);
      const file = path.join(home, 'Reelori', 'credentials', 'flowbar.dpapi');
      assert.equal(readFileSync(file).includes(Buffer.from(sample)), false);
      assert.equal(run('status').stdout, 'configured');
      assert.equal(run('get').stdout, sample);
      assert.equal(run('remove').status, 0);
      assert.equal(run('status').stdout, 'missing');
    } finally {
      assert.ok(path.resolve(home).startsWith(path.resolve(tmpdir()) + path.sep));
      assert.match(path.basename(home), /^reelori-dpapi-/);
      rmSync(home, { recursive: true, force: true });
    }
  });
