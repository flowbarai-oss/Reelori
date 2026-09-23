import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../packages/storage-local/store.ts";
import { createApi } from "../apps/local-service/server.ts";
import { client } from "./http-helper.ts";
import {
  confirmPreview,
  queueSample,
  tick,
  adopt,
} from "../packages/core/project.ts";
import { ffmpegPath, runFile } from "../packages/media/runtime.ts";
test("render produces a decodable portrait MP4, timed bilingual subtitles and an immutable manifest", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-render-"));
  const store = new Store(":memory:");
  store.transact((p) => {
    p.shots[0].dialogue = "明天见。 See you tomorrow.";
    confirmPreview(p, p.revision);
    queueSample(
      p,
      p.shots.map((s) => s.id),
      "render-test",
      p.revision,
      100,
    );
    for (const time of [100, 4000, 8000, 12000]) tick(p, time);
    for (const s of p.shots) adopt(p, s.id, s.candidates[0].id, p.revision);
  });
  const server = createApi(store, 4311, 5178, dir);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const request = client(server);
  try {
    await request("/api/session");
    const result = await request("/api/render", {
      revision: store.get().revision,
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const history = await request("/api/exports");
    assert.equal(history.status, 200);
    assert.equal(history.data.outputs[0].id, result.data.id);
    const other = store.create({
      title: "Another project",
      story: "No exports",
    });
    assert.equal(
      (await request(`/api/exports?projectId=${other.id}`)).data.outputs.length,
      0,
    );
    assert.ok(existsSync(result.data.file));
    const mp4 = await request(result.data.download);
    assert.equal(mp4.headers["content-type"], "video/mp4");
    assert.ok(mp4.bytes.length > 10000);
    const checked = await runFile(
      ffmpegPath(),
      ["-hide_banner", "-i", result.data.file, "-f", "null", "-"],
      { windowsHide: true, timeout: 120000, maxBuffer: 2000000 },
    );
    assert.match(checked.stderr, /1080x1920/);
    assert.match(checked.stderr, /00:00:15\.00/);
    assert.match(checked.stderr, /mov_text/);
    const srt = await request(result.data.subtitles);
    assert.match(
      srt.bytes.toString(),
      /00:00:00,000 --> 00:00:05,000\n明天见。 See you tomorrow\./,
    );
    const output = JSON.parse(readFileSync(result.data.manifestFile, "utf8"));
    assert.equal(output.kind, "still-image-animatic");
    assert.equal(output.audio, "none");
    assert.equal(output.files.length, 3);
    assert.equal(output.projectId, "sample");
    assert.equal(output.verification.frames,360);
    const originalSrt=srt.bytes.toString();
    const edit=await request('/api/subtitles',{revision:store.get().revision,cues:[{startMs:250,endMs:2250,text:'修正字幕。 Edited subtitle.'}]});
    assert.equal(edit.status,200);assert.equal(store.get().shots[0].dialogue,'明天见。 See you tomorrow.');
    const revised=await request('/api/render',{revision:store.get().revision});assert.equal(revised.status,200,JSON.stringify(revised.data));
    assert.match((await request(revised.data.subtitles)).bytes.toString(),/00:00:00,250 --> 00:00:02,250\n修正字幕。 Edited subtitle\./);
    assert.equal((await request(result.data.subtitles)).bytes.toString(),originalSrt);
    assert.equal(revised.data.subtitleRevision,1);
    store.transact((p) => {
      p.title = "changed";
      p.revision++;
    });
    assert.notEqual(
      JSON.parse(readFileSync(result.data.manifestFile, "utf8")).project,
      "changed",
    );
    assert.equal(
      (await request("/api/download?id=../../private&format=mp4")).status,
      400,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
