import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../packages/storage-local/store.ts";
import { adopt, confirmPreview, queueSample, tick, updateShot } from "../packages/core/project.ts";
import { setSubtitles } from "../packages/core/subtitles.ts";
import { addAudioTrack } from "../packages/core/audio.ts";
import { validateProject } from "../packages/storage-local/validate-project.ts";
import { renderAnimatic } from "../packages/media/render.ts";
import { saveAudio } from "../packages/media/audio.ts";
import { saveVideo } from "../packages/media/video.ts";
import { createDelivery } from "../packages/media/delivery.ts";
import * as backup from "../packages/storage-local/backup.ts";
import { ffmpeg, ffmpegPath, runFile } from "../packages/media/runtime.ts";

function eightShotProject(store: Store) {
  const p = store.create({
    title: "Eight-scene film",
    story: Array.from({ length: 8 }, (_, index) => `Scene ${index + 1}`).join("\n\n"),
  });
  assert.equal(p.shots.length, 8);
  for (const [index, shot] of p.shots.entries())
    updateShot(p, shot.id, { seconds: index < 4 ? 7 : 8 }, p.revision);
  assert.equal(p.shots.reduce((seconds, shot) => seconds + shot.seconds, 0), 60);
  return p;
}

test("eight shots accept a 60-second timeline, late subtitles and twelve voices while rejecting overflow", () => {
  const store = new Store(":memory:");
  try {
    const p = eightShotProject(store);
    setSubtitles(p, [{ startMs: 59000, endMs: 60000, text: "Final line" }], p.revision);
    const audio = "/api/assets/" + "a".repeat(64) + ".wav";
    for (let index = 0; index < 12; index++)
      addAudioTrack(p, {
        name: `Voice ${index + 1}`, audio, durationMs: 1000,
        offsetMs: index * 5000, volume: 70, kind: "dialogue", rights: "owned",
      }, p.revision);
    validateProject(p);
    assert.equal(p.audioTracks?.length, 12);
    assert.throws(() => addAudioTrack(p, {
      name: "Overflow", audio, durationMs: 1000, offsetMs: 0,
      volume: 70, kind: "dialogue", rights: "owned",
    }, p.revision));
    assert.throws(() => updateShot(p, p.shots[0].id, { seconds: 8 }, p.revision));
    assert.throws(() => validateProject({ ...p, shots: [...p.shots, p.shots[0]] }));
  } finally { store.close(); }
});

