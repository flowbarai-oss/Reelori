import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ffmpeg, ffmpegPath, runFile } from "../packages/media/runtime.ts";
import { saveVideo } from "../packages/media/video.ts";
import { Store } from "../packages/storage-local/store.ts";
import { adopt, manifest } from "../packages/core/project.ts";
import { renderAnimatic, listRenders } from "../packages/media/render.ts";
import {
  createBackup,
  restoreBackup,
} from "../packages/storage-local/backup.ts";
import { createDelivery } from "../packages/media/delivery.ts";
test("adopted provider video stays a video through rendering, backup restoration and delivery", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-video-"));
  const store = new Store(":memory:");
  try {
    const clip = path.join(dir, "fixture.mp4");
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=128x224:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-c:a",
      "aac",
      "-t",
      "4.8",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      clip,
    ]);
    const saved = await saveVideo(
      readFileSync(clip),
      path.join(dir, "assets"),
      5,
    );
    assert.ok(saved.seconds >= 4.75 && saved.seconds < 5);
    await assert.rejects(() =>
      saveVideo(readFileSync(clip), path.join(dir, "assets"), 10),
    );
    store.transact((p) => {
      p.shots = p.shots.slice(0, 2);
      p.shots[1].candidates.push({
        id: "still-two",
        image: p.shots[1].image,
        createdAt: Date.now(),
        inputRevision: 1,
        mode: "sample",
      });
      adopt(p, p.shots[1].id, "still-two", p.revision);
      p.shots[0].candidates.push({
        id: "video-one",
        image: saved.image,
        video: saved.video,
        createdAt: Date.now(),
        inputRevision: 1,
        mode: "provider",
      });
      adopt(p, p.shots[0].id, "video-one", p.revision);
    });
    assert.equal(manifest(store.get()).shots[0].source, saved.video);
    assert.equal(manifest(store.get()).mode, "mixed");
    assert.equal(manifest(store.get()).shots[0].provenance, "provider");
    assert.equal(manifest(store.get()).providerCost.currency, "USD");
    const archive = await createBackup(
      store,
      "sample",
      path.join(dir, "assets"),
    );
    const restored = await restoreBackup(
      store,
      archive,
      path.join(dir, "assets"),
    );
    assert.equal(restored.shots[0].candidates[0].video, saved.video);
    const rendered = await renderAnimatic(restored, path.join(dir, "exports"), {
      audioMode: "source",
      volume: 0.5,
    });
    const frozen = JSON.parse(
      readFileSync(path.join(dir, "exports", rendered.id + ".json"), "utf8"),
    );
    assert.equal(frozen.kind, "mixed-media-animatic");
    assert.equal(frozen.audio, "source");
    assert.equal(frozen.audioVolume, 0.5);
    const checked = await runFile(
      ffmpegPath(),
      ["-hide_banner", "-i", rendered.file, "-f", "null", "-"],
      { windowsHide: true, timeout: 120000, maxBuffer: 2000000 },
    );
    const counts = [...checked.stderr.matchAll(/frame=\s*(\d+)/g)];
    assert.match(checked.stderr, /Audio: aac/);
    assert.match(
      checked.stderr.split("Stream mapping:")[0],
      /1080x1920[^\r\n]* 24 fps,/,
    );
    assert.deepEqual(
      [
        Number(counts.at(-1)?.[1]),
        (await listRenders(path.join(dir, "exports"), restored.id)).length,
      ],
      [240, 1],
    );
    await createDelivery(
      rendered.id,
      restored.id,
      path.join(dir, "exports"),
      path.join(dir, "assets"),
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
