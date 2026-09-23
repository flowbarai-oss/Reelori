import {subtitleCues} from '../core/subtitles.ts';
import path from "node:path";
import {verifyRenderedFile} from './verify-output.ts';
import { localSource } from "./local-source.ts";
import {
  mkdir,
  writeFile,
  readFile,
  rename,
  unlink,
  readdir,
  access,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { DomainError, manifest } from "../core/project.ts";
import {validateAudioTracks} from '../core/audio.ts';
import type { Project } from "../contracts/index.ts";
import { ffmpeg, ffmpegPath, runFile } from "./runtime.ts";
function stamp(seconds: number, decimal = ",") {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}${decimal}${String(ms % 1000).padStart(3, "0")}`;
}
export async function renderAnimatic(
  project: Project,
  dir: string,
  options: { audioMode?: "none" | "source" | "mix"; volume?: number } = {},
) {
  const audioMode = options.audioMode ?? "none",
    volume = options.volume ?? 1;
  if (
    !["none", "source", "mix"].includes(audioMode) ||
    !Number.isFinite(volume) ||
    volume < 0 ||
    volume > 1
  )
    throw new DomainError("声音设置无效");
  const p = structuredClone(project);
  if(audioMode==='mix'){validateAudioTracks(p,true);if(!p.audioTracks?.length)throw new DomainError('请先导入要混音的声音素材',409);}
  const output = manifest(p);
  if (
    !p.shots.length ||
    p.shots.length > 6 ||
    output.durationSeconds > 30 ||
    p.shots.some(
      (s) => !Number.isInteger(s.seconds) || s.seconds < 2 || s.seconds > 10,
    )
  )
    throw new DomainError(
      "预演规格须为 1–6 镜、每镜 2–10 秒、总长不超过 30 秒",
    );
  const id = output.snapshotId;
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.mp4`),
    temporary = path.join(dir, `${id}.partial.mp4`);
  const srtFile = path.join(dir, `${id}.srt`),
    vttFile = path.join(dir, `${id}.vtt`),
    manifestFile = path.join(dir, `${id}.json`);
  const cues = subtitleCues(p).map(c=>({start:c.startMs/1000,end:c.endMs/1000,text:c.text.replace(/\r/g,'').replace(/\n{2,}/g,'\n').trim()}));
  const srt = cues
    .map(
      (c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`,
    )
    .join("\n");
  const vtt =
    "WEBVTT\n\n" +
    cues
      .map(
        (c) =>
          `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}\n`,
      )
      .join("\n");
  const args: string[] = [];
  const sourceHashes: string[] = [];
  const audioSources: boolean[] = [];
  for (const shot of p.shots) {
    const candidate = shot.candidates.find(
      (c) => c.id === shot.adoptedId && c.inputRevision === shot.revision,
    );
    if (!candidate)
      throw new DomainError("已采用素材已过期，请重新生成并复核", 409);
    const source = localSource(
      candidate.video ?? candidate.image,
      path.join(path.dirname(dir), "assets"),
    );
    sourceHashes.push(
      createHash("sha256")
        .update(await readFile(source))
        .digest("hex"),
    );
    let hasAudio = false;
    if (audioMode === "source" && candidate.video) {
      let metadata = "";
      try {
        await runFile(
          ffmpegPath(),
          [
            "-hide_banner",
            "-nostdin",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            source,
          ],
          { windowsHide: true, timeout: 15000, maxBuffer: 2000000 },
        );
      } catch (error) {
        metadata = String((error as { stderr?: string }).stderr ?? "");
      }
      if (!/Video:/.test(metadata))
        throw new DomainError("无法读取视频音轨，请检查素材", 409);
      hasAudio = /Stream #\d+:\d+[^\r\n]*Audio:/.test(metadata);
    }
    audioSources.push(hasAudio);
    if (candidate.video)
      args.push(
        "-threads",
        "1",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        source,
      );
    else
      args.push(
        "-loop",
        "1",
        "-framerate",
        "24",
        "-t",
        String(shot.seconds + 1),
        "-i",
        source,
      );
  }
  const audioTracks=[];
  if(audioMode==='mix')for(const track of p.audioTracks??[]){const source=localSource(track.audio,path.join(path.dirname(dir),'assets'));const bytes=await readFile(source);const sha256=createHash('sha256').update(bytes).digest('hex');if(!track.audio.includes('/'+sha256+'.'))throw new DomainError('声音素材摘要发生变化',409);audioTracks.push({...track,sha256});args.push('-protocol_whitelist','file,pipe','-i',source);}
  let filters =
    p.shots
      .map(
        (shot, i) =>
          `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x111214,setsar=1,fps=24,tpad=stop_mode=clone:stop_duration=1,trim=start_frame=${(shot.clipStartSeconds??0)*24}:end_frame=${((shot.clipStartSeconds??0)+shot.seconds)*24},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`,
      )
      .join(";") +
    ";" +
    p.shots.map((_, i) => `[v${i}]`).join("") +
    `concat=n=${p.shots.length}:v=1:a=0[out]`;
  if (audioMode === "source") {
    filters +=
      ";" +
      p.shots
        .map((shot, i) =>
          audioSources[i]
            ? `[${i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=start=${shot.clipStartSeconds??0}:duration=${shot.seconds},asetpts=PTS-STARTPTS,volume=${volume}[a${i}]`
            : `anullsrc=r=48000:cl=stereo,atrim=duration=${shot.seconds},asetpts=PTS-STARTPTS[a${i}]`,
        )
        .join(";") +
      ";" +
      p.shots.map((_, i) => `[a${i}]`).join("") +
      `concat=n=${p.shots.length}:v=0:a=1[audio]`;
  }
  if(audioMode==='mix'){
    filters+=';'+audioTracks.map((track,i)=>`[${p.shots.length+i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,volume=${track.volume/100},adelay=${track.offsetMs}:all=1,apad,atrim=duration=${output.durationSeconds}[track${i}]`).join(';')+';'+audioTracks.map((_,i)=>`[track${i}]`).join('')+`amix=inputs=${audioTracks.length}:duration=longest:normalize=0,alimiter=limit=0.95:level=0:latency=1[audio]`;
  }
  try {
    await writeFile(srtFile, srt, "utf8");
    await writeFile(vttFile, vtt, "utf8");
    if (cues.length) args.push("-i", srtFile);
    args.push(
      "-filter_complex_threads",
      "1",
      "-filter_complex",
      filters,
      "-map",
      "[out]",
    );
    if (cues.length)
      args.push(
        "-map",
        `${p.shots.length+audioTracks.length}:s:0`,
        "-c:s",
        "mov_text",
        "-metadata:s:s:0",
        "language=zho",
      );
    if (audioMode !== "none")
      args.push("-map", "[audio]", "-c:a", "aac", "-b:a", "192k");
    else args.push("-an");
    args.push(
      "-r",
      "24",
      "-fps_mode",
      "cfr",
      "-video_track_timescale",
      "12288",
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-preset",
      "ultrafast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-t",
      String(output.durationSeconds),
      "-movflags",
      "+faststart",
      "-y",
      temporary,
    );
    try {
      await ffmpeg(args, 180000);
    } catch {
      throw new DomainError(
        "本地合成失败。请检查 FFmpeg 配置、磁盘空间与素材文件；没有发布不完整成片。",
        503,
      );
    }
    const verification = await verifyRenderedFile(temporary, output.durationSeconds, audioMode !== 'none', cues.length > 0);
    await rename(temporary, file);
    const files = await Promise.all(
      [file, srtFile, vttFile].map(async (filename) => ({
        name: path.basename(filename),
        sha256: createHash("sha256")
          .update(await readFile(filename))
          .digest("hex"),
      })),
    );
    await writeFile(
      `${manifestFile}.tmp`,
      JSON.stringify(
        {
          ...output,
          shots: output.shots.map((shot, i) => ({
            ...shot,
            sourceSha256: sourceHashes[i],
          })),
          projectId: p.id,
          inputRevision: p.inputRevision,
          referenceRevision: p.referenceRevision,
          kind: p.shots.some(
            (s) => s.candidates.find((c) => c.id === s.adoptedId)?.video,
          )
            ? "mixed-media-animatic"
            : "still-image-animatic",
          audio: audioMode,
          verification,
          audioTracks,
          audioRevision:p.audioRevision??0,
      subtitleRevision:p.subtitleRevision??0,
      subtitleCues:subtitleCues(p),
          projectRevision:p.revision,
          audioVolume: audioMode === "source" ? volume : 0,
          width: 1080,
          height: 1920,
          fps: 24,
          references: p.references ?? [],
          files,
        },
        null,
        2,
      ),
      "utf8",
    );
    await rename(`${manifestFile}.tmp`, manifestFile);
    return {
      id,
      file,
      manifestFile,
      download: `/api/download?id=${id}&format=mp4`,
      subtitles: `/api/download?id=${id}&format=srt`,
      captions: `/api/download?id=${id}&format=vtt`,
      manifest: `/api/download?id=${id}`,
      durationSeconds: output.durationSeconds,
      inputRevision: p.inputRevision,
      audioRevision:p.audioRevision??0,
      subtitleRevision:p.subtitleRevision??0,
      subtitleCues:subtitleCues(p),
      createdAt: output.createdAt,
    };
  } catch (error) {
    for (const filename of [
      temporary,
      file,
      srtFile,
      vttFile,
      manifestFile,
      `${manifestFile}.tmp`,
    ])
      await unlink(filename).catch(() => {});
    throw error;
  }
}
export async function listRenders(dir: string, projectId: string) {
  const names = await readdir(dir).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
  const outputs = [];
  for (const name of names) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const m = JSON.parse(await readFile(path.join(dir, name), "utf8"));
      if (
        m.projectId !== projectId ||
        !["still-image-animatic", "mixed-media-animatic"].includes(m.kind) ||
        `${m.snapshotId}.json` !== name
      )
        continue;
      const id = m.snapshotId;
      for (const ext of ["mp4", "srt", "vtt"])
        await access(path.join(dir, `${id}.${ext}`));
      const hasDelivery = await access(path.join(dir, `${id}.zip`)).then(
        () => true,
        () => false,
      );
      outputs.push({
        id,
        delivery: hasDelivery ? `/api/download?id=${id}&format=zip` : undefined,
        inputRevision: m.inputRevision,
        audioRevision:m.audioRevision??0,
        subtitleRevision:m.subtitleRevision??0,
        createdAt: m.createdAt,
        durationSeconds: m.durationSeconds,
        download: `/api/download?id=${id}&format=mp4`,
        subtitles: `/api/download?id=${id}&format=srt`,
        captions: `/api/download?id=${id}&format=vtt`,
        manifest: `/api/download?id=${id}`,
      });
    } catch {
      /* Incomplete or unavailable snapshots are not listed as successful exports. */
    }
  }
  return outputs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