test("eight adopted shots render a decodable 60-second film with late subtitles and full-length music", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-film-60-"));
  const store = new Store(":memory:");
  try {
    const p = eightShotProject(store);
    setSubtitles(p, [{ startMs: 59000, endMs: 60000, text: "Final line" }], p.revision);
    confirmPreview(p, p.revision);
    queueSample(p, p.shots.map((shot) => shot.id), "sixty-second-test", p.revision, 100);
    for (let index = 0; index < 9; index++) tick(p, 100 + index * 4000);
    for (const shot of p.shots) adopt(p, shot.id, shot.candidates[0].id, p.revision);
    const source = path.join(dir, "music.mp3");
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=220:duration=60",
      "-c:a", "libmp3lame", "-b:a", "96k", "-y", source]);
    const music = await saveAudio(readFileSync(source), path.join(dir, "assets"));
    assert.equal(music.durationMs, 60000);
    addAudioTrack(p, { ...music, name: "Full-film music", kind: "music", rights: "owned",
      offsetMs: 0, volume: 25 }, p.revision);
    const output = await renderAnimatic(p, path.join(dir, "exports"), { audioMode: "mix" });
    const checked = await runFile(ffmpegPath(), ["-hide_banner", "-i", output.file, "-f", "null", "-"],
      { windowsHide: true, timeout: 180000, maxBuffer: 2000000 });
    assert.match(checked.stderr, /Duration: 00:01:00\.00/);
    assert.match(checked.stderr, /1080x1920/);
    assert.match(checked.stderr, /Audio:/);
    assert.match(readFileSync(path.join(dir, "exports", `${output.id}.srt`), "utf8"), /Final line/);
    const snapshot = JSON.parse(readFileSync(output.manifestFile, "utf8"));
    assert.equal(snapshot.shots.length, 8);
    assert.equal(snapshot.durationSeconds, 60);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("eight video shots, twelve voices, music and effect produce a 60-second delivery", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-video-film-60-"));
  const store = new Store(":memory:");
  try {
    const p = eightShotProject(store);
    const assets = path.join(dir, "assets");
    const sourceSize = process.env.REELORI_CAPACITY_SOURCE_SIZE === "1920x1080"
      ? "1920x1080" : "320x568";
    for (const [index, shot] of p.shots.entries()) {
      const source = path.join(dir, `shot-${index}.mp4`);
      await ffmpeg(["-f", "lavfi", "-i", `testsrc2=size=${sourceSize}:rate=24,hue=h=${index * 30}`,
        "-t", String(shot.seconds), "-c:v", "libx264", "-threads", "1", "-y", source]);
      const saved = await saveVideo(readFileSync(source), assets, shot.seconds);
      const candidateId = `candidate-${index}`;
      shot.candidates.push({ id: candidateId, image: saved.image, video: saved.video,
        createdAt: Date.now(), inputRevision: shot.revision, mode: "provider" });
      adopt(p, shot.id, candidateId, p.revision);
    }
    const voiceFile = path.join(dir, "voice.wav");
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-y", voiceFile]);
    const voice = await saveAudio(readFileSync(voiceFile), assets);
    for (let index = 0; index < 12; index++)
      addAudioTrack(p, { ...voice, name: `Voice ${index + 1}`, kind: "dialogue",
        rights: "owned", offsetMs: index * 5000, volume: 30 }, p.revision);
    const musicFile = path.join(dir, "music.mp3");
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=220:duration=60",
      "-c:a", "libmp3lame", "-b:a", "96k", "-y", musicFile]);
    const music = await saveAudio(readFileSync(musicFile), assets);
    addAudioTrack(p, { ...music, name: "Music", kind: "music", rights: "owned",
      offsetMs: 0, volume: 10 }, p.revision);
    addAudioTrack(p, { ...voice, name: "Effect", kind: "effect", rights: "owned",
      offsetMs: 58000, volume: 20 }, p.revision);
    setSubtitles(p, [{ startMs: 59000, endMs: 60000, text: "The end" }], p.revision);
    const exports = path.join(dir, "exports");
    const output = await renderAnimatic(p, exports, { audioMode: "mix" });
    const delivery = await createDelivery(output.id, p.id, exports, assets);
    const snapshot = JSON.parse(readFileSync(output.manifestFile, "utf8"));
    assert.equal(snapshot.durationSeconds, 60);
    assert.equal(snapshot.shots.length, 8);
    assert.equal(snapshot.audioTracks.length, 14);
    assert.ok(readFileSync(delivery.file).length > 1000);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a 60-second music track survives project backup and restore", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-music-backup-60-"));
  const sourceStore = new Store(":memory:");
  const restoredStore = new Store(":memory:");
  try {
    const project = sourceStore.create({ title: "Music backup",
      story: Array.from({ length: 8 }, (_, index) => `Scene ${index + 1}`).join("\n\n") });
    const mp3 = path.join(dir, "music.mp3");
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=220:duration=60",
      "-c:a", "libmp3lame", "-b:a", "96k", "-y", mp3]);
    const assets = path.join(dir, "source-assets");
    const music = await saveAudio(readFileSync(mp3), assets);
    sourceStore.transact((p) => {
      for (const [index, shot] of p.shots.entries())
        updateShot(p, shot.id, { seconds: index < 4 ? 7 : 8 }, p.revision);
      addAudioTrack(p, { ...music, name: "60-second score", kind: "music",
        rights: "owned", offsetMs: 0, volume: 20 }, p.revision);
    }, project.id);
    const archive = await backup.createBackup(sourceStore, project.id, assets);
    const restoredAssets = path.join(dir, "restored-assets");
    const restored = await backup.restoreBackup(restoredStore, archive, restoredAssets);
    assert.equal(restored.shots.length, 8);
    assert.equal(restored.audioTracks?.[0].durationMs, 60000);
    assert.ok(readFileSync(path.join(restoredAssets,
      restored.audioTracks![0].audio.split("/").at(-1)!)).length > 11000000);
  } finally {
    sourceStore.close();
    restoredStore.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
