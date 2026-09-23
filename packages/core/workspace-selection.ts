import { existsSync, lstatSync, readFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import type { Project } from "../contracts/index.ts";
import { validateProject } from "../storage-local/validate-project.ts";

export type WorkspaceSelection = {
  version: 1;
  active: string;
  previous: string | null;
  activatedAt: string;
};

function absoluteDirectory(value: unknown): value is string {
  return (
    typeof value === "string" &&
    path.isAbsolute(value) &&
    path.normalize(value) === value &&
    path.parse(value).root !== value
  );
}

export function readWorkspaceSelection(
  file: string,
): WorkspaceSelection | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("工作区选择记录格式无效");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("工作区选择记录格式无效");
  const item = value as Record<string, unknown>;
  if (
    Object.keys(item).sort().join(",") !==
      "activatedAt,active,previous,version" ||
    item.version !== 1 ||
    !absoluteDirectory(item.active) ||
    (item.previous !== null && !absoluteDirectory(item.previous)) ||
    typeof item.activatedAt !== "string" ||
    !Number.isFinite(Date.parse(item.activatedAt))
  )
    throw new Error("工作区选择记录格式无效");
  return item as WorkspaceSelection;
}

const same = (a: string, b: string) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const below = (parent: string, child: string) =>
  same(parent, child) ||
  same(child.slice(0, parent.length + 1), parent + path.sep);

async function regularFile(file: string) {
  const item = await lstat(file);
  if (!item.isFile() || item.isSymbolicLink())
    throw new Error("工作区包含无效文件或符号链接");
  return item;
}

export function assertUnlinkedDirectory(directory: string, message: string) {
  const root = path.parse(directory).root;
  let current = root;
  for (const part of directory.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const item = lstatSync(current);
    if (!item.isDirectory() || item.isSymbolicLink()) throw new Error(message);
  }
}

async function realDirectory(directory: string) {
  if (!absoluteDirectory(directory))
    throw new Error("工作区目录须为规范化绝对路径");
  assertUnlinkedDirectory(directory, "工作区目录不允许符号链接");
  return directory;
}

function mediaRefs(value: unknown, refs: Set<string>) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (
      [
        "image",
        "video",
        "resultImage",
        "resultVideo",
        "audio",
        "resultAudio",
      ].includes(key) &&
      typeof item === "string" &&
      item.startsWith("/api/assets/")
    )
      refs.add(item.slice("/api/assets/".length));
    else if (typeof item === "object") mediaRefs(item, refs);
  }
}

export async function inspectWorkspaceDirectory(
  directory: string,
  { requirePaused = true } = {},
) {
  await realDirectory(directory);
  const database = path.join(directory, "studio.sqlite");
  await regularFile(database);
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    if (
      Number(db.prepare("PRAGMA user_version").get()?.user_version) !== 1 ||
      db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok"
    )
      throw new Error("工作区数据库版本或完整性无效");
    const rows = db.prepare("SELECT id,body FROM projects").all();
    if (!rows.length || rows.length > 100)
      throw new Error("工作区项目数量无效");
    const refs = new Set<string>();
    for (const row of rows) {
      const id = String(row.id),
        metadata = JSON.parse(String(row.body));
      const shots = db
        .prepare("SELECT body FROM shots WHERE project_id=? ORDER BY position")
        .all(id)
        .map((r) => JSON.parse(String(r.body)));
      const jobs = db
        .prepare("SELECT body FROM jobs WHERE project_id=? ORDER BY position")
        .all(id)
        .map((r) => JSON.parse(String(r.body)));
      const current = { ...metadata, shots, jobs } as Project;
      validateProject(current);
      if (requirePaused && !current.paused)
        throw new Error("待启用工作区仍有未暂停项目");
      const revisions = db
        .prepare(
          "SELECT body FROM project_revisions WHERE project_id=? ORDER BY revision",
        )
        .all(id)
        .map((r) => JSON.parse(String(r.body)) as Project);
      if (!revisions.length || revisions.at(-1)?.revision !== current.revision)
        throw new Error("工作区版本历史不完整");
      for (const revision of revisions) {
        validateProject(revision);
        mediaRefs(revision, refs);
      }
      mediaRefs(current, refs);
    }
    const assetsDir = path.join(directory, "assets");
    if (refs.size) await realDirectory(assetsDir);
    for (const name of refs) {
      if (!/^[a-f0-9]{64}\.(png|jpg|mp4|wav)$/.test(name))
        throw new Error("工作区素材引用无效");
      await regularFile(path.join(assetsDir, name));
    }
    const exportsDir = path.join(directory, "exports");
    if (existsSync(exportsDir)) await realDirectory(exportsDir);
    const outputs = await readdir(exportsDir, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    let renders = 0;
    for (const output of outputs) {
      if (!/^[a-f0-9-]{36}\.json$/.test(output.name)) continue;
      if (!output.isFile() || output.isSymbolicLink())
        throw new Error("工作区成果文件无效");
      const manifest = JSON.parse(
        await readFile(path.join(exportsDir, output.name), "utf8"),
      );
      if (
        manifest?.kind === "mixed-media-animatic" ||
        manifest?.kind === "still-image-animatic"
      ) {
        const stem = output.name.slice(0, -5);
        for (const ext of [".mp4", ".srt", ".vtt"]) {
          try {
            await regularFile(path.join(exportsDir, stem + ext));
          } catch {
            throw new Error("工作区成片文件不完整");
          }
        }
        renders++;
      }
    }
    return {
      projects: rows.length,
      assets: refs.size,
      renders,
      paused: requirePaused,
    };
  } finally {
    db.close();
  }
}

async function writeSelection(file: string, value: WorkspaceSelection) {
  if (!path.isAbsolute(file) || path.parse(file).root === file)
    throw new Error("工作区选择记录须使用绝对文件路径");
  const parent = path.dirname(file);
  await mkdir(parent, { recursive: true });
  assertUnlinkedDirectory(parent, "工作区选择记录目录不允许符号链接");
  const temp = path.join(parent, ".reelori-selection-" + randomUUID() + ".tmp");
  try {
    await writeFile(temp, JSON.stringify(value), "utf8");
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export async function activateWorkspaceSelection(
  file: string,
  current: string,
  target: string,
) {
  await realDirectory(current);
  await realDirectory(target);
  if (below(current, file) || below(target, file))
    throw new Error("工作区选择记录不能放在工作区内部");
  if (
    same(current, target) ||
    below(target, current) ||
    (below(current, target) &&
      !same(path.dirname(target), path.join(current, "restored-workspaces")))
  )
    throw new Error("工作区目标与当前目录重合或嵌套方式无效");
  const existing = readWorkspaceSelection(file);
  if (existing && !same(existing.active, current))
    throw new Error("工作区选择记录已变化，请重新检查");
  await inspectWorkspaceDirectory(current, { requirePaused: false });
  const details = await inspectWorkspaceDirectory(target);
  await writeSelection(file, {
    version: 1,
    active: target,
    previous: current,
    activatedAt: new Date().toISOString(),
  });
  return details;
}

export async function rollbackWorkspaceSelection(file: string) {
  const existing = readWorkspaceSelection(file);
  if (!existing?.previous) throw new Error("没有可回退的工作区");
  if (below(existing.active, file) || below(existing.previous, file))
    throw new Error("工作区选择记录不能放在工作区内部");
  await inspectWorkspaceDirectory(existing.previous, { requirePaused: false });
  await writeSelection(file, {
    version: 1,
    active: existing.previous,
    previous: existing.active,
    activatedAt: new Date().toISOString(),
  });
  return existing.previous;
}
