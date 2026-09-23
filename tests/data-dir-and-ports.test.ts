import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import { getDataDir } from "../packages/core/data-dir.ts";
import { Store } from "../packages/storage-local/store.ts";
import { confirmPreview } from "../packages/core/project.ts";
import { ffmpeg, ffmpegPath } from "../packages/media/runtime.ts";
import { saveAudio } from "../packages/media/audio.ts";
import { readFileSync, existsSync } from "node:fs";

// P4 第 2 点：数据目录/端口此前散落硬编码在三个文件里（runtime.ts、providers/config.ts、
// server.ts 的默认值），只在仓库内相对路径工作，打包安装到用户级标准路径就没法用。
test("getDataDir defaults to the repo's data/ dir and REELORI_DATA_DIR overrides it", () => {
  const before = process.env.REELORI_DATA_DIR;
  try {
    delete process.env.REELORI_DATA_DIR;
    const repoRoot = path.resolve(
      fileURLToPath(new URL("../", import.meta.url)),
    );
    assert.equal(getDataDir(), path.join(repoRoot, "data"));

    process.env.REELORI_DATA_DIR = "  C:/somewhere/custom  ";
    assert.equal(getDataDir(), path.resolve("C:/somewhere/custom"));
  } finally {
    if (before === undefined) delete process.env.REELORI_DATA_DIR;
    else process.env.REELORI_DATA_DIR = before;
  }
});

test("SQLite storage and ffmpeg subprocess calls both work under a data directory with spaces and Chinese characters", async () => {
  const beforeDataDir = process.env.REELORI_DATA_DIR;
  const beforeFfmpeg = process.env.REELORI_FFMPEG;
  const dir = path.join(
    tmpdir(),
    "reelori 路径 测试 " + Math.random().toString(36).slice(2),
  );
  try {
    // 先在默认数据目录（仓库自带 data/runtime.json）下解析出真实可用的 ffmpeg 路径，
    // 再显式用 REELORI_FFMPEG 传给自定义数据目录场景——这才是用户真实会做的事：
    // 换了数据目录之后，runtime.json 不会跟着自动出现在新目录里，ffmpeg 路径要靠环境
    // 变量单独配置。第一次写这个测试时漏了这一步，暴露出这台机器系统 PATH 里其实没有
    // 独立安装 ffmpeg（只有 imageio-ffmpeg 这个 Python 包内置的二进制），会话内之前手动
    // 验证"成功"是因为当时根本没有真的设置 REELORI_DATA_DIR，读的还是默认 data/runtime.json。
    const resolvedFfmpeg = ffmpegPath();
    process.env.REELORI_DATA_DIR = dir;
    process.env.REELORI_FFMPEG = resolvedFfmpeg;
    const target = getDataDir();
    const { mkdirSync } = await import("node:fs");
    mkdirSync(target, { recursive: true });

    const store = new Store(path.join(target, "studio.sqlite"));
    try {
      store.transact((p) => {
        confirmPreview(p, p.revision);
      }, "sample");
      assert.ok(existsSync(path.join(target, "studio.sqlite")));
    } finally {
      store.close();
    }

    const voiceFile = path.join(target, "voice.wav");
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-y",
      voiceFile,
    ]);
    assert.ok(existsSync(voiceFile), "ffmpeg 应该能在含空格/中文的路径下正常写出文件");
    const saved = await saveAudio(readFileSync(voiceFile), path.join(target, "assets"));
    assert.equal(saved.durationMs, 1000);
  } finally {
    if (beforeDataDir === undefined) delete process.env.REELORI_DATA_DIR;
    else process.env.REELORI_DATA_DIR = beforeDataDir;
    if (beforeFfmpeg === undefined) delete process.env.REELORI_FFMPEG;
    else process.env.REELORI_FFMPEG = beforeFfmpeg;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("starting the local service on an already-occupied port prints a clear message and exits 1, not a raw stack trace", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-port-conflict-"));
  const occupied = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      occupied.once("error", reject);
      occupied.listen(0, "127.0.0.1", resolve);
    });
    const port = (occupied.address() as net.AddressInfo).port;

    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../apps/local-service/server.ts", import.meta.url))],
      {
        env: {
          ...process.env,
          REELORI_DATA_DIR: dir,
          REELORI_PORT: String(port),
          REELORI_WEB_PORT: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => child.kill(), 30000);
      child.once("error", reject);
      child.once("close", (code) => {
        clearTimeout(timeout);
        resolve(code ?? -1);
      });
    });
    assert.equal(exitCode, 1);
    assert.match(stderr, new RegExp(`端口 ${port} 已被占用`));
    assert.doesNotMatch(stderr, /EADDRINUSE\s*\n\s*at /);
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  }
});
