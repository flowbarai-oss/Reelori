import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink, rename, readFile } from "node:fs/promises";
import path from "node:path";
import { ffmpeg, ffmpegPath, runFile } from "./runtime.ts";
import { saveReference } from "./assets.ts";
import { DomainError } from "../core/project.ts";
export async function saveVideo(
  bytes: Buffer,
  dir: string,
  expectedSeconds?: number,
) {
  if (
    bytes.length > 64 * 1024 * 1024 ||
    bytes.length < 12 ||
    bytes.toString("ascii", 4, 8) !== "ftyp"
  )
    throw new DomainError("视频格式或大小无效");
  await mkdir(dir, { recursive: true });
  const id = createHash("sha256").update(bytes).digest("hex");
  const temp = path.join(dir, `${randomUUID()}.mp4`),
    poster = temp + ".png";
  try {
    await writeFile(temp, bytes, { flag: "wx" });
    let info = "";
    try {
      await runFile(
        ffmpegPath(),
        [
          "-hide_banner",
          "-nostdin",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          temp,
        ],
        { windowsHide: true, timeout: 10000, maxBuffer: 65536 },
      );
    } catch (e) {
      info = String((e as { stderr?: string }).stderr ?? "");
    }
    const duration = info.match(/Duration: (\d+):(\d+):(\d+\.\d+)/),
      dimensions = info.match(/Video: [^\r\n]*?\b(\d{2,5})x(\d{2,5})\b/);
    if (!duration || !dimensions) throw new DomainError("无法读取视频规格");
    const seconds =
        Number(duration[1]) * 3600 +
        Number(duration[2]) * 60 +
        Number(duration[3]),
      width = Number(dimensions[1]),
      height = Number(dimensions[2]);
    if (
      seconds < 1 ||
      seconds > 30 ||
      width > 1920 ||
      height > 1920 ||
      width * height > 2073600 ||
      (expectedSeconds !== undefined &&
        Math.abs(seconds - expectedSeconds) > 0.25)
    )
      throw new DomainError("视频时长或尺寸与约定不符");
    await ffmpeg(
      [
        "-threads",
        "1",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        temp,
        "-map",
        "0:v:0",
        "-an",
        "-t",
        "31",
        "-f",
        "null",
        "-",
      ],
      60000,
    );
    await ffmpeg(
      [
        "-threads",
        "1",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        temp,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-update",
        "1",
        poster,
      ],
      20000,
    );
    const saved = await saveReference(
      (await readFile(poster)).toString("base64"),
      dir,
    );
    await rename(temp, path.join(dir, id + ".mp4"));
    return {
      video: `/api/assets/${id}.mp4`,
      image: saved.image,
      width,
      height,
      seconds,
    };
  } finally {
    await unlink(temp).catch(() => {});
    await unlink(poster).catch(() => {});
  }
}
