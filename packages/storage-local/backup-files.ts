import {
  mkdir,
  writeFile,
  rename,
  unlink,
  readdir,
  readFile,
  access,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Store } from "./store.ts";
import { createBackup } from "./backup.ts";
export async function saveBackup(
  store: Store,
  projectId: string,
  assetDir: string,
  dir: string,
) {
  const archive = await createBackup(store, projectId, assetDir),
    id = randomUUID();
  const file = path.join(dir, `${id}.backup`),
    index = path.join(dir, `${id}.backup-index.json`);
  const record = {
    id,
    projectId,
    title: archive.project.title,
    revision: archive.project.revision,
    createdAt: archive.createdAt,
    download: `/api/download?id=${id}&format=backup`,
  };
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(file + ".tmp", JSON.stringify(archive), "utf8");
    await rename(file + ".tmp", file);
    await writeFile(index + ".tmp", JSON.stringify(record), "utf8");
    await rename(index + ".tmp", index);
    return { ...record, file };
  } catch (error) {
    for (const item of [file + ".tmp", index + ".tmp", file, index])
      await unlink(item).catch(() => {});
    throw error;
  }
}
export async function listBackups(projectId: string, dir: string) {
  const names = await readdir(dir).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
  const rows = [];
  for (const name of names) {
    if (!/^[a-f0-9-]{36}\.backup-index\.json$/.test(name)) continue;
    try {
      const r = JSON.parse(await readFile(path.join(dir, name), "utf8"));
      if (r.projectId === projectId && `${r.id}.backup-index.json` === name) {
        await access(path.join(dir, `${r.id}.backup`));
        rows.push(r);
      }
    } catch {}
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
