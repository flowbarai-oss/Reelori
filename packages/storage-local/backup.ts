import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { Project } from "../contracts/index.ts";
import { DomainError } from "../core/project.ts";
import { Store } from "./store.ts";
import { validateProject, validImage } from "./validate-project.ts";
import { saveReference } from "../media/assets.ts";
import { saveVideo } from '../media/video.ts';
import {saveAudio} from '../media/audio.ts';
function validMedia(value:unknown):asserts value is string {if(typeof value==='string'&&/^\/api\/assets\/[a-f0-9]{64}\.(mp4|wav)$/.test(value))return;validImage(value);}
const mediaKeys=new Set(['image','video','resultImage','resultVideo','audio','resultAudio']);
export const MAX_BACKUP_BYTES = 96 * 1024 * 1024;
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
interface Media {
  source: string;
  sha256: string;
  data: string;
}
interface Backup {
  format: "reelori-project";
  version: 1;
  createdAt: string;
  project: Project;
  revisions: Project[];
  media: Media[];
}
function images(projects: Project[]) {
  const result = new Set<string>();
  const walk = (x: any) => {
    if (!x || typeof x !== "object") return;
    for (const [key, value] of Object.entries(x)) {
      if (mediaKeys.has(key) && value!=null) {
        validMedia(value);
        result.add(value);
      } else walk(value);
    }
  };
  projects.forEach(walk);
  return result;
}
function sourcePath(source: string, assetDir: string) {
  validMedia(source);
  return source.startsWith("/api/assets/")
    ? path.join(assetDir, source.slice("/api/assets/".length))
    : fileURLToPath(new URL(`../../public${source}`, import.meta.url));
}
export async function createBackup(
  store: Store,
  id: string,
  assetDir: string,
): Promise<Backup> {
  // Synchronous reads occur before the first await, retaining a coherent project/history pair.
  const project = store.get(id),
    revisions = store.history(id);
  const media: Media[] = [];
  let total = 0;
  for (const source of images([project, ...revisions])) {
    const bytes = await readFile(sourcePath(source, assetDir));
    total += bytes.length;
    if (total > 64 * 1024 * 1024)
      throw new DomainError("项目媒体超过当前 64 MiB 备份上限", 413);
    media.push({
      source,
      sha256: digest(bytes),
      data: bytes.toString("base64"),
    });
  }
  const archive: Backup = {
    format: "reelori-project",
    version: 1,
    createdAt: new Date().toISOString(),
    project,
    revisions,
    media,
  };
  inspectBackup(archive);
  return archive;
}
export function inspectBackup(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Buffer.byteLength(JSON.stringify(value)) > MAX_BACKUP_BYTES
  )
    throw new DomainError("备份格式无效或超过 96 MiB 上限", 413);
  const a = value as Backup;
  if (
    Object.keys(a).some(
      (k) =>
        ![
          "format",
          "version",
          "createdAt",
          "project",
          "revisions",
          "media",
        ].includes(k),
    ) ||
    a.format !== "reelori-project" ||
    a.version !== 1 ||
    typeof a.createdAt !== "string" ||
    !Number.isFinite(Date.parse(a.createdAt))
  )
    throw new DomainError("不支持此备份格式或版本");
  validateProject(a.project);
  if (
    !Array.isArray(a.revisions) ||
    !a.revisions.length
  )
    throw new DomainError("备份历史无效");
  let revision = 0;
  for (const p of a.revisions) {
    validateProject(p);
    if (p.id !== a.project.id || p.revision <= revision)
      throw new DomainError("备份历史顺序或归属无效");
    revision = p.revision;
  }
  if (!isDeepStrictEqual(a.project, a.revisions.at(-1)))
    throw new DomainError("备份当前版本与历史不一致");
  if (!Array.isArray(a.media) || a.media.length > 64)
    throw new DomainError("备份素材数量无效");
  const required = images([a.project, ...a.revisions]);
  let total = 0;
  const seen = new Set();
  for (const m of a.media) {
    if (
      !m ||
      Object.keys(m).some((k) => !["source", "sha256", "data"].includes(k))
    )
      throw new DomainError("素材条目无效");
    validMedia(m.source);
    if (
      seen.has(m.source) ||
      !required.has(m.source) ||
      typeof m.data !== "string" ||
      m.data.length > (m.source.endsWith('.mp4')?86:m.source.endsWith('.wav')?22:7) * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(m.data) ||
      m.data.length % 4 !== 0
    )
      throw new DomainError("素材缺失、重复或编码无效");
    seen.add(m.source);
    const bytes = Buffer.from(m.data, "base64");
    total += bytes.length;
    if (bytes.length > (m.source.endsWith('.mp4')?64:m.source.endsWith('.wav')?16:5) * 1024 * 1024 || digest(bytes) !== m.sha256)
      throw new DomainError("素材摘要校验失败");
    if (
      m.source.startsWith("/api/assets/") &&
      !m.source.includes("/" + m.sha256 + ".")
    )
      throw new DomainError("素材地址与摘要不一致");
  }
  if (total > 64 * 1024 * 1024 || seen.size !== required.size)
    throw new DomainError("素材不完整或超过备份上限");
  return {
    title: a.project.title,
    shots: a.project.shots.length,
    media: a.media.length,
    revisions: a.revisions.length,
    bytes: total,
    inFlight: a.project.jobs.filter((j) =>
      ["queued", "running", "unknown"].includes(j.status),
    ).length,
  };
}
export async function restoreBackup(
  store: Store,
  value: unknown,
  assetDir: string,
) {
  inspectBackup(value);
  const archive = structuredClone(value as Backup);
  const mapping = new Map<string, string>();
  for (const m of archive.media) {
    if(m.source.endsWith('.mp4')){const saved=await saveVideo(Buffer.from(m.data,'base64'),assetDir);mapping.set(m.source,saved.video);}
    else if(m.source.endsWith('.wav')){const saved=await saveAudio(Buffer.from(m.data,'base64'),assetDir);for(const p of [archive.project,...archive.revisions])for(const t of p.audioTracks??[])if(t.audio===m.source&&t.durationMs!==saved.durationMs)throw new DomainError('音频时长与备份记录不一致');mapping.set(m.source,saved.audio);}
    else {const saved = await saveReference(m.data, assetDir);mapping.set(m.source, saved.image);}
  }
  const id = randomUUID();
  const remap = (x: any) => {
    if (!x || typeof x !== "object") return;
    for (const [key, v] of Object.entries(x)) {
      if (mediaKeys.has(key) && v!=null) x[key] = mapping.get(v as string);
      else remap(v);
    }
  };
  for (const p of archive.revisions) {
    p.id = id;
    remap(p);
  }
  const p = archive.project;
  p.id = id;
  remap(p);
  p.revision++;
  p.paused = true;
  for(const job of p.provider?.jobs??[]){job.recoveryBlocked=true;job.leaseUntil=0;job.generation++;if(!['succeeded','failed'].includes(job.state))job.state='unknown';}
  for (const j of p.jobs)
    if (["queued", "running"].includes(j.status)) j.status = "unknown";
  p.events.push({
    id: (p.events.at(-1)?.id ?? 0) + 1,
    text: "已从备份恢复为独立项目；在途任务保留预留并待核对",
    at: Date.now(),
  });
  p.events = p.events.slice(-100);
  return store.insertRestored(p, archive.revisions);
}
