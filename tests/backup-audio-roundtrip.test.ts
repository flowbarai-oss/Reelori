import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Store } from "../packages/storage-local/store.ts";
import { seedProject, confirmPreview, adopt } from "../packages/core/project.ts";
import { addAudioTrack } from "../packages/core/audio.ts";
import { saveAudio } from "../packages/media/audio.ts";
import { saveVideo } from "../packages/media/video.ts";
import { ffmpeg, ffmpegPath, runFile } from "../packages/media/runtime.ts";
import { renderAnimatic } from "../packages/media/render.ts";
import * as backup from "../packages/storage-local/backup.ts";

// P3 第 5 点：走完整链路——含声音的真实工作流 → 备份（离线 SHA 校验） → 恢复为新项目 →
// 核对采用版本/音轨 → 再导出。此前 backup.test.ts 只测到 restoreBackup 这一步，没有验证
// "恢复后还能不能正常再导出一次"，也没有覆盖音频。本文件补这两块，并顺带验证了过程中发现
// 的一个真实 bug：resultAudio 字段（P2 新增）此前不在备份模块的媒体收集白名单里，已在
// backup.ts 里修好，这里用一个"生成成功但因冲突未自动入编排"的 job 复现修复前会丢文件的场景。
test("full audio workflow survives backup -> restore -> re-export, including a resultAudio-only job the collector used to skip", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-backup-audio-"));
  const source = new Store(":memory:"),
    target = new Store(":memory:");
  try {
    const sourceAssets = path.join(dir, "source-assets");

    // 先在事务外异步生成好全部媒体文件（transact 回调必须是同步的），再用 transact
    // 一次性把这些已经落盘的结果写入项目状态。
    const shotVideos: { shotId: string; image: string; video?: string }[] = [];
    for (const s of source.get().shots) {
      const videoFile = path.join(dir, "v-" + s.id + ".mp4");
      await ffmpeg([
        "-f", "lavfi", "-i", "testsrc2=size=320x568:rate=24",
        "-t", String(s.seconds), "-c:v", "libx264", "-threads", "1", "-y", videoFile,
      ]);
      const saved = await saveVideo(readFileSync(videoFile), sourceAssets, s.seconds);
      shotVideos.push({ shotId: s.id, image: saved.image, video: saved.video });
    }
    const voiceFile = path.join(dir, "voice.wav");
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-y", voiceFile]);
    const voice = await saveAudio(readFileSync(voiceFile), sourceAssets);
    const orphanFile = path.join(dir, "orphan.wav");
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=300:duration=1", "-y", orphanFile]);
    const orphan = await saveAudio(readFileSync(orphanFile), sourceAssets);

    source.transact((proj) => {
      confirmPreview(proj, proj.revision);
      for (const sv of shotVideos) {
        const s = proj.shots.find((x) => x.id === sv.shotId)!;
        s.candidates.push({
          id: "candidate-" + s.id, image: sv.image, video: sv.video,
          createdAt: Date.now(), inputRevision: s.revision, mode: "provider",
        });
      }
      for (const sv of shotVideos) adopt(proj, sv.shotId, "candidate-" + sv.shotId, proj.revision);
      addAudioTrack(proj, { ...voice, name: "TTS voice", kind: "dialogue", rights: "generated", offsetMs: 0, volume: 70 }, proj.revision);
      // 一条"生成成功但因超时长/达上限冲突，没有自动写入 audioTracks"的孤立 TTS 结果——
      // 只存在于 provider job 的 resultAudio 字段，这正是修复前会被漏掉的路径。
      proj.provider = {
        budgetMicros: 1000000,
        jobs: [{
          id: "orphan-job", operationId: "op-orphan",
          quote: {
            id: "q1", input: {
              kind: "audio", model: "xiaoyun", prompt: "conflict case",
              seconds: 5, size: "tts", shotId: proj.shots[0].id,
              shotRevision: proj.shots[0].revision, referenceRevision: proj.referenceRevision,
            },
            upperMicros: 15000, expiresAt: Date.now() + 300000, pricingVersion: "fixture",
          },
          state: "succeeded", createdAt: Date.now(), upstreamId: null, generation: 1,
          leaseUntil: 0, nextQueryAt: 0, queries: 0, reservedMicros: 15000, actualMicros: null,
          billingEvidence: null, resultImage: null, resultVideo: null,
          resultAudio: orphan.audio, resultDurationMs: orphan.durationMs,
          errorCode: "audio_track_conflict",
        }],
      };
    }, "sample");

    const beforeBackup = source.get();

    const archive = await backup.createBackup(source, "sample", sourceAssets);
    // 离线完整性校验：备份里声明的每条媒体 SHA-256 必须与打包进去的字节真的一致
    // （不是信任写入时的标注，是从备份数据本身重新计算一遍核对）。
    for (const m of archive.media) {
      const recomputed = createHash("sha256").update(Buffer.from(m.data, "base64")).digest("hex");
      assert.equal(recomputed, m.sha256, "备份里声明的 SHA-256 与实际字节不一致：" + m.source);
    }
    // 确认孤立的 resultAudio 文件真的被收进了这次备份（修复前这里会是 false）。
    assert.ok(
      archive.media.some((m) => m.source === orphan.audio),
      "resultAudio 引用的音频文件应该被备份收集，此前的白名单遗漏会导致这里为 false",
    );

    // renderAnimatic 内部按 exportDir 的兄弟目录 "assets" 找资产，恢复目录布局要匹配这个约定。
    const restoredAssets = path.join(dir, "restored", "assets");
    const restored = await backup.restoreBackup(target, archive, restoredAssets);

    // 核对采用版本：三个镜头的 adoptedId 都还指向有效候选，视频文件路径已重映射且可读
    for (const s of restored.shots) {
      assert.ok(s.adoptedId, "镜头 " + s.id + " 的采用状态应该保留");
      const candidate = s.candidates.find((c) => c.id === s.adoptedId)!;
      assert.ok(candidate.video, "采用的候选应该带视频");
      readFileSync(path.join(restoredAssets, candidate.video!.split("/").at(-1)!));
    }
    // 核对音轨：正常写入编排的那条还在，时长一致
    assert.equal(restored.audioTracks?.length, 1);
    assert.equal(restored.audioTracks![0].durationMs, voice.durationMs);
    readFileSync(path.join(restoredAssets, restored.audioTracks![0].audio.split("/").at(-1)!));
    // 核对孤立的 resultAudio：文件也已恢复、路径已重映射、且仍然可读
    const restoredOrphanJob = restored.provider!.jobs[0];
    assert.equal(restoredOrphanJob.recoveryBlocked, true);
    assert.ok(restoredOrphanJob.resultAudio);
    readFileSync(path.join(restoredAssets, restoredOrphanJob.resultAudio!.split("/").at(-1)!));

    // 恢复后还能不能正常再导出一次——这是此前 backup.test.ts 没做到的最后一步。
    const exportDir = path.join(dir, "restored", "exports");
    const result = await renderAnimatic(
      target.get(restored.id),
      exportDir,
      { audioMode: "mix" },
    );
    const checked = await runFile(
      ffmpegPath(),
      ["-hide_banner", "-i", result.file, "-f", "null", "-"],
      { windowsHide: true, timeout: 60000, maxBuffer: 2000000 },
    );
    assert.match(checked.stderr, /Duration: 00:00:15.00/);

    assert.deepEqual(source.get(), beforeBackup, "备份过程不应该改动源项目");
  } finally {
    source.close();
    target.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
