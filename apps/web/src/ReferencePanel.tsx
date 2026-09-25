import { useState } from "react";
import { UploadSimple } from "@phosphor-icons/react";
import type { Project } from "../../../packages/contracts/index.ts";
export function ReferencePanel({
  project,
  lang,
  save,
  busy,
}: {
  project: Project;
  lang: string;
  save: (body: object) => Promise<boolean>;
  busy: boolean;
}) {
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [name, setName] = useState("");
  const [rights, setRights] = useState("owned");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [base, setBase] = useState(project.revision);
  const [loading, setLoading] = useState(false);
  return (
    <details className="reference-manager panel">
      <summary>
        <UploadSimple size={20} />
        {t("参考素材与来源", "References & provenance")}
        <span className="pill">v{project.referenceRevision}</span>
      </summary>
      <div className="reference-content">
        <div>
          <h3>{t("上传新参考版本", "Upload a new reference")}</h3>
          <p className="fine">
            {t(
              "上传新参考后，需重新确认预演并复核新候选；旧参考和候选保留。仅当你在 MiniMax 中国端点 H3 报价中选中图片并确认授权时，才会发送该图；内置示例生成不会使用上传图。",
              "A new reference requires a fresh animatic confirmation and candidate review; earlier versions remain. Your image is sent only if you select it in a MiniMax CN H3 quote and confirm your rights. Sample generation does not use uploads.",
            )}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!file) return;
              setLoading(true);
              setError("");
              try {
                const bytes = new Uint8Array(await file.arrayBuffer());
                let binary = "";
                for (const b of bytes) binary += String.fromCharCode(b);
                if (
                  await save({
                    revision: base,
                    name,
                    rights,
                    note,
                    data: btoa(binary),
                  })
                ) {
                  setFile(null);
                  setName("");
                  setNote("");
                  (e.target as HTMLFormElement).reset();
                } else setBase(project.revision);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setLoading(false);
              }
            }}
          >
            <label>
              {t("参考名称", "Reference name")}
              <input
                value={name}
                required
                maxLength={80}
                onChange={(e) => {
                  if (!name && !file) setBase(project.revision);
                  setName(e.target.value);
                }}
              />
            </label>
            <label>
              {t("PNG / JPEG，最大 5 MB", "PNG / JPEG, up to 5 MB")}
              <input
                type="file"
                accept="image/png,image/jpeg"
                required
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && f.size > 5 * 1024 * 1024) {
                    setError(t("图片最大 5 MB", "Maximum image size is 5 MB"));
                    setFile(null);
                    e.target.value = "";
                    return;
                  }
                  setFile(f ?? null);
                  setBase(project.revision);
                  setError("");
                }}
              />
            </label>
            <label>
              {t("素材来源", "Source")}
              <select
                value={rights}
                onChange={(e) => setRights(e.target.value)}
              >
                <option value="owned">
                  {t("我拥有版权", "I own the rights")}
                </option>
                <option value="licensed">
                  {t("已获得授权", "Licensed to me")}
                </option>
                <option value="generated">
                  {t("AI 生成", "AI generated")}
                </option>
              </select>
            </label>
            <label>
              {t("来源与使用权说明", "Source and usage rights")}
              <textarea
                value={note}
                required
                maxLength={500}
                rows={2}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t(
                  "记录作者、授权范围或生成工具；声明不代表平台已核实权利",
                  "Record author, permission or generation tool. This declaration is not rights verification.",
                )}
              />
            </label>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <button className="primary" disabled={!file || busy || loading}>
              {loading
                ? t("正在检查图片…", "Checking image…")
                : t("保存为新版本", "Save as new version")}
            </button>
          </form>
        </div>
        <div className="reference-history">
          <h3>{t("版本记录", "Version history")}</h3>
          {!project.references?.length && (
            <p className="fine">
              {t(
                "当前使用项目内置的 AI 生成参考。",
                "Using the bundled AI-generated reference.",
              )}
            </p>
          )}
          {[...(project.references ?? [])].reverse().map((ref, i) => (
            <article key={ref.id}>
              <img src={ref.image} alt={ref.name} />
              <div>
                <strong>{ref.name}</strong>
                <span className="pill">v{project.referenceRevision - i}</span>
                <p>{ref.note}</p>
                <small>
                  {new Date(ref.createdAt).toLocaleDateString(
                    lang === "zh" ? "zh-CN" : "en-US",
                  )}{" "}
                  · {ref.rights}
                </small>
              </div>
            </article>
          ))}
        </div>
      </div>
    </details>
  );
}
