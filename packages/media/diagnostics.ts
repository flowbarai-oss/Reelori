import { mkdir, mkdtemp, statfs, stat, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import type { Store } from "../storage-local/store.ts";
import { ffmpegPath, runFile } from "./runtime.ts";

export interface RuntimeCheck {
  id: "node" | "database" | "storage" | "space" | "encoder";
  status: "pass" | "warn" | "fail" | "skipped";
  value?: string | number;
}
export interface RuntimeReport {
  version: 1;
  checkedAt: string;
  ready: boolean;
  checks: RuntimeCheck[];
}

export async function inspectRuntime(
  store: Store,
  exportDir: string,
  executable = ffmpegPath(),
): Promise<RuntimeReport> {
  const checks: RuntimeCheck[] = [];
  const [major, minor] = process.versions.node.split(".").map(Number);
  checks.push({
    id: "node",
    status: major > 24 || (major === 24 && minor >= 12) ? "pass" : "fail",
    value: process.versions.node,
  });
  try {
    const rows = store.db.prepare("PRAGMA quick_check(1)").all();
    checks.push({
      id: "database",
      status:
        rows.length === 1 && Object.values(rows[0])[0] === "ok"
          ? "pass"
          : "fail",
    });
  } catch {
    checks.push({ id: "database", status: "fail" });
  }
  let scratch: string | undefined;
  try {
    await mkdir(exportDir, { recursive: true });
    scratch = await mkdtemp(path.join(exportDir, ".reelori-check-"));
    checks.push({ id: "storage", status: "pass" });
  } catch {
    checks.push({ id: "storage", status: "fail" });
  }
  try {
    const fs = await statfs(exportDir, { bigint: true });
    const available = fs.bavail * fs.bsize;
    checks.push({
      id: "space",
      status: available >= 512n * 1024n * 1024n ? "pass" : "warn",
      value: Number(
        available > BigInt(Number.MAX_SAFE_INTEGER)
          ? BigInt(Number.MAX_SAFE_INTEGER)
          : available,
      ),
    });
  } catch {
    checks.push({ id: "space", status: "warn" });
  }
  if (!scratch) checks.push({ id: "encoder", status: "skipped" });
  else {
    const output = path.join(scratch, "probe.mp4");
    try {
      await runFile(
        executable,
        [
          "-hide_banner",
          "-nostdin",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=c=black:s=32x32:r=24",
          "-frames:v",
          "1",
          "-an",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-threads",
          "1",
          "-y",
          output,
        ],
        { windowsHide: true, timeout: 10000, maxBuffer: 65536 },
      );
      checks.push({
        id: "encoder",
        status: (await stat(output)).size > 0 ? "pass" : "fail",
      });
    } catch {
      checks.push({ id: "encoder", status: "fail" });
    } finally {
      try {
        await unlink(output);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT")
          checks.find((c) => c.id === "storage")!.status = "warn";
      }
      try {
        await rmdir(scratch);
      } catch {
        checks.find((c) => c.id === "storage")!.status = "warn";
      }
    }
  }
  return {
    version: 1,
    checkedAt: new Date().toISOString(),
    ready: checks.every((c) => c.status !== "fail" && c.status !== "skipped"),
    checks,
  };
}

export function cachedInspector<T>(inspect: () => Promise<T>, now = Date.now) {
  let pending: Promise<T> | undefined,
    cached: T | undefined,
    checkedAt = 0;
  return () => {
    if (pending) return pending;
    if (cached !== undefined && now() - checkedAt < 30000)
      return Promise.resolve(cached);
    pending = inspect()
      .then((result) => {
        cached = result;
        checkedAt = now();
        return result;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
