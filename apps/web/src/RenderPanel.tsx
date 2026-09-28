import { useEffect, useState, type ReactNode } from "react";
import { DownloadSimple, FilmSlate, CircleNotch } from "@phosphor-icons/react";
import type { Project } from "../../../packages/contracts/index.ts";
import type { RuntimeReport } from "../../../packages/media/diagnostics.ts";
import { requestRuntimeCheck } from "./runtime-client";
import {AudioPanel} from './AudioPanel';
import {SubtitlePanel} from './SubtitlePanel';
type Output = {
  id: string;
  download: string;
  subtitles: string;
  captions: string;
  manifest: string;
  durationSeconds: number;
  inputRevision: number;
  audioRevision?:number;
  subtitleRevision?:number;
  createdAt: string;
  delivery?: string;
};
export function RenderPanel({
  project,
  lang,
  request,
  onChange,
  onOpenSettings,
  children,
}: {
  project: Project;
  lang: string;
  request: (route: string, body?: unknown) => Promise<any>;
  onChange:(p:Project)=>void;
  onOpenSettings:()=>void;
  children?: ReactNode;
}) {
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [busy, setBusy] = useState(false);
  const [subtitleDirty,setSubtitleDirty]=useState(false);
  const [error, setError] = useState("");
  const [output, setOutput] = useState<Output | null>(null);
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<Output[]>([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [packing, setPacking] = useState(false);
  const [audioMode, setAudioMode] = useState<"none" | "source" | "mix">("none");
  const [volume, setVolume] = useState(1);
  const [includeTitle, setIncludeTitle] = useState(false);
  const [card, setCard] = useState<{ url: string; id: string } | null>(null);
  const [runtime, setRuntime] = useState<RuntimeReport | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(true);
  const [runtimeError, setRuntimeError] = useState(false);
  async function checkRuntime() {
    setRuntimeBusy(true);
    setRuntimeError(false);
    try {
      setRuntime(await requestRuntimeCheck(request));
    } catch {
      setRuntime(null);
      setRuntimeError(true);
    } finally {
      setRuntimeBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    setRuntime(null);
    setRuntimeBusy(true);
    setRuntimeError(false);
    requestRuntimeCheck(request)
      .then((report) => { if (live) setRuntime(report); })
      .catch(() => { if (live) setRuntimeError(true); })
      .finally(() => { if (live) setRuntimeBusy(false); });
    return () => { live = false; };
  }, [project.id]);
  useEffect(
    () => () => {
      if (card) URL.revokeObjectURL(card.url);
    },
    [card],
  );
  useEffect(() => {
    let active = true;
    const refresh = () =>
      request("exports")
        .then((data) => {
          if (!active) return;
          setHistory(data.outputs);
          setRemoteBusy(data.rendering);
          setOutput((previous) => previous ?? data.outputs[0] ?? null);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [project.id]);
  return (
    <section className="render-panel" id="render-panel">
      <div className="render-setup">
      <div className={`render-readiness ${runtime?.ready ? "ready" : ""}`} aria-live="polite">
        <div>
          <strong>{t("本机成片准备", "Local render readiness")}</strong>
          <span>{runtimeBusy
            ? t("正在检查导出目录和视频编码器…", "Checking export storage and video encoder…")
            : runtime?.ready
              ? t("已通过，可以合成 MP4", "Ready to render MP4")
              : runtimeError
                ? t("检查失败，请确认本地服务后重试", "Check failed. Confirm the local service, then retry.")
                : runtime?.checks.some((check) => check.id === "encoder" && check.status === "fail")
                  ? t("FFmpeg 视频编码检查未通过；请查看检查项", "FFmpeg encoding check failed; view the checks")
                : t("尚不能合成，请先处理本机检查项", "Rendering needs attention. Review local checks first.")}</span>
        </div>
        <div className="render-readiness-actions">
          <button className="secondary" type="button" disabled={runtimeBusy} onClick={checkRuntime}>{t("重新检查", "Recheck")}</button>
          {!runtimeBusy && !runtime?.ready && <button className="secondary" type="button" onClick={onOpenSettings}>{t("查看检查项", "View checks")}</button>}
        </div>
      </div>
      <AudioPanel project={project} lang={lang} request={request} onChange={onChange}/>
      <SubtitlePanel project={project} lang={lang} request={request} onChange={onChange} onDirty={setSubtitleDirty}/>
      <label className="render-history">
        {t("成片声音", "Film audio")}
        <select
          value={audioMode}
          disabled={busy || remoteBusy}
          onChange={(e) => setAudioMode(e.target.value as "none" | "source" | "mix")}
        >
          <option value="none">
            {t("静音，仅导出对白字幕", "Silent, dialogue subtitles only")}
          </option>
          <option value="source">
            {t("保留已采用视频的原声", "Keep adopted video audio")}
          </option>
          <option value="mix" disabled={!project.audioTracks?.length}>{t('混合导入声音（不含视频原声）','Mix imported audio (exclude source audio)')}</option>
        </select>
      </label>
      {audioMode === "source" && (
        <label className="render-history">
          {t("原声音量", "Source volume")} · {Math.round(volume * 100)}%
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            disabled={busy || remoteBusy}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
      )}
      <button
        className="primary full large"
        disabled={
          busy ||
          runtimeBusy ||
          runtime?.ready !== true ||
          subtitleDirty ||
          remoteBusy ||
          project.shots.some((s) => s.review !== "accepted")
        }
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const next = await request("render", {
              revision: project.revision,
              audioMode,
              volume,
            });
            setOutput(next);
            setHistory((previous) => [
              next,
              ...previous.filter((item) => item.id !== next.id),
            ]);
            setRevision(project.inputRevision);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy || remoteBusy ? (
          <CircleNotch className="spin" size={21} />
        ) : (
          <FilmSlate size={21} />
        )}{" "}
        {busy || remoteBusy
          ? t("正在本机合成…", "Rendering locally…")
          : t("合成预演 MP4", "Render animatic MP4")}
      </button>
      <p className="fine">
        {t(
          "9:16 · 1080p · 24 fps · 已采用图片/视频。原声模式下，无声音的镜头保持静音，不自动添加配音。对白导出为字幕，本地合成不产生模型费用。",
          "9:16 · 1080p · 24 fps · adopted images/videos. Source-audio mode keeps silent shots silent and adds no voiceover. Dialogue is exported as subtitles. Local rendering adds no model charges.",
        )}
      </p>
      {(busy || remoteBusy) && (
        <p role="status">
          {t(
            "正在冻结采用版本并合成，请稍候。",
            "Freezing adopted versions and rendering. Please wait.",
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {children}
      </div>
      {output && (
        <div className="render-output">
          <div className="share-card-controls">
            <label>
              <input
                type="checkbox"
                checked={includeTitle}
                onChange={(e) => {
                  setIncludeTitle(e.target.checked);
                  setCard(null);
                }}
              />{" "}
              {t("分享卡显示项目标题", "Include project title on share card")}
            </label>
            <button
              className="secondary"
              disabled={busy || packing}
              onClick={async () => {
                setPacking(true);
                setError("");
                try {
                  const result = await request("share-card", {
                    snapshotId: output.id,
                    includeTitle,
                  });
                  setCard({
                    url: URL.createObjectURL(
                      new Blob([result.svg], { type: "image/svg+xml" }),
                    ),
                    id: result.snapshotId,
                  });
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setPacking(false);
                }
              }}
            >
              {t("制作作品分享卡", "Create film share card")}
            </button>
            <p className="fine">
              {t(
                "默认隐藏标题；不包含画面、对白、费用或私人备注。仅生成本地文件，不自动发布。",
                "Title is hidden by default. No footage, dialogue, costs or private notes. Creates a local file without posting.",
              )}
            </p>
            {card && (
              <>
                <img
                  className="film-share-card"
                  src={card.url}
                  alt={t("作品分享卡预览", "Film share card preview")}
                />
                <a
                  className="secondary"
                  href={card.url}
                  download={`reelori-card-${card.id}.svg`}
                >
                  {t("下载分享卡 SVG", "Download share card SVG")}
                </a>
              </>
            )}
          </div>
          <label className="render-history">
            {t("合成记录", "Render history")}
            <select
              value={output.id}
              onChange={(e) => {
                setCard(null);
                setOutput(
                  history.find((item) => item.id === e.target.value) ?? output,
                );
              }}
            >
              {history.map((item) => (
                <option value={item.id} key={item.id}>
                  {new Date(item.createdAt).toLocaleString(
                    lang === "zh" ? "zh-CN" : "en-US",
                  )}{" "}
                  · {item.durationSeconds}s · v{item.inputRevision}
                </option>
              ))}
            </select>
          </label>
          <video
            key={output.id}
            controls
            preload="metadata"
            aria-label={t("已合成预演", "Rendered animatic")}
          >
            <source src={output.download} type="video/mp4" />
            <track
              kind="subtitles"
              src={output.captions}
              srcLang={lang === "zh" ? "zh" : "en"}
              label={t("对白字幕", "Dialogue")}
              default
            />
          </video>
          <p className="fine">
            {output.durationSeconds}s ·{" "}
            {(output.inputRevision || revision) === project.inputRevision&&(output.audioRevision??0)===(project.audioRevision??0)&&(output.subtitleRevision??0)===(project.subtitleRevision??0)
              ? t("采用版本已冻结", "Adopted version frozen")
              : t(
                  "项目已修改，此文件保留旧版本",
                  "Project changed; this file keeps the earlier version",
                )}
          </p>
          <div className="render-links">
            {output.delivery && (
              <a className="secondary" href={output.delivery} download>
                {t("交付包 ZIP", "Delivery ZIP")}
              </a>
            )}
            <a className="secondary" href={output.download} download>
              <DownloadSimple size={18} /> MP4
            </a>
            <a className="secondary" href={output.subtitles} download>
              SRT
            </a>
            <a className="secondary" href={output.captions} download>
              VTT
            </a>
            <a className="secondary" href={output.manifest} download>
              {t("交付清单", "Manifest")}
            </a>
          </div>
          <button
            className="secondary full"
            disabled={packing || busy || remoteBusy}
            onClick={async () => {
              const snapshotId = output.id;
              setPacking(true);
              setError("");
              try {
                const result = await request("delivery", { snapshotId });
                setOutput((previous) =>
                  previous?.id === snapshotId
                    ? { ...previous, delivery: result.download }
                    : previous,
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setPacking(false);
              }
            }}
          >
            {packing
              ? t("正在校验并打包…", "Verifying and packing…")
              : t(
                  "打包成片、字幕与采用素材",
                  "Package film, subtitles & adopted assets",
                )}
          </button>
          <p className="fine">
            {t(
              "交付包附安全 CSV / JSON 和文件摘要，不包含故事原文、参考权利备注或本机路径。",
              "Includes safe CSV / JSON and file hashes. Excludes original story, reference rights notes and local paths.",
            )}
          </p>
        </div>
      )}
    </section>
  );
}
