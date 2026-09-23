import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Play,
  Pause,
  Check,
  FilmSlate,
  SquaresFour,
  Users,
  Clock,
  DownloadSimple,
  GearSix,
  Sun,
  Moon,
  Translate,
  PencilSimple,
  LockKey,
  X,
  WarningCircle,
  CheckCircle,
  ArrowCounterClockwise,
  FolderOpen,
  Eye,
  CaretRight,
  CircleNotch,
} from "@phosphor-icons/react";
import type { Page, Project, Shot } from "../../../packages/contracts/index.ts";
import {TimelineControls} from './TimelineControls.tsx';

import { RenderPanel } from "./RenderPanel";
import { BackupPanel } from './BackupPanel';
import { RuntimePanel } from './RuntimePanel';
import { UpdatePanel } from './UpdatePanel';
import { ProviderPanel } from './ProviderPanel';
import { createProjectClient } from "./project-client";
import { ReferencePanel } from "./ReferencePanel";
import { ProjectLibrary } from "./ProjectLibrary";

const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
async function api(path: string, body?: unknown) {
  const res = await fetch(
    `/api/${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
const pages: Page[] = [
  "storyboard",
  "characters",
  "preview",
  "progress",
  "results",
  "settings",
];
const icons = [FilmSlate, Users, Eye, Clock, DownloadSimple, GearSix];
export function App() {
  const [page, setPage] = useState<Page>(() =>
    pages.includes(location.hash.slice(1) as Page)
      ? (location.hash.slice(1) as Page)
      : "home",
  );
  const [lang, setLang] = useState(
    () => localStorage.getItem("drama-lang") || "zh",
  );
  const [light, setLight] = useState(
    () => localStorage.getItem("drama-theme") === "light",
  );
  const [project, setProject] = useState<Project | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const activeId = useRef(localStorage.getItem("reelori-project") || "sample");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Shot | null>(null);
  const [dialog, setDialog] = useState<"budget" | "generate" | null>(null);
  const [editBase, setEditBase] = useState(0);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [checks, setChecks] = useState<boolean[]>([false, false, false]);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [budget, setBudget] = useState("60");
  const modalRef = useRef<HTMLDialogElement>(null);
  const acceptProject = (next: Project) =>
    setProject((previous) =>
      next.id === activeId.current &&
      (!previous ||
        next.id !== previous.id ||
        next.revision >= previous.revision)
        ? next
        : previous,
    );
  const projectApi = createProjectClient(project?.id ?? activeId.current, api);
  function selectProject(p: Project) {
    activeId.current = p.id;
    localStorage.setItem("reelori-project", p.id);
    setProject(p);
    setSelected(p.shots.map((s) => s.id));
    setReviewIndex(0);
    setChecks([false, false, false]);
    setEdit(null);
    setDialog(null);
    setPlaying(false);
    setElapsed(0);
    setError("");
    go("storyboard");
  }
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const nav = [
    t("分镜工作台", "Storyboard"),
    t("角色复核", "Character review"),
    t("分镜预演", "Animatic"),
    t("生成记录", "Generation"),
    t("成本与成果", "Results"),
    t("项目设置", "Settings"),
  ];
  function go(next: Page) {
    setPage(next);
    location.hash = next;
    setError("");
    setPlaying(false);
    setElapsed(0);
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    const change = () => {
      const key = location.hash.slice(1) as Page;
      setPage(pages.includes(key) ? key : "home");
      setPlaying(false);
    };
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    localStorage.setItem("drama-lang", lang);
  }, [lang]);
  useEffect(() => {
    localStorage.setItem("drama-theme", light ? "light" : "dark");
  }, [light]);
  useEffect(() => {
    let active = true;
    api("session")
      .then(() => projectApi("project"))
      .then((p) => {
        if (active) {
          setProject(p);
          setSelected(p.shots.map((s: Shot) => s.id));
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, []);
  const hasPendingJobs=!!(project?.jobs.some(j=>['queued','running'].includes(j.status))||project?.provider?.jobs.some(j=>!j.recoveryBlocked&&['submitting','running','unknown'].includes(j.state)&&j.actualMicros===null));
  useEffect(() => {
    if (!hasPendingJobs) return;
    const id = setInterval(
      () =>
        projectApi("project")
          .then(acceptProject)
          .catch((e) => setError(e.message)),
      900,
    );
    return () => clearInterval(id);
  }, [
    project?.id,
    hasPendingJobs,
  ]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (edit || dialog) modalRef.current?.showModal();
    else modalRef.current?.close();
  }, [!!edit, dialog]);
  const total = project?.shots.reduce((n, s) => n + s.seconds, 0) || 15;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(
      () =>
        setElapsed((v) => {
          if (v >= total - 1) {
            setPlaying(false);
            return 0;
          }
          return v + 1;
        }),
      1000,
    );
    return () => clearInterval(id);
  }, [playing, total]);
  async function mutate(path: string, body: object) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      acceptProject(
        await projectApi(path, { revision: project?.revision, ...body }),
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      projectApi("project")
        .then(acceptProject)
        .catch(() => {});
      return false;
    } finally {
      setBusy(false);
    }
  }
  function closeModal() {
    setEdit(null);
    setDialog(null);
  }
  async function download() {
    setBusy(true);
    try {
      const output = await projectApi("export", {
        revision: project?.revision,
      });
      const a = document.createElement("a");
      a.href = output.download;
      a.download = "drama-project.json";
      a.click();
      setNotice(
        t(
          "项目清单已保存至本地 data/exports，并已发起下载",
          "Manifest saved to local data/exports; download requested",
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const settled = project?.jobs.reduce((n, j) => n + j.settledCents, 0) || 0;
  const reserved =
    project?.jobs.reduce(
      (n, j) =>
        n +
        (["queued", "running", "unknown"].includes(j.status)
          ? j.reservedCents
          : 0),
      0,
    ) || 0;
  const accepted =
    project?.shots.filter((s) => s.review === "accepted").length || 0;
  const usable =
    project?.shots
      .filter((s) => s.review === "accepted")
      .reduce((n, s) => n + s.seconds, 0) || 0;
  const fresh =
    project?.preview?.referenceRevision === project?.referenceRevision &&
    project?.preview?.inputRevision === project?.inputRevision &&
    !!project?.preview;
  const activeJob = project?.jobs.find((j) => j.status === "running");
  const ready =
    project?.jobs.filter((j) => j.status === "succeeded").length || 0;
  const reviewShot = project?.shots[reviewIndex];
  const candidate = reviewShot?.candidates
    .filter((c) => c.inputRevision === reviewShot.revision)
    .at(-1);
  const candidateAdopted =
    !!candidate &&
    reviewShot?.adoptedId === candidate.id &&
    reviewShot.review === "accepted";
  let timer = 0;
  const currentShot =
    project?.shots.find((s) => {
      timer += s.seconds;
      return elapsed < timer;
    }) || project?.shots[0];
  const controls = (
    <div className="utility">
      <button
        className="icon-button"
        aria-label={t("切换语言", "Switch language")}
        title={t("切换语言", "Switch language")}
        onClick={() => setLang(lang === "zh" ? "en" : "zh")}
      >
        <Translate size={19} />
        <span>{lang === "zh" ? "EN" : "中"}</span>
      </button>
      <button
        className="icon-button"
        aria-label={t("切换主题", "Switch theme")}
        onClick={() => setLight(!light)}
      >
        {light ? <Moon size={20} /> : <Sun size={20} />}
      </button>
      <span className="local-dot">{t("本地模式", "Local mode")}</span>
    </div>
  );
  return (
    <div
      className={`app ${light ? "light" : ""} ${page === "results" ? "receipt-theme" : ""}`}
    >
      <a className="skip" href="#main">
        {t("跳转到内容", "Skip to content")}
      </a>
      <ProjectLibrary
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onSelect={selectProject}
        request={api}
        lang={lang}
        activeId={project?.id}
      />
      {page === "home" ? (
        <>
          <header className="landing-header">
            <button className="wordmark" onClick={() => go("home")}>
              <FilmSlate weight="fill" size={28} />
              <span>
                Reelori
                <span className="wordmark-small">
                  {t("幕芽 · AI 短片创作工作台", "AI SHORT FILM STUDIO")}
                </span>
              </span>
            </button>
            <div className="landing-links">
              <button onClick={() => go("preview")}>
                {t("作品示例", "Sample film")}
              </button>
              <button onClick={() => go("storyboard")}>
                {t("进入工作台", "Open studio")}
              </button>
            </div>
            {controls}
          </header>
          <main id="main" className="landing">
            <section className="hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  <span className="pill">LOCAL FIRST</span>
                  {t("让灵感，有自己的镜头", "YOUR STORY. YOUR FRAME.")}
                </div>
                <h1>
                  {t("让故事成片，", "Bring stories to life.")}
                  <br />
                  {t("让主角始终如一。", "Keep your character.")}
                </h1>
                <p className="hero-description">
                  {t(
                    "从一个灵感，到值得分享的短片。",
                    "From a spark of an idea to a film worth sharing.",
                  )}
                </p>
                <div className="hero-actions">
                  <button
                    className="primary large"
                    disabled={!project}
                    onClick={() => setLibraryOpen(true)}
                  >
                    {t("开始我的故事", "Start my story")}
                    <ArrowRight size={21} />
                  </button>
                  <button
                    className="secondary large"
                    disabled={!project}
                    onClick={() => go("storyboard")}
                  >
                    {t("免 Key 体验", "Explore the demo")}
                    <ArrowRight size={21} />
                  </button>
                  <button
                    className="secondary large"
                    disabled={!project}
                    onClick={() => go("preview")}
                  >
                    <Play size={18} />
                    {t("观看分镜预演", "Watch animatic")}
                  </button>
                </div>
                <p className="fine">
                  {t(
                    "本地示例 · 无需注册 · 不产生模型费用",
                    "Local sample · No signup · No model charges",
                  )}
                </p>
                <blockquote>
                  {t(
                    "每个平凡的人，都有一段值得被拍成电影的故事。",
                    "Ordinary lives. Extraordinary stories.",
                  )}
                  <small>— REELORI</small>
                </blockquote>
              </div>
              <div className="hero-main">
                <img
                  src={
                    project?.references?.at(-1)?.image ||
                    "/assets/rain-portrait.png"
                  }
                  alt={t(
                    "雨夜里手持相机的女主角",
                    "A young photographer in the rain",
                  )}
                />
                <div className="image-caption">
                  <span>01 / TOMORROW’S NEGATIVE</span>
                  <span>{t("AI 生成示例素材", "AI-generated sample")}</span>
                </div>
              </div>
              <div className="hero-side">
                <img
                  src="/assets/rain-wide.png"
                  alt={t("雨夜街头电影剧照", "Rainy street film still")}
                />
                <img
                  src="/assets/darkroom.png"
                  alt={t("暗房里的电影剧照", "Film still in a darkroom")}
                />
              </div>
            </section>
            <section className="story-entry">
              <FilmSlate size={28} />
              <div>
                <small>{t("从这个故事开始", "START WITH A STORY")}</small>
                <p>
                  {t(
                    "一位修复旧相机的女孩，发现照片里的明天。",
                    "A camera restorer discovers tomorrow in an old photograph.",
                  )}
                </p>
              </div>
              <span className="tag">{t("都市悬疑", "Urban mystery")}</span>
              <button
                className="primary"
                disabled={!project}
                onClick={() => go("storyboard")}
              >
                {t("打开示例项目", "Open sample project")}
                <ArrowRight size={19} />
              </button>
            </section>
            <footer className="landing-footer">
              <span>
                REELORI <span className="version"> / LOCAL PREVIEW 0.1</span>
              </span>
              <span>
                {t(
                  "先看见故事，再决定生成。",
                  "See your story before you generate.",
                )}
              </span>
            </footer>
          </main>
        </>
      ) : (
        <div className="workspace">
          <aside className="sidebar">
            <button className="wordmark" onClick={() => go("home")}>
              <FilmSlate size={29} weight="fill" />
              <span>
                Reelori
                <span className="wordmark-small">
                  {t("幕芽 · AI 短片创作工作台", "AI SHORT FILM STUDIO")}
                </span>
              </span>
            </button>
            <div className="nav-caption">{t("创作空间", "WORKSPACE")}</div>
            <nav aria-label={t("主导航", "Main navigation")}>
              {pages.map((key, i) => {
                const Icon = icons[i];
                return (
                  <button
                    key={key}
                    className={page === key ? "active" : ""}
                    aria-current={page === key ? "page" : undefined}
                    onClick={() => go(key)}
                  >
                    <Icon
                      size={21}
                      weight={page === key ? "fill" : "regular"}
                    />
                    <span>{nav[i]}</span>
                    {key === "characters" && accepted > 0 && (
                      <small>{accepted}/3</small>
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="sidebar-bottom">
              <FolderOpen size={19} />
              <span>
                {t("我的本地项目", "My local project")}
                <small>{t("内容保存在此电脑", "Saved on this computer")}</small>
              </span>
            </div>
          </aside>
          <div className="workspace-body">
            <header className="topbar">
              <div>
                <button
                  className="project-switch secondary"
                  disabled={busy}
                  onClick={() => setLibraryOpen(true)}
                >
                  <FolderOpen size={18} />
                  {t("项目库", "Projects")}
                </button>
                <span>
                  {project?.title || t("正在打开项目", "Opening project")}
                </span>
                <span className="slash">/</span>
                <span className="muted">{t("第一集", "Episode 01")}</span>
              </div>
              {controls}
            </header>
            <main id="main" className="workspace-main">
              {!project ? (
                <div className="empty">
                  <CircleNotch className="spin" size={28} />
                  <h2>
                    {t("正在打开本地工作台", "Opening your local studio")}
                  </h2>
                </div>
              ) : (
                <>
                  {page === "characters" && (
                    <ReferencePanel
                      key={project.id}
                      project={project}
                      lang={lang}
                      save={(body) => mutate("reference", body)}
                      busy={busy}
                    />
                  )}
                  {page === "storyboard" && (
                    <>
                      <section className="page-heading">
                        <div>
                          <div className="eyebrow">STORYBOARD / 01</div>
                          <h1>
                            {t(
                              "把每一镜，拍进故事。",
                              "Make every frame matter.",
                            )}
                          </h1>
                          <p>
                            {project.shots.length} {t("个镜头", "shots")}
                            <span className="separator">·</span>
                            <span className="accent">
                              {t(
                                `已选择 ${selected.length} 个`,
                                `${selected.length} selected`,
                              )}
                            </span>
                            <span className="separator">·</span>
                            {total}s
                          </p>
                        </div>
                        <div className="heading-actions">
                          <button
                            className="budget-summary"
                            onClick={() => {
                              setBudget(String(project.budgetCents / 100));
                              setDialog("budget");
                            }}
                          >
                            <span>
                              {t("模拟预算", "Demo budget")}{" "}
                              <strong>{money(project.budgetCents)}</strong>
                            </span>
                            <small>
                              {t("已用", "Used")} {money(settled)} ·{" "}
                              {t("预留", "Reserved")} {money(reserved)}
                            </small>
                            <progress
                              max={project.budgetCents || 1}
                              value={settled + reserved}
                            />
                          </button>
                          <button
                            className="primary"
                            onClick={() => go("preview")}
                          >
                            <Play weight="fill" size={19} />
                            {t("预演与生成", "Preview & generate")}
                          </button>
                        </div>
                      </section>
                      <div className="storyboard-layout">
                        <section
                          className="shot-list"
                          aria-label={t("分镜列表", "Shot list")}
                        >
                          <p className="fine">{t("排序会同步镜头字幕和已采用生成配音；手动导入的声音仍按整片起始时间放置。剪裁只支持已采用视频，冲突内容会提示先调整。", "Reordering moves shot subtitles and adopted generated voice. Imported audio keeps its film-wide start time. Trimming applies to adopted video; conflicting cues or voice need adjustment first.")}</p>
                          {project.shots.map((s, i) => (
                            <article className="shot-card" key={s.id}>
                              <div className="shot-index">
                                <input
                                  type="checkbox"
                                  checked={selected.includes(s.id)}
                                  aria-label={t(
                                    `选择镜头 ${i + 1}`,
                                    `Select shot ${i + 1}`,
                                  )}
                                  onChange={() =>
                                    setSelected((old) =>
                                      old.includes(s.id)
                                        ? old.filter((id) => id !== s.id)
                                        : [...old, s.id],
                                    )
                                  }
                                />
                                <span>{String(i + 1).padStart(2, "0")}</span>
                              </div>
                              <img
                                className="shot-image"
                                src={s.image}
                                alt={s.title}
                              />
                              <div className="shot-content">
                                <div className="row">
                                  <h2>{s.title}</h2>
                                  <button
                                    className="icon-button"
                                    aria-label={t(
                                      `编辑 ${s.title}`,
                                      `Edit ${s.title}`,
                                    )}
                                    onClick={() => {
                                      setEditBase(project.revision);
                                      setEdit(structuredClone(s));
                                    }}
                                  >
                                    <PencilSimple size={19} />
                                  </button>
                                </div>
                                <div className="tags">
                                  <span>{s.frame}</span>
                                  <span>{s.seconds} s</span>
                                  {s.locked && (
                                    <span
                                      title={t("台词已锁定", "Dialogue locked")}
                                    >
                                      <LockKey size={13} />
                                    </span>
                                  )}
                                </div>
                                <TimelineControls project={project} shot={s} index={i} lang={lang} busy={busy} submit={mutate}/>
                                <p>{s.description}</p>
                                <div
                                  className={`shot-status ${s.review === "accepted" ? "good" : ""}`}
                                >
                                  {s.review === "accepted" ? (
                                    <CheckCircle size={17} />
                                  ) : (
                                    <Clock size={17} />
                                  )}
                                  <span>
                                    {s.review === "accepted"
                                      ? t("已人工采纳", "Adopted")
                                      : s.candidates.length
                                        ? t("候选待复核", "Review candidate")
                                        : t("等待生成示例", "Awaiting sample")}
                                  </span>
                                </div>
                              </div>
                            </article>
                          ))}
                        </section>
                        <aside className="inspector">
                          <section className="panel reference">
                            <div className="row">
                              <h2>{t("角色参考", "Character reference")}</h2>
                              <LockKey size={17} />
                            </div>
                            <img
                              src={
                                project?.references?.at(-1)?.image ||
                                "/assets/rain-portrait.png"
                              }
                              alt={
                                project.references?.at(-1)?.name ||
                                t("内置示例参考", "Bundled sample reference")
                              }
                            />
                            <h3>
                              {project.references?.at(-1)?.name ||
                                t("林夏 · 示例", "Lin Xia · Sample")}
                              <span className="subtle-tag">
                                {t("主角", "LEAD")}
                              </span>
                            </h3>
                            <p>
                              {project.references?.at(-1)?.note ||
                                t(
                                  "21 岁 · 短发 · 摄影爱好者",
                                  "21 · Short hair · Photographer",
                                )}
                            </p>
                            <blockquote>
                              “{" "}
                              {t(
                                "有些照片，会记得我们。",
                                "Some photographs remember us.",
                              )}{" "}
                              ”
                            </blockquote>
                            <div className="reference-thumbs">
                              {project.shots.map((s) => (
                                <img key={s.id} src={s.image} alt={s.title} />
                              ))}
                            </div>
                            <button
                              className="secondary full"
                              onClick={() => go("characters")}
                            >
                              <Users size={17} />
                              {t("打开角色复核", "Review character")}
                            </button>
                            <small>
                              {t(
                                "参考图用于人工对照，不保证角色完全一致。",
                                "References support manual review; consistency is not guaranteed.",
                              )}
                            </small>
                          </section>
                          <div className="note">
                            <Eye size={21} />
                            <div>
                              <b>
                                {t(
                                  "先预演，再生成",
                                  "Preview before generation",
                                )}
                              </b>
                              <p>
                                {t(
                                  "修改镜头后需要重新确认预演。每个生成结果都由你决定是否采纳。",
                                  "Confirm your animatic after edits. You decide which results to keep.",
                                )}
                              </p>
                            </div>
                          </div>
                        </aside>
                      </div>
                    </>
                  )}
                  {page === "preview" && (
                    <>
                      <section className="page-heading">
                        <div>
                          <div className="eyebrow">ANIMATIC / 02</div>
                          <h1>
                            {t(
                              "先看见，故事的节奏。",
                              "Find the rhythm of your story.",
                            )}
                          </h1>
                          <p>
                            {t(
                              "静帧预演 · 无音轨 · 不调用模型",
                              "Still-image animatic · No audio · No model calls",
                            )}
                          </p>
                        </div>
                        <button
                          className="secondary"
                          onClick={() => go("storyboard")}
                        >
                          <ArrowLeft />
                          {t("返回分镜", "Back to storyboard")}
                        </button>
                      </section>
                      <div className="preview-layout">
                        <section>
                          <div className="screen">
                            <img
                              src={currentShot?.image}
                              alt={currentShot?.title}
                            />
                            <span className="screen-label">
                              {t("静帧预演", "STILL ANIMATIC")} /{" "}
                              {elapsed.toString().padStart(2, "0")} : {total}
                            </span>
                            <div className="subtitle">
                              {currentShot?.dialogue}
                            </div>
                            <button
                              className="play-round"
                              aria-label={
                                playing
                                  ? t("暂停预演", "Pause animatic")
                                  : t("播放预演", "Play animatic")
                              }
                              onClick={() => setPlaying(!playing)}
                            >
                              {playing ? (
                                <Pause size={30} weight="fill" />
                              ) : (
                                <Play size={30} weight="fill" />
                              )}
                            </button>
                          </div>
                          <div className="playback">
                            <button
                              className="icon-button"
                              aria-label={t("重新播放", "Restart")}
                              onClick={() => {
                                setElapsed(0);
                                setPlaying(true);
                              }}
                            >
                              <ArrowCounterClockwise size={21} />
                            </button>
                            <input
                              aria-label={t("预演进度", "Animatic position")}
                              type="range"
                              min="0"
                              max={total - 1}
                              value={elapsed}
                              onChange={(e) => setElapsed(+e.target.value)}
                            />
                            <span>
                              {elapsed}s / {total}s
                            </span>
                          </div>
                          <div className="timeline">
                            {project.shots.map((s, i) => (
                              <button
                                className={
                                  currentShot?.id === s.id ? "selected" : ""
                                }
                                key={s.id}
                                onClick={() => {
                                  setElapsed(
                                    project.shots
                                      .slice(0, i)
                                      .reduce((n, s) => n + s.seconds, 0),
                                  );
                                  setPlaying(false);
                                }}
                              >
                                <img src={s.image} alt="" />
                                <span>
                                  {String(i + 1).padStart(2, "0")} · {s.seconds}
                                  s
                                </span>
                              </button>
                            ))}
                          </div>
                        </section>
                        <aside className="panel preview-check">
                          <span className="eyebrow">DIRECTOR’S CHECK</span>
                          <h2>
                            {t("这一版，准备好了吗？", "Ready for this take?")}
                          </h2>
                          <p>
                            {t(
                              "检查节奏、台词与镜头描述后，确认当前版本，再运行示例任务。",
                              "Review pacing, dialogue and shot descriptions, then confirm this version to run sample jobs.",
                            )}
                          </p>
                          <div className="check-row">
                            <CheckCircle size={20} />
                            <span>
                              {project.shots.length} {t("个镜头", "shots")} ·{" "}
                              {total} {t("秒", "seconds")}
                            </span>
                          </div>
                          <div className="check-row">
                            <LockKey size={20} />
                            <span>
                              {project.shots.filter((s) => s.locked).length}{" "}
                              {t("段台词已锁定", "locked dialogue lines")}
                            </span>
                          </div>
                          <div className="check-row">
                            <Eye size={20} />
                            <span>
                              {t("当前输入版本", "Input version")} v
                              {project.inputRevision}
                            </span>
                          </div>
                          <button
                            className={
                              fresh ? "secondary full" : "primary full"
                            }
                            disabled={fresh || busy}
                            onClick={() =>
                              mutate("preview", {}).then(
                                (ok) =>
                                  ok &&
                                  setNotice(
                                    t(
                                      "当前分镜版本已确认",
                                      "Current storyboard confirmed",
                                    ),
                                  ),
                              )
                            }
                          >
                            {fresh ? (
                              <Check size={20} />
                            ) : (
                              <CheckCircle size={20} />
                            )}{" "}
                            {fresh
                              ? t("当前版本已确认", "Version confirmed")
                              : t("确认这版预演", "Confirm this animatic")}
                          </button>
                          <div className="divider" />
                          <small>
                            {t(
                              `已选 ${selected.length} 个镜头 · 模拟费用 ${money(selected.length * 240)}`,
                              `${selected.length} selected shots · Simulated cost ${money(selected.length * 240)}`,
                            )}
                          </small>
                          <button
                            className="primary full"
                            disabled={!fresh || !selected.length || busy}
                            onClick={() => setDialog("generate")}
                          >
                            <Play size={18} weight="fill" />
                            {t("运行示例生成", "Run sample generation")}
                          </button>
                          <p className="fine">
                            {t(
                              "示例任务使用内置图片，不会生成新画面或产生真实费用。",
                              "Sample jobs use bundled images. No new images or real charges.",
                            )}
                          </p>
                        </aside>
                      </div>
                    </>
                  )}
                  {page === "characters" && (
                    <>
                      <section className="page-heading">
                        <div>
                          <div className="eyebrow">CHARACTER REVIEW / 03</div>
                          <h1>
                            {t(
                              "让每一次出场，都像她。",
                              "The same character. Every scene.",
                            )}
                          </h1>
                          <p>
                            {t(
                              "逐镜人工对照 · 采纳决定由你完成",
                              "Compare each shot manually. You make the final call.",
                            )}
                          </p>
                        </div>
                        <span className="pill">
                          {accepted} / {project.shots.length}{" "}
                          {t("已采纳", "ADOPTED")}
                        </span>
                      </section>
                      <div className="review-tabs">
                        {project.shots.map((s, i) => (
                          <button
                            key={s.id}
                            className={reviewIndex === i ? "active" : ""}
                            onClick={() => {
                              setReviewIndex(i);
                              setChecks([false, false, false]);
                            }}
                          >
                            {String(i + 1).padStart(2, "0")} {s.title}
                            {s.review === "accepted" && <Check size={17} />}
                          </button>
                        ))}
                      </div>
                      <div className="review-layout">
                        <section className="compare-image">
                          <img
                            src={
                              project?.references?.at(-1)?.image ||
                              "/assets/rain-portrait.png"
                            }
                            alt={t("主角参考", "Character reference")}
                          />
                          <span>
                            {project.references?.at(-1)?.name ||
                              t(
                                "角色参考 · 林夏示例",
                                "REFERENCE · LIN XIA SAMPLE",
                              )}
                          </span>
                        </section>
                        <section className="compare-image wide">
                          {candidate?.video ? <video controls preload="metadata" src={candidate.video} aria-label={t('候选视频','Candidate video')}/> :
                          <img
                            src={candidate?.image || reviewShot?.image}
                            alt={reviewShot?.title}
                          />}
                          <span>
                            {candidate?.mode==='provider'?t('FlowBar 候选 · 请人工复核','FLOWBAR CANDIDATE · MANUAL REVIEW'):candidate
                              ? candidateAdopted
                                ? t(
                                    "示例候选 · 已人工采纳",
                                    "SAMPLE CANDIDATE · ADOPTED",
                                  )
                                : t(
                                    "示例候选 · 待人工判断",
                                    "SAMPLE CANDIDATE · MANUAL REVIEW",
                                  )
                              : t(
                                  "分镜示意 · 尚无候选",
                                  "STORYBOARD STILL · NO CANDIDATE",
                                )}
                          </span>
                        </section>
                        <aside className="panel review-check">
                          <h2>
                            {t(
                              "你来决定，这一镜。",
                              "Your frame. Your decision.",
                            )}
                          </h2>
                          <p>
                            {t(
                              "请目视检查以下细节。这里没有自动评分，也不作相似度保证。",
                              "Visually check the details below. There is no automated score or consistency guarantee.",
                            )}
                          </p>
                          {[
                            t("面部特征与发型", "Face and hairstyle"),
                            t(
                              "服装、道具与场景",
                              "Clothing, props and setting",
                            ),
                            t("表情与故事情绪", "Expression and story emotion"),
                          ].map((label, i) => (
                            <label className="review-checkbox" key={i}>
                              <input
                                type="checkbox"
                                checked={candidateAdopted || checks[i]}
                                disabled={candidateAdopted}
                                onChange={() =>
                                  setChecks((old) =>
                                    old.map((v, k) => (i === k ? !v : v)),
                                  )
                                }
                              />
                              {label}
                            </label>
                          ))}
                          <button
                            className="primary full"
                            disabled={
                              !candidate ||
                              checks.some((c) => !c) ||
                              busy ||
                              candidateAdopted
                            }
                            onClick={() =>
                              mutate("adopt", {
                                shotId: reviewShot?.id,
                                candidateId: candidate?.id,
                              }).then(
                                (ok) =>
                                  ok &&
                                  setNotice(t("已采纳此镜头", "Shot adopted")),
                              )
                            }
                          >
                            <Check size={20} />
                            {candidateAdopted
                              ? t("此镜头已采纳", "Shot adopted")
                              : t("采纳这个候选", "Adopt this candidate")}
                          </button>
                          {!candidate && (
                            <button
                              className="secondary full"
                              onClick={() => go("preview")}
                            >
                              {t("先运行示例生成", "Run a sample first")}
                              <ArrowRight />
                            </button>
                          )}
                          <small>
                            {t(
                              "采纳后才会计入可用成片时长。修改镜头内容后，需要重新生成和复核。",
                              "Only adopted shots count toward usable duration. Editing a shot requires generation and review again.",
                            )}
                          </small>
                        </aside>
                      </div>
                    </>
                  )}
                  {page === "progress" && (
                    <>
                      <section className="page-heading">
                        <div>
                          <div className="eyebrow">GENERATION / 04</div>
                          <h1>
                            {activeJob
                              ? t(
                                  "故事，正在慢慢显影。",
                                  "Your story is developing.",
                                )
                              : t(
                                  "每一步，都清清楚楚。",
                                  "Every step, in the open.",
                                )}
                          </h1>
                          <p>
                            {t(
                              "示例任务 · 预算数字仅用于演示",
                              "Sample jobs · Budget figures are simulated",
                            )}
                          </p>
                        </div>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            mutate("pause", { value: !project.paused })
                          }
                        >
                          {project.paused ? <Play /> : <Pause />}
                          {project.paused
                            ? t("恢复后续任务", "Resume queued jobs")
                            : t("暂停后续任务", "Pause queued jobs")}
                        </button>
                      </section>
                      <div className="progress-layout">
                        <section>
                          <div className="screen progress-screen">
                            <img
                              src={
                                project.shots.find(
                                  (s) => s.id === activeJob?.shotId,
                                )?.image || project.shots[0].image
                              }
                              alt={t(
                                "当前镜头示例画面",
                                "Current shot sample image",
                              )}
                            />
                            <span className="screen-label">
                              {t("内置示例画面", "BUNDLED SAMPLE IMAGE")}
                            </span>
                            <div className="progress-caption">
                              <h2>
                                {activeJob
                                  ? project.shots.find(
                                      (s) => s.id === activeJob.shotId,
                                    )?.title
                                  : project.title}
                              </h2>
                              <p>
                                {activeJob
                                  ? t(
                                      "正在运行本地模拟流程",
                                      "Running the local sample workflow",
                                    )
                                  : t(
                                      "你决定下一镜的方向。",
                                      "You direct the next frame.",
                                    )}
                              </p>
                            </div>
                          </div>
                          <div className="metrics">
                            <div>
                              <small>
                                {t("示例任务完成", "SAMPLE JOBS FINISHED")}
                              </small>
                              <strong>
                                {ready}
                                <em> / {project.jobs.length}</em>
                              </strong>
                            </div>
                            <div>
                              <small>{t("模拟已用", "SIMULATED SPEND")}</small>
                              <strong>{money(settled)}</strong>
                            </div>
                            <div>
                              <small>
                                {t("模拟预留", "SIMULATED RESERVED")}
                              </small>
                              <strong>{money(reserved)}</strong>
                            </div>
                          </div>
                          <div className="activity panel">
                            <h2>{t("最近活动", "Recent activity")}</h2>
                            {project.events.length ? (
                              project.events
                                .slice(-5)
                                .reverse()
                                .map((e) => (
                                  <div key={e.id}>
                                    <CheckCircle size={17} />
                                    <span>{e.text}</span>
                                    <time>
                                      {new Date(e.at).toLocaleTimeString(
                                        lang === "zh" ? "zh-CN" : "en-GB",
                                        { hour: "2-digit", minute: "2-digit" },
                                      )}
                                    </time>
                                  </div>
                                ))
                            ) : (
                              <p>
                                {t(
                                  "还没有任务，先确认分镜预演。",
                                  "No jobs yet. Confirm your animatic to begin.",
                                )}
                              </p>
                            )}
                          </div>
                        </section>
                        <aside className="panel stages">
                          <h2>{t("镜头队列", "Shot queue")}</h2>
                          <p>
                            {project.paused
                              ? t(
                                  "后续任务已暂停；进行中的任务会继续完成。",
                                  "Queued jobs paused. The running job will finish.",
                                )
                              : t(
                                  "逐镜运行，刷新页面也能继续。",
                                  "One shot at a time. Your progress survives a refresh.",
                                )}
                          </p>
                          {project.shots.map((s, i) => {
                            const job = project.jobs
                              .filter((j) => j.shotId === s.id)
                              .at(-1);
                            return (
                              <div
                                className={`stage ${job?.status === "running" ? "current" : ""}`}
                                key={s.id}
                              >
                                <span className="stage-number">
                                  {job?.status === "succeeded" ? (
                                    <Check size={18} />
                                  ) : (
                                    String(i + 1).padStart(2, "0")
                                  )}
                                </span>
                                <div>
                                  <h3>{s.title}</h3>
                                  <small>
                                    {job?.status === "succeeded"
                                      ? t(
                                          "示例候选已准备",
                                          "Sample candidate ready",
                                        )
                                      : job?.status === "running"
                                        ? t("模拟处理中", "Processing sample")
                                        : job?.status === "queued"
                                          ? t("排队中", "Queued")
                                          : job?.status === "unknown"
                                            ? t(
                                                "待核对",
                                                "Needs reconciliation",
                                              )
                                            : t("尚未提交", "Not submitted")}
                                  </small>
                                  {job?.status === "running" && (
                                    <progress max="4" value={job.stage} />
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          <button
                            className="primary full"
                            onClick={() => go(ready ? "characters" : "preview")}
                          >
                            {ready
                              ? t("复核生成候选", "Review candidates")
                              : t("前往分镜预演", "Open animatic")}
                            <ArrowRight size={20} />
                          </button>
                        </aside>
                      </div>
                    </>
                  )}
                  {page === "results" && (
                    <>
                      <section className="page-heading">
                        <div>
                          <div className="eyebrow">THE FINAL FRAME / 05</div>
                          <h1>
                            {t(
                              "好故事，值得被看见。",
                              "A good story deserves an audience.",
                            )}
                          </h1>
                          <p>
                            {t(
                              "把每一份投入，变成看得见的作品。",
                              "Make every frame—and every decision—count.",
                            )}
                          </p>
                        </div>
                        <span className="pill">
                          {t("示例项目", "SAMPLE PROJECT")}
                        </span>
                      </section>
                      <div className="results-layout">
                        <section className="poster">
                          <img
                            src={
                              project?.references?.at(-1)?.image ||
                              "/assets/rain-portrait.png"
                            }
                            alt={t(
                              "明日底片电影海报",
                              "Tomorrow’s Negative film poster",
                            )}
                          />
                          <div className="poster-title">
                            <small>A REELORI SAMPLE</small>
                            <h2>{project.title}</h2>
                            <p>
                              {project.id === "sample"
                                ? "TOMORROW’S NEGATIVE"
                                : "A STORY BY YOU"}
                            </p>
                            <span>
                              {t(
                                "有些相遇，会穿过时间。",
                                "Some encounters travel through time.",
                              )}
                            </span>
                          </div>
                        </section>
                        <section className="results-receipt">
                          <div className="receipt-heading">
                            <span className="eyebrow">PRODUCTION RECEIPT</span>
                            <h2>
                              {t("你的第一段故事。", "Your first story.")}
                            </h2>
                            <p>
                              {t(
                                `${accepted} / ${project.shots.length} 镜头已采纳`,
                                `${accepted} / ${project.shots.length} shots adopted`,
                              )}
                            </p>
                          </div>
                          <div className="receipt-total">
                            <span>{t("模拟总成本", "SIMULATED TOTAL")}</span>
                            <strong>{money(settled)}</strong>
                            <small>
                              {t(
                                `已核对美元费用 $${((project.provider?.jobs??[]).reduce((n,j)=>n+(j.actualMicros??0),0)/1000000).toFixed(4)} · 待核对预留 $${((project.provider?.jobs??[]).reduce((n,j)=>n+j.reservedMicros,0)/1000000).toFixed(4)}`,
                                `Reconciled USD $${((project.provider?.jobs??[]).reduce((n,j)=>n+(j.actualMicros??0),0)/1000000).toFixed(4)} · Reserved / unreconciled $${((project.provider?.jobs??[]).reduce((n,j)=>n+j.reservedMicros,0)/1000000).toFixed(4)}`,
                              )}
                            </small>
                          </div>
                          <dl className="receipt-lines">
                            <div>
                              <dt>{t("已采纳可用时长", "Adopted duration")}</dt>
                              <dd>{usable} s</dd>
                            </div>
                            <div>
                              <dt>{t("模拟预算上限", "Demo budget cap")}</dt>
                              <dd>{money(project.budgetCents)}</dd>
                            </div>
                            <div>
                              <dt>{t("任务预留", "Reserved for jobs")}</dt>
                              <dd>{money(reserved)}</dd>
                            </div>
                            <div>
                              <dt>
                                {t("可用模拟预算", "Available demo budget")}
                              </dt>
                              <dd>
                                {money(
                                  project.budgetCents - settled - reserved,
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt>
                                {t(
                                  "每可用秒模拟成本",
                                  "Simulated cost / usable second",
                                )}
                              </dt>
                              <dd>{usable ? money(settled / usable) : "—"}</dd>
                            </div>
                          </dl>
                          <RenderPanel
                            key={project.id}
                            project={project}
                            lang={lang}
                            request={projectApi}
                            onChange={acceptProject}
                          />
                          <button
                            className="secondary full large"
                            disabled={accepted !== project.shots.length || busy}
                            onClick={download}
                          >
                            <DownloadSimple size={21} />
                            {t("导出项目清单", "Export project manifest")}
                          </button>
                          <button
                            className="secondary full"
                            onClick={() =>
                              go(
                                accepted === project.shots.length
                                  ? "preview"
                                  : "characters",
                              )
                            }
                          >
                            {accepted === project.shots.length
                              ? t("回看分镜预演", "Watch the animatic")
                              : t("继续复核镜头", "Continue shot review")}
                            <ArrowRight />
                          </button>
                          <p className="fine">
                            {t(
                              "导出已采用的图片或视频、字幕与清单。内置示例和 FlowBar 候选分别标记；可选择静音或保留原视频声音。",
                              "Export adopted images or videos, subtitles and manifest. Bundled samples and FlowBar candidates are labeled separately. Choose silent output or keep source audio.",
                            )}
                          </p>
                        </section>
                      </div>
                    </>
                  )}
                  {page === "settings" && (
                    <>
                      <section className="page-heading">
                        <div>
                          <div className="eyebrow">YOUR STUDIO</div>
                          <h1>
                            {t(
                              "创作，由你掌控。",
                              "Your studio. Your control.",
                            )}
                          </h1>
                          <p>
                            {t(
                              "本地创作与示例免费；真实生成需单独确认美元预算与报价",
                              "Local editing and samples are free; live generation requires a USD budget and quote confirmation",
                            )}
                          </p>
                        </div>
                      </section>
                      <div className="settings-grid">
                        <ProviderPanel key={`provider-${project.id}`} project={project} lang={lang} request={projectApi} onChange={acceptProject}/>
                        <RuntimePanel key={`runtime-${project.id}`} lang={lang} request={projectApi}/>
                        <UpdatePanel lang={lang}/>
                        <BackupPanel key={project.id} project={project} lang={lang} request={projectApi} onRestored={selectProject}/>
                        <section className="panel">
                          <h2>{t("项目与数据", "Project and data")}</h2>
                          <dl className="receipt-lines">
                            <div>
                              <dt>{t("项目", "Project")}</dt>
                              <dd>{project.title}</dd>
                            </div>
                            <div>
                              <dt>{t("存储位置", "Storage")}</dt>
                              <dd>{t("本机 SQLite", "Local SQLite")}</dd>
                            </div>
                            <div>
                              <dt>{t("输入版本", "Input version")}</dt>
                              <dd>v{project.inputRevision}</dd>
                            </div>
                            <div>
                              <dt>{t("生成模式", "Generation mode")}</dt>
                              <dd>{project.provider?.jobs.length?t('包含真实模型任务','Includes provider jobs'):t("内置示例", "Bundled sample")}</dd>
                            </div>
                          </dl>
                          <details className="story-original">
                            <summary>
                              {t("查看完整原文", "View original story")}
                            </summary>
                            <p>{project.story}</p>
                          </details>
                          <button
                            className="secondary"
                            onClick={() => {
                              setBudget(String(project.budgetCents / 100));
                              setDialog("budget");
                            }}
                          >
                            {t("调整模拟预算", "Adjust demo budget")}
                          </button>
                        </section>
                        <section className="panel">
                          <h2>{t("模型连接", "Model connections")}</h2>
                          <span className="pill">
                            {t("独立确认费用", "EXPLICIT COST CONFIRMATION")}
                          </span>
                          <p>
                            {t(
                              "FlowBar 密钥只由本机服务读取；真实生成会发送已确认镜头的描述或对白。示例任务与真实美元费用分开记录，结果未知时不自动重提。配音（TTS）已接入阿里云智能语音交互，供应商随时可能更换或增加。",
                              "Only the local service reads the FlowBar key. Live generation sends the confirmed shot description or dialogue. Demo costs and USD bills stay separate; unknown outcomes are not automatically resubmitted. Voiceover (TTS) is connected via Aliyun Intelligent Speech Interaction; the provider may change or expand later.",
                            )}
                          </p>
                          <h3>{t("当前可体验", "Available now")}</h3>
                          <p>
                            {t(
                              "分镜编辑、锁定台词、预演确认、预算预留、示例任务、人工采纳和清单导出。",
                              "Shot editing, locked dialogue, animatic confirmation, budget reservation, sample jobs, manual adoption and manifest export.",
                            )}
                          </p>
                        </section>
                      </div>
                    </>
                  )}
                  <footer className="workspace-footer">
                    <span>
                      {t("本地工作区 · 自动保存", "LOCAL WORKSPACE · AUTO-SAVED")}
                    </span>
                    <span>
                      {t(
                        "用 AI，让一个普通人的故事，都有被看见的可能。",
                        "Every story deserves a chance to be seen.",
                      )}
                    </span>
                  </footer>
                </>
              )}
            </main>
          </div>
        </div>
      )}
      {error && (
        <div className="toast error" role="alert">
          <WarningCircle size={21} />
          <span>{error}</span>
          <button
            aria-label={t("关闭错误", "Dismiss error")}
            onClick={() => setError("")}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle size={20} />
          {notice}
        </div>
      )}
      <dialog
        ref={modalRef}
        onCancel={closeModal}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}
      >
        <div className="modal">
          <button
            className="modal-close icon-button"
            aria-label={t("关闭窗口", "Close dialog")}
            onClick={closeModal}
          >
            <X size={23} />
          </button>
          {edit && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await mutate("shot", {
                    revision: editBase,
                    id: edit.id,
                    patch: {
                      title: edit.title,
                      description: edit.description,
                      dialogue: edit.dialogue,
                      seconds: edit.seconds,
                      frame: edit.frame,
                      locked: edit.locked,
                    },
                  })
                ) {
                  closeModal();
                  setNotice(
                    t(
                      "镜头已保存，请重新确认预演",
                      "Shot saved. Please reconfirm the animatic.",
                    ),
                  );
                }
              }}
            >
              <div className="eyebrow">EDIT SHOT</div>
              <h2>{t("雕琢这一镜", "Refine this shot")}</h2>
              <label>
                {t("镜头名称", "Shot title")}
                <input
                  required
                  maxLength={80}
                  value={edit.title}
                  onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                />
              </label>
              <label>
                {t("画面描述", "Scene description")}
                <textarea
                  required
                  maxLength={2000}
                  rows={3}
                  value={edit.description}
                  onChange={(e) =>
                    setEdit({ ...edit, description: e.target.value })
                  }
                />
              </label>
              <label>
                {t("台词", "Dialogue")}
                <textarea
                  maxLength={2000}
                  rows={2}
                  value={edit.dialogue}
                  onChange={(e) =>
                    setEdit({ ...edit, dialogue: e.target.value })
                  }
                />
              </label>
              <div className="form-row">
                <label>
                  {t("时长（秒）", "Duration (seconds)")}
                  <input
                    type="number"
                    min="2"
                    max="10"
                    required
                    value={edit.seconds}
                    onChange={(e) =>
                      setEdit({ ...edit, seconds: +e.target.value })
                    }
                  />
                </label>
                <label>
                  {t("景别", "Framing")}
                  <select
                    value={edit.frame}
                    onChange={(e) =>
                      setEdit({ ...edit, frame: e.target.value })
                    }
                  >
                    <option value="远景">{t("远景", "Wide")}</option>
                    <option value="中景">{t("中景", "Medium")}</option>
                    <option value="特写">{t("特写", "Close-up")}</option>
                  </select>
                </label>
              </div>
              <label className="review-checkbox">
                <input
                  type="checkbox"
                  checked={edit.locked}
                  onChange={(e) =>
                    setEdit({ ...edit, locked: e.target.checked })
                  }
                />
                {t(
                  "锁定台词，阻止 AI 自动改写",
                  "Lock dialogue against AI rewrites",
                )}
              </label>
              <button className="primary full" disabled={busy} type="submit">
                {t("保存镜头", "Save shot")}
                <Check size={19} />
              </button>
            </form>
          )}
          {dialog === "budget" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await mutate("budget", {
                    cents: Math.round(Number(budget) * 100),
                  })
                )
                  closeModal();
              }}
            >
              <div className="eyebrow">BUDGET CONTROL</div>
              <h2>{t("先定预算，再放心创作。", "Set your budget first.")}</h2>
              <p>
                {t(
                  "此处数字仅用于演示预算保护，不代表模型实际报价。",
                  "These figures demonstrate budget protection and are not provider prices.",
                )}
              </p>
              <label>
                {t("模拟预算上限（元）", "Demo budget cap (CNY)")}
                <input
                  type="number"
                  min={(settled + reserved) / 100}
                  max="10000"
                  step="0.01"
                  required
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </label>
              <p>
                {t("已结算与预留合计", "Settled and reserved")}:{" "}
                {money(settled + reserved)}
              </p>
              <button className="primary full" disabled={busy}>
                {t("保存预算", "Save budget")}
              </button>
            </form>
          )}
          {dialog === "generate" && (
            <>
              <div className="eyebrow">SAMPLE GENERATION</div>
              <h2>
                {t(
                  "让分镜，走完一遍流程。",
                  "Take the storyboard through the workflow.",
                )}
              </h2>
              <p>
                {t(
                  "将使用内置示例图片，演示排队、预算预留、生成完成和候选采纳。不会请求外部模型。",
                  "Bundled sample images demonstrate queuing, budget reservation, completion and candidate adoption. No external model is called.",
                )}
              </p>
              <dl className="receipt-lines">
                <div>
                  <dt>{t("选择镜头", "Selected shots")}</dt>
                  <dd>{selected.length}</dd>
                </div>
                <div>
                  <dt>{t("模拟预算预留", "Demo reservation")}</dt>
                  <dd>{money(selected.length * 240)}</dd>
                </div>
                <div>
                  <dt>{t("真实费用", "Real charges")}</dt>
                  <dd>¥0.00</dd>
                </div>
              </dl>
              <button
                className="primary full"
                disabled={busy}
                onClick={async () => {
                  if (
                    await mutate("generate", {
                      ids: selected,
                      operationId: crypto.randomUUID(),
                    })
                  ) {
                    closeModal();
                    go("progress");
                  }
                }}
              >
                <Play weight="fill" size={18} />
                {t("确认运行示例", "Confirm sample run")}
              </button>
            </>
          )}
          {error && (edit || dialog) && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </dialog>
    </div>
  );
}
