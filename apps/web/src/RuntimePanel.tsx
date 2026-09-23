import { useEffect, useRef, useState } from "react";
import { Heartbeat } from "@phosphor-icons/react";
import { requestRuntimeCheck } from './runtime-client';
import type {
  RuntimeReport,
  RuntimeCheck,
} from "../../../packages/media/diagnostics.ts";

export function RuntimePanel({
  lang,
  request,
}: {
  lang: string;
  request: (route: string, body?: unknown) => Promise<any>;
}) {
  const [report, setReport] = useState<RuntimeReport | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const labels: Record<RuntimeCheck["id"], string> = {
    node: t("运行环境", "Runtime"),
    database: t("项目数据库", "Project database"),
    storage: t("导出目录", "Export storage"),
    space: t("可用空间", "Available space"),
    encoder: t("视频合成工具", "Video encoder"),
  };
  const status = {
    pass: t("通过", "Passed"),
    warn: t("需留意", "Attention"),
    fail: t("未通过", "Failed"),
    skipped: t("未检查", "Not checked"),
  };
  const guidance: Record<RuntimeCheck["id"], string> = {
    node: t(
      "需要 Node.js 24.12 或更新版本。",
      "Node.js 24.12 or newer is required.",
    ),
    database: t(
      "请保留数据文件，并停止编辑后检查数据库；不要删除项目数据。",
      "Keep your data files and inspect the database before editing; do not delete project data.",
    ),
    storage: t(
      "请检查导出目录的写入权限及临时文件清理情况。",
      "Check export directory permissions and temporary-file cleanup.",
    ),
    space: t(
      "建议至少保留 512 MiB 空间；实际需求取决于作品。",
      "Keep at least 512 MiB free; actual needs depend on the project.",
    ),
    encoder: t(
      "请配置支持 libx264 的 FFmpeg，详见项目启动说明。",
      "Configure FFmpeg with libx264 support; see the project setup guide.",
    ),
  };
  async function check() {
    setBusy(true);
    setError(false);
    setReport(null);
    try {
      const result = await requestRuntimeCheck(request);
      if (live.current) setReport(result);
    } catch {
      if (live.current) setError(true);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <section className="panel runtime-panel">
      <h2>
        <Heartbeat size={22} />
        {t("本机运行检查", "Local readiness")}
      </h2>
      <p>
        {t(
          "检查项目存储，并用一帧画面试运行视频合成工具。不会修改作品或调用外部模型。",
          "Check project storage and encode one test frame. Projects stay unchanged and no external model is called.",
        )}
      </p>
      <button className="secondary" disabled={busy} onClick={check}>
        {busy
          ? t("正在检查…", "Checking…")
          : t("检查本机环境", "Check this computer")}
      </button>
      <div aria-live="polite">
        {error && (
          <p role="alert">
            {t(
              "检查请求失败，请确认本地服务仍在运行，然后重试。",
              "Check failed. Make sure the local service is running, then retry.",
            )}
          </p>
        )}
        {report && (
          <>
            <p>
              {report.ready
                ? t("基础检查已通过", "Basic checks passed")
                : t("有项目需要处理", "Some checks need attention")}{" "}
              ·{" "}
              {new Date(report.checkedAt).toLocaleTimeString(
                lang === "zh" ? "zh-CN" : "en-US",
              )}
            </p>
            <ul className="runtime-checks">
              {report.checks.map((c) => (
                <li key={c.id}>
                  <div>
                    <strong>{labels[c.id]}</strong>
                    <span className={`check-${c.status}`}>
                      {status[c.status]}
                    </span>
                  </div>
                  {c.value !== undefined && (
                    <small>
                      {c.id === "space"
                        ? `${(Number(c.value) / 1024 ** 3).toFixed(1)} GiB`
                        : c.value}
                    </small>
                  )}
                  {c.status !== "pass" && <p>{guidance[c.id]}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <small>
        {t(
          "结果缓存 30 秒。基础检查不代表完整渲染保证；视频工具和空间状态可能变化。",
          "Results are cached for 30 seconds. Basic checks do not guarantee a full render; tools and free space may change.",
        )}
      </small>
    </section>
  );
}
