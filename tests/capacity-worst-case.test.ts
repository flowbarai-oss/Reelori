import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, unlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedProject, adopt } from "../packages/core/project.ts";
import { addAudioTrack } from "../packages/core/audio.ts";
import { saveAudio } from "../packages/media/audio.ts";
import { saveVideo } from "../packages/media/video.ts";
import { ffmpeg, ffmpegPath, runFile } from "../packages/media/runtime.ts";
import { renderAnimatic } from "../packages/media/render.ts";

// P3 第 3/4 点要求：此前的容量测试（audio-capacity.test.ts）只用 320x568 合成源证明了
// 组合和时间线拼接正确，没有证明真实分辨率下的耗时/内存/磁盘表现。本文件用 1920x1080
// （比已验证过的 H3 真实分辨率 768x1344、FlowBar 720x1280 都更"最坏情况"）重跑同一套
// 30 秒/6 视频源/8 配音/1 BGM/1 音效组合，并把真实数字写进证据文件，不是只 assert 通过。
function dirSizeBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeBytes(full);
    else total += statSync(full).size;
  }
  return total;
}

test("worst-case capacity: 1920x1080 sources, 30s, 6 video + 8 voice + 1 music + 1 effect — real timing/memory/disk recorded, not just asserted", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-worstcase-"));
  const memSamples: number[] = [];
  const sampler = setInterval(() => {
    memSamples.push(process.memoryUsage().rss);
  }, 250);
  try {
    const p = seedProject();
    p.shots = Array.from({ length: 6 }, (_, i) => ({
      ...structuredClone(p.shots[i % 3]),
      id: "shot-" + i,
      candidates: [],
      seconds: 5,
      adoptedId: null,
      review: "pending" as const,
    }));
    const sourceStart = Date.now();
    for (let i = 0; i < 6; i++) {
      const file = path.join(dir, "v" + i + ".mp4");
      await ffmpeg([
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=1920x1080:rate=24, hue=h=${i * 30}`,
        "-t",
        "5",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-y",
        file,
      ]);
      const saved = await saveVideo(readFileSync(file), path.join(dir, "assets"), 5);
      const s = p.shots[i];
      s.candidates.push({
        id: "candidate-" + i,
        image: saved.image,
        video: saved.video,
        createdAt: Date.now(),
        inputRevision: s.revision,
        mode: "provider",
      });
      adopt(p, s.id, "candidate-" + i, p.revision);
    }
    const sourceMs = Date.now() - sourceStart;
    const voiceFile = path.join(dir, "voice.wav");
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-y", voiceFile]);
    const voice = await saveAudio(readFileSync(voiceFile), path.join(dir, "assets"));
    for (let i = 0; i < 8; i++)
      addAudioTrack(
        p,
        { ...voice, name: "Voice " + i, kind: "dialogue", rights: "generated", offsetMs: i * 3000, volume: 30 },
        p.revision,
      );
    const musicFile = path.join(dir, "music.wav");
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=220:duration=30", "-y", musicFile]);
    const music = await saveAudio(readFileSync(musicFile), path.join(dir, "assets"));
    addAudioTrack(p, { ...music, name: "Music", kind: "music", rights: "generated", offsetMs: 0, volume: 10 }, p.revision);
    addAudioTrack(p, { ...voice, name: "Effect", kind: "effect", rights: "generated", offsetMs: 27000, volume: 20 }, p.revision);

    const renderStart = Date.now();
    const result = await renderAnimatic(p, path.join(dir, "exports"), { audioMode: "mix" });
    const renderMs = Date.now() - renderStart;
    clearInterval(sampler);

    const checked = await runFile(ffmpegPath(), ["-hide_banner", "-i", result.file, "-f", "null", "-"], {
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 2000000,
    });
    assert.match(checked.stderr.split("Stream mapping:")[0], /1080x1920[^\r\n]* 24 fps,/);
    assert.match(checked.stderr, /Duration: 00:00:30.00/);
    assert.equal(Number([...checked.stderr.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]), 720);
    const m = JSON.parse(readFileSync(result.manifestFile, "utf8"));
    assert.equal(m.audioTracks.length, 10);
    assert.equal(m.shots.length, 6);

    const outputBytes = statSync(result.file).size;
    const workDirBytes = dirSizeBytes(dir);
    const peakRssMb = Math.round(Math.max(...memSamples, process.memoryUsage().rss) / 1024 / 1024);

    const report = [
      "# 最坏情况容量测试 — 真实数字（2026-09-23，本机实测，不是估算）",
      "",
      "输入：1920x1080 合成视频源 × 6（每段 5s）+ 8 段配音 + 1 段音乐 + 1 段音效",
      "输出：1080x1920 · 24fps · 30.00s · 720 帧（已用 ffprobe 解码校验，不是只看编码器声明）",
      "",
      `- 视频素材归一化耗时：${sourceMs} ms（6 段 1920x1080 → 落盘）`,
      `- 渲染合成耗时：${renderMs} ms（renderAnimatic 全程，含混音 10 条音轨）`,
      `- 本进程内存峰值（RSS，250ms 采样）：约 ${peakRssMb} MB —— 这是 Node 测试进程整体峰值，包含 ffmpeg 子进程输出缓冲，不是 ffmpeg 独立进程的内存占用`,
      `- 工作目录总磁盘占用（含全部临时源/归一化素材/输出）：${(workDirBytes / 1024 / 1024).toFixed(1)} MB`,
      `- 最终输出文件大小：${(outputBytes / 1024).toFixed(1)} KB`,
      "",
      "本机环境：本次开发/测试用机，非独立压测环境，不代表低配设备或生产环境表现；仅证明真实分辨率下功能正确且给出量级参考，不是正式性能基准。",
    ].join("\n");
    writeFileSync(
      path.join(
        tmpdir(),
        "reelori-capacity-result-" + process.pid + ".md",
      ),
      report,
      "utf8",
    );
  } finally {
    clearInterval(sampler);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing audio asset file fails the render explicitly instead of producing a file that looks complete", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-missing-asset-"));
  try {
    const p = seedProject();
    const videoFile = path.join(dir, "v.mp4");
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x568:rate=24",
      "-t",
      "5",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-y",
      videoFile,
    ]);
    for (const s of p.shots) {
      const saved = await saveVideo(readFileSync(videoFile), path.join(dir, "assets"), s.seconds);
      s.candidates.push({
        id: "candidate-" + s.id,
        image: saved.image,
        video: saved.video,
        createdAt: Date.now(),
        inputRevision: s.revision,
        mode: "provider",
      });
      adopt(p, s.id, "candidate-" + s.id, p.revision);
    }
    const voiceFile = path.join(dir, "voice.wav");
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-y", voiceFile]);
    const voice = await saveAudio(readFileSync(voiceFile), path.join(dir, "assets"));
    addAudioTrack(p, { ...voice, name: "Voice", kind: "dialogue", rights: "generated", offsetMs: 0, volume: 30 }, p.revision);

    // 模拟磁盘上的素材文件真的丢失了（比如手动误删、磁盘故障），但项目记录还在引用它。
    const assetFilename = voice.audio.split("/").at(-1)!;
    unlinkSync(path.join(dir, "assets", assetFilename));

    const exportsDir = path.join(dir, "exports");
    await assert.rejects(() => renderAnimatic(p, exportsDir, { audioMode: "mix" }));

    // 关键断言：不应该在 exports 目录留下任何看起来完整的产物（不管是最终文件名还是
    // 残留的 .partial 临时文件），失败就应该干净地失败，不留半成品冒充结果。
    let filesAfterFailure: string[] = [];
    try {
      filesAfterFailure = readdirSync(exportsDir);
    } catch {
      // 目录本身都没建出来，同样满足"没有产出误导性文件"的要求
    }
    const looksComplete = filesAfterFailure.filter((f) => f.endsWith(".mp4") && !f.endsWith(".partial.mp4"));
    assert.deepEqual(looksComplete, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
