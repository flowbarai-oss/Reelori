import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { DomainError } from "../core/project.ts";
import { MAX_FILM_SHOTS, MAX_AUDIO_TRACKS } from "../core/film-limits.ts";
import { localSource } from "./local-source.ts";
import { makeZip, type ZipEntry } from "./zip.ts";
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
function csv(value: unknown) {
  let text = String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export async function createDelivery(
  snapshotId: string,
  projectId: string,
  dir: string,
  assetDir: string,
) {
  if (!/^[a-f0-9-]{36}$/.test(snapshotId))
    throw new DomainError("合成记录标识无效");
  const m = JSON.parse(
    await readFile(path.join(dir, `${snapshotId}.json`), "utf8"),
  );
  if (
    !["still-image-animatic", "mixed-media-animatic"].includes(m.kind) ||
    m.projectId !== projectId ||
    m.snapshotId !== snapshotId
  )
    throw new DomainError("合成记录不属于当前项目", 404);
  if (
    !Array.isArray(m.shots) ||
    m.shots.length < 1 ||
    m.shots.length > MAX_FILM_SHOTS ||
    !m.shots.every((s: any) => /^[a-f0-9]{64}$/.test(s.sourceSha256))
  )
    throw new DomainError("此旧合成记录没有素材摘要，请重新合成后打包", 409);
  const entries: ZipEntry[] = [];
  for (const [ext, name] of [
    ["mp4", "film.mp4"],
    ["srt", "subtitles.srt"],
    ["vtt", "subtitles.vtt"],
  ]) {
    const bytes = await readFile(path.join(dir, `${snapshotId}.${ext}`));
    const expected = m.files?.find(
      (f: any) => f.name === `${snapshotId}.${ext}`,
    )?.sha256;
    if (hash(bytes) !== expected)
      throw new DomainError("导出文件摘要不一致，请检查文件后重新合成", 409);
    entries.push({ name, bytes });
  }
  const shots: {
    order: number;
    id: string;
    title: string;
    seconds: number;
    clipStartSeconds: number;
    sourceSeconds: number;
    candidateId: string;
    dialogue: string;
    source: string;
  }[] = [];
  for (const s of m.shots) {
    const bytes = await readFile(localSource(s.source, assetDir));
    if (hash(bytes) !== s.sourceSha256)
      throw new DomainError("采用素材摘要不一致，不能替换冻结版本", 409);
    const name = `assets/shot-${String(shots.length + 1).padStart(2, "0")}.${s.source.endsWith(".mp4") ? "mp4" : s.source.endsWith(".jpg") ? "jpg" : "png"}`;
    entries.push({ name, bytes });
    shots.push({
      order: s.order,
      id: s.id,
      title: s.title,
      seconds: s.seconds,
      clipStartSeconds: s.clipStartSeconds ?? 0,
      sourceSeconds: s.sourceSeconds ?? s.seconds,
      candidateId: s.candidateId,
      dialogue: s.dialogue,
      source: name,
    });
  }
  entries.push({
    name: "storyboard.json",
    bytes: Buffer.from(JSON.stringify({ project: m.project, shots }, null, 2)),
  });
  const audioTracks:{source:string;kind:string;durationMs:number;offsetMs:number;volume:number;rights:string}[]=[];
  if(m.audio==='mix'){
    if(!Array.isArray(m.audioTracks)||m.audioTracks.length>MAX_AUDIO_TRACKS)throw new DomainError('音轨清单无效');
    for(const track of m.audioTracks){
      const bytes=await readFile(localSource(track.audio,assetDir));if(hash(bytes)!==track.sha256)throw new DomainError('声音素材摘要不一致',409);
      const source=`audio/track-${String(audioTracks.length+1).padStart(2,'0')}.wav`;entries.push({name:source,bytes});
      audioTracks.push({source,kind:track.kind,durationMs:track.durationMs,offsetMs:track.offsetMs,volume:track.volume,rights:track.rights});
    }
  }
  entries.push({
    name: "storyboard.csv",
    bytes: Buffer.from(
      "\uFEFF" +
        [
          ["order", "title", "seconds", "source_in_seconds", "source_out_seconds", "dialogue", "source"],
          ...shots.map((s) => [
            s.order,
            s.title,
            s.seconds,
            s.clipStartSeconds,
            s.clipStartSeconds+s.seconds,
            s.dialogue,
            s.source,
          ]),
        ]
          .map((row) => row.map(csv).join(","))
          .join("\r\n"),
    ),
  });
  entries.push({
    name: "manifest.json",
    bytes: Buffer.from(
      JSON.stringify(
        {
          format: "reelori-delivery",
          version: 1,
          snapshotId,
          project: m.project,
          kind: m.kind,
          audio: m.audio,
          audioVolume: m.audioVolume,
          audioTracks,
          audioRevision:m.audioRevision??0,
          width: m.width,
          height: m.height,
          fps: m.fps,
          durationSeconds: m.durationSeconds,
          inputRevision: m.inputRevision,
          createdAt: m.createdAt,
          files: entries.map((e) => ({
            name: e.name,
            bytes: e.bytes.length,
            sha256: hash(e.bytes),
          })),
        },
        null,
        2,
      ),
    ),
  });
  const id = snapshotId,
    file = path.join(dir, `${id}.zip`),
    temp = file + ".tmp",
    bytes = makeZip(entries);
  const existing = await readFile(file).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (existing) {
    if (!existing.equals(bytes))
      throw new DomainError(
        "已有交付包与当前摘要不符，请检查文件；不会覆盖旧包",
        409,
      );
  } else
    try {
      await writeFile(temp, bytes, { flag: "wx" });
      await rename(temp, file);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  return { file, download: `/api/download?id=${id}&format=zip` };
}
