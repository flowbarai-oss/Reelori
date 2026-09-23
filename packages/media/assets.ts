import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { DomainError } from "../core/project.ts";
import { ffmpeg } from "./runtime.ts";
export async function saveReference(data: unknown, dir: string) {
  if (
    typeof data !== "string" ||
    data.length > 7 * 1024 * 1024 ||
    !data.length ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    throw new DomainError("图片数据无效，最大 5 MB");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > 5 * 1024 * 1024) throw new DomainError("图片最大 5 MB");
  let ext: string;
  let width = 0,
    height = 0;
  if (
    bytes.length >= 33 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  ) {
    ext = "png";
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
    ext = "jpg";
    let i = 2;
    while (i + 4 < bytes.length) {
      if (bytes[i] !== 255) break;
      const marker = bytes[i + 1],
        len = bytes.readUInt16BE(i + 2);
      if (len < 2 || i + 2 + len > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && len >= 7) {
        height = bytes.readUInt16BE(i + 5);
        width = bytes.readUInt16BE(i + 7);
        break;
      }
      i += 2 + len;
    }
  } else throw new DomainError("仅支持 PNG / JPEG 图片");
  if (
    !width ||
    !height ||
    width > 4096 ||
    height > 4096 ||
    width * height > 16000000
  )
    throw new DomainError("图片尺寸须在 1–4096 像素内，最多 1600 万像素");
  await mkdir(dir, { recursive: true });
  const id = createHash("sha256").update(bytes).digest("hex");
  const file = path.join(dir, `${id}.${ext}`);
  const temp = path.join(dir, `${randomUUID()}.${ext}`);
  try {
    await writeFile(temp, bytes, { flag: "wx" });
    try {
      await ffmpeg(
        ["-threads", "1", "-i", temp, "-frames:v", "1", "-f", "null", "-"],
        20000,
      );
    } catch {
      throw new DomainError(
        "图片无法解码，或本地 FFmpeg 未配置，请检查文件和渲染环境",
      );
    }
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(() => {});
  }
  return { image: `/api/assets/${id}.${ext}`, width, height };
}
