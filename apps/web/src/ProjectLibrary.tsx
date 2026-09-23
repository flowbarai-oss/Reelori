import { useEffect, useRef, useState } from "react";
import {
  Plus,
  ArrowRight,
  FolderOpen,
  X,
  UploadSimple,
} from "@phosphor-icons/react";
import type { Project } from "../../../packages/contracts/index.ts";
type Item = { id: string; title: string; story: string };
export function ProjectLibrary({
  open,
  onClose,
  onSelect,
  request,
  lang,
  activeId,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (p: Project) => void;
  request: (path: string, body?: unknown) => Promise<any>;
  lang: string;
  activeId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [title, setTitle] = useState("");
  const [story, setStory] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  useEffect(() => {
    if (open) {
      ref.current?.showModal();
      request("projects")
        .then(setItems)
        .catch((e) => setError(e.message));
    } else ref.current?.close();
  }, [open]);
  return (
    <dialog ref={ref} className="library-dialog" onCancel={onClose}>
      <div className="library-shell">
        <button
          className="modal-close icon-button"
          aria-label={t("关闭项目库", "Close project library")}
          onClick={onClose}
        >
          <X size={23} />
        </button>
        <div className="eyebrow">REELORI / YOUR STORIES</div>
        <h2>{t("下一个故事，从这里萌芽。", "Your next story starts here.")}</h2>
        <div className="library-grid">
          <section>
            <h3>
              <FolderOpen size={20} /> {t("我的项目", "My projects")}
            </h3>
            <div className="project-list">
              {items.map((item) => (
                <button
                  className={`project-item ${item.id === activeId ? "current" : ""}`}
                  key={item.id}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      onSelect(
                        await request(
                          `project?projectId=${encodeURIComponent(item.id)}`,
                        ),
                      );
                      onClose();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.story}</small>
                  </span>
                  {item.id === activeId ? (
                    <span className="pill">{t("当前", "OPEN")}</span>
                  ) : (
                    <ArrowRight size={20} />
                  )}
                </button>
              ))}
            </div>
          </section>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const p = await request("projects", {
                  title,
                  story,
                  sourceName: source || "pasted",
                });
                onSelect(p);
                setTitle("");
                setStory("");
                setSource("");
                onClose();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3>
              <Plus size={20} />
              {t("新建故事", "New story")}
            </h3>
            <label>
              {t("项目名称", "Project name")}
              <input
                value={title}
                maxLength={80}
                required
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("给故事一个名字", "Give your story a name")}
              />
            </label>
            <label>
              {t("故事原文", "Original story")}
              <textarea
                value={story}
                required
                maxLength={40000}
                rows={7}
                onChange={(e) => {
                  setStory(e.target.value);
                  setSource("");
                }}
                placeholder={t(
                  "粘贴故事。用空行分段，可生成 3–6 个可编辑镜头。",
                  "Paste your story. Blank lines separate 3–6 editable shots.",
                )}
              />
            </label>
            <div className="import-row">
              <label className="file-button secondary">
                <UploadSimple size={18} />
                {t("导入文本", "Import text")}
                <input
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  aria-label={t("导入 UTF-8 文本", "Import UTF-8 text")}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      if (f.size > 160000)
                        throw new Error(
                          t(
                            "文件过大，最多 160 KB",
                            "File too large; maximum 160 KB",
                          ),
                        );
                      const value = new TextDecoder("utf-8", {
                        fatal: true,
                      }).decode(await f.arrayBuffer());
                      if (value.length > 40000 || value.includes("\0"))
                        throw new Error(
                          t(
                            "原文最多 40,000 字，不支持二进制文件",
                            "Maximum 40,000 characters; binary files are unsupported",
                          ),
                        );
                      setStory(value);
                      setSource(f.name);
                      if (!title)
                        setTitle(
                          f.name.replace(/\.(txt|md)$/i, "").slice(0, 80),
                        );
                      setError("");
                    } catch (err) {
                      setError(
                        t(
                          "导入失败，已保留编辑内容：",
                          "Import failed; your draft is preserved: ",
                        ) + (err as Error).message,
                      );
                    }
                    e.target.value = "";
                  }}
                />
              </label>
              <small>{story.length.toLocaleString()} / 40,000</small>
            </div>
            <p className="fine">
              {t(
                "原文完整保留。按段落整理草稿，不调用 AI；过长或超过 6 段时保留原文，镜头留待手动填写。画面暂用内置占位图。",
                "The original stays intact. Paragraph drafting uses no AI. Long text or more than 6 paragraphs stays in the original for manual shot editing. Images are sample placeholders.",
              )}
            </p>
            {source && <p className="fine">{source}</p>}
            <button
              className="primary"
              disabled={busy || !title.trim() || !story.trim()}
            >
              {busy
                ? t("正在保存…", "Saving…")
                : t("创建并进入工作台", "Create and open studio")}
              <ArrowRight size={18} />
            </button>
          </form>
        </div>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}
