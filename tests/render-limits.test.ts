import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../packages/storage-local/store.ts";
import {
  confirmPreview,
  queueSample,
  tick,
  adopt,
} from "../packages/core/project.ts";
import { renderAnimatic } from "../packages/media/render.ts";
import { ffmpegPath, runFile } from "../packages/media/runtime.ts";
test("six silent shots render to thirty seconds, and missing renderer never leaves completed artifacts", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-render-limit-"));
  const store = new Store(":memory:");
  const old = process.env.REELORI_FFMPEG;
  try {
    const p = store.create({
      title: "Six shots",
      story: "1\n\n2\n\n3\n\n4\n\n5\n\n6",
    });
    confirmPreview(p, p.revision);
    queueSample(
      p,
      p.shots.map((s) => s.id),
      "limit-test",
      p.revision,
      100,
    );
    for (let n = 0; n < 7; n++) tick(p, 100 + n * 4000);
    for (const s of p.shots) adopt(p, s.id, s.candidates[0].id, p.revision);
    const output = await renderAnimatic(p, dir);
    const check = await runFile(
      ffmpegPath(),
      ["-hide_banner", "-i", output.file, "-f", "null", "-"],
      { windowsHide: true, timeout: 120000, maxBuffer: 2000000 },
    );
    assert.match(check.stderr, /00:00:30\.00/);
    assert.match(check.stderr, /1080x1920/);
    assert.doesNotMatch(check.stderr, /Audio:/);
    const before = readdirSync(dir).sort();
    process.env.REELORI_FFMPEG = path.join(dir, "missing-ffmpeg.exe");
    await assert.rejects(renderAnimatic(p, dir), /合成失败/);
    assert.deepEqual(readdirSync(dir).sort(), before);
  } finally {
    if (old === undefined) delete process.env.REELORI_FFMPEG;
    else process.env.REELORI_FFMPEG = old;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
