import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getDataDir } from "../core/data-dir.ts";
export const runFile = promisify(execFile);
export function ffmpegPath() {
  if (process.env.REELORI_FFMPEG) return process.env.REELORI_FFMPEG;
  try {
    const config = JSON.parse(
      readFileSync(path.join(getDataDir(), "runtime.json"), "utf8").replace(
        /^\uFEFF/,
        "",
      ),
    );
    if (typeof config.ffmpeg === "string") return config.ffmpeg;
  } catch {}
  return "ffmpeg";
}
export async function ffmpeg(args: string[], timeout = 120000) {
  return runFile(
    ffmpegPath(),
    ["-hide_banner", "-nostdin", "-v", "error", ...args],
    { windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024 },
  );
}
