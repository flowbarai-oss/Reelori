import { useEffect, useRef, useState } from "react";
import type { Project } from "../../../packages/contracts/index.ts";
import type {
  ProviderQuote,
  ProviderJob,
} from "../../../packages/providers/contracts.ts";
import { ModelRouteManager, type ModelConnection } from "./ModelRouteManager";
export function ProviderPanel({
  project,
  lang,
  request,
  onChange,
}: {
  project: Project;
  lang: string;
  request: (path: string, body?: unknown) => Promise<any>;
  onChange: (p: Project) => void;
}) {
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en),
    usd = (n: number) => `$${(n / 1000000).toFixed(4)}`;
  const [connection, setConnection] = useState<ModelConnection | null>(null),
    [route, setRoute] = useState(""),
    [shot, setShot] = useState(project.shots[0].id),
    [budget, setBudget] = useState(
      String((project.provider?.budgetMicros ?? 0) / 1000000),
    ),
    [quote, setQuote] = useState<ProviderQuote | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [billJob, setBillJob] = useState(""),
    [bill, setBill] = useState(""),
    [evidence, setEvidence] = useState("");
  const live = useRef(true),
    operation = useRef("");
  useEffect(() => {
    live.current = true;
    request("provider")
      .then((c) => {
        if (live.current) {
          setConnection(c);
          setRoute(c.routes[0]?.id ?? "");
        }
      })
      .catch(() => {
        if (live.current)
          setError(t("无法读取连接状态", "Connection status unavailable"));
      });
    return () => {
      live.current = false;
    };
  }, []);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (live.current) setError((e as Error).message);
      try {
        const fresh = await request("project");
        if (live.current) onChange(fresh);
      } catch {}
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function update(path: string, body: unknown) {
    const next = await request(path, body);
    if (live.current) onChange(next);
    return next as Project;
  }
  const jobs = project.provider?.jobs ?? [],
    actual = jobs.reduce((n, j) => n + (j.actualMicros ?? 0), 0),
    reserved = jobs.reduce((n, j) => n + j.reservedMicros, 0);
  const selectedProvider = connection?.routes.find(
    (item) => item.id === route,
  )?.provider;
  const routeKeyConfigured =
    selectedProvider === "aliyun"
      ? connection?.credentials?.aliyun
      : selectedProvider?.startsWith("minimax")
        ? connection?.credentials?.minimax
        : connection?.credentials?.flowbar;
  const states: Record<ProviderJob["state"], string> = {
    reserved: t("已预留，尚未提交", "Reserved, not submitted"),
    submitting: t("正在提交", "Submitting"),
    running: t("远端执行中", "Running remotely"),
    succeeded: t("候选已入库", "Candidate saved"),
    failed: t("执行失败", "Execution failed"),
    unknown: t("结果待核对，禁止重提", "Unknown; no automatic resubmit"),
  };
  return (
    <section className="panel provider-panel">
      <h2>{t("模型连接 · 真实生成", "Model connections · Live generation")}</h2>
      <p>
        {t(
          "接入文生图、5 秒文生视频与镜头对白配音（TTS）；参考图暂不发送。协议已完成本地测试，真实模型质量与账单仍待验收。",
          "Text-to-image, 5-second text-to-video, and per-shot dialogue voiceover (TTS). References are not sent. Protocol fixtures passed; live quality and billing still need validation.",
        )}
      </p>
      <aside
        className="flowbar-bridge"
        aria-label={t("FlowBarAI 国际站与 GEN 站", "FlowBarAI international and GEN Studio")}
      >
        <span className="flowbar-bridge-kicker">FLOWBARAI · INTERNATIONAL</span>
        <h3>
          {t(
            "用国际站 API Key 连接 FlowBar 路线",
            "Connect FlowBar routes with an international API key",
          )}
        </h3>
        <p>
          {t(
            "FlowBar 路线固定连接 api.flowbarai.com/v1。请在 flowbarai.com 创建 Key，并仅在本机服务中配置；国内站凭据不会自动切换。也可前往 GEN 站体验在线创作。",
            "FlowBar routes use api.flowbarai.com/v1 only. Create a key at flowbarai.com and configure it in the local service. There is no automatic switch to the China site. Explore online creation at GEN Studio.",
          )}
        </p>
        <p className="flowbar-bridge-status" role="status">
          {!connection?.credentials
            ? t(
                "本机服务重启后可显示国际站 Key 配置状态。",
                "Restart the local service to show international key status.",
              )
            : connection.credentials.flowbar
              ? t(
                  "国际站 Key 已在本机配置，权限尚待实际请求验证。",
                  "International key configured locally; access has not been verified by a live request.",
                )
              : t("尚未配置国际站 Key。", "International key not configured yet.")}
        </p>
        <div className="flowbar-bridge-links">
          <a href="https://flowbarai.com/" target="_blank" rel="noopener noreferrer">
            {t("前往 FlowBarAI 国际站获取 Key ↗", "Get a key at FlowBarAI ↗")}
          </a>
          <a href="https://gen.flowbarai.com/" target="_blank" rel="noopener noreferrer">
            {t("探索 FlowBarAI GEN 创作站 ↗", "Explore FlowBarAI GEN Studio ↗")}
          </a>
        </div>
      </aside>
      {connection && Array.isArray(connection.catalogRoutes) ? (
        <ModelRouteManager
          connection={connection}
          lang={lang}
          request={request}
          onSaved={(next) => {
            setConnection(next);
            setQuote(null);
            setRoute((current) =>
              next.routes.some((item) => item.id === current)
                ? current
                : (next.routes[0]?.id ?? ""),
            );
          }}
        />
      ) : connection ? (
        <p className="fine">{t("请重启本机服务以启用模型组管理。", "Restart the local service to enable model route management.")}</p>
      ) : null}
      <p>
        {connection?.configured && connection.keyConfigured
          ? t("本机已有服务商凭据；请按模型路线核对。", "At least one provider credential is configured locally; check the selected route.")
          : t(
              "尚未配置连接：请在本机设置对应服务商密钥，模型路线可在上方管理；修改密钥后重启。密钥不进入浏览器或备份。",
              "Connection not configured: set the provider key locally and manage routes above; restart after changing keys. Keys stay out of the browser and backups.",
            )}
      </p>
      <p>
        {t("已核对美元费用", "Reconciled USD")} {usd(actual)} ·{" "}
        {t("预留/待核对", "Reserved / unreconciled")} {usd(reserved)}
      </p>
      <label>
        {t("项目美元预算上限", "Project USD budget")}
        <input
          type="number"
          min="0"
          max="1000"
          step="0.01"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </label>
      <button
        className="secondary"
        disabled={busy}
        onClick={() =>
          act(async () => {
            await update("provider-budget", {
              micros: Math.round(Number(budget) * 1000000),
              revision: project.revision,
            });
          })
        }
      >
        {t("批准预算上限", "Approve budget cap")}
      </button>
      <label>
        {t("模型路线", "Model route")}
        <select
          value={route}
          disabled={busy}
          onChange={(e) => {
            setRoute(e.target.value);
            setQuote(null);
          }}
        >
          <option value="">
            {t(
              "等待有效配置与价格",
              "Awaiting valid configuration and pricing",
            )}
          </option>
          {connection?.routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.model} · {r.kind} · {r.size}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("生成镜头", "Shot to generate")}
        <select
          value={shot}
          disabled={busy}
          onChange={(e) => {
            setShot(e.target.value);
            setQuote(null);
          }}
        >
          {project.shots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} · {s.seconds}s
            </option>
          ))}
        </select>
      </label>
      <button
        className="secondary"
        disabled={busy || !route || !(routeKeyConfigured ?? connection?.keyConfigured)}
        onClick={() =>
          act(async () => {
            const q = await request("provider-quote", {
              routeId: route,
              shotId: shot,
              revision: project.revision,
            });
            if (live.current) {
              operation.current = crypto.randomUUID();
              setQuote(q);
            }
          })
        }
      >
        {t("查看本次报价", "Review this quote")}
      </button>
      {quote && (
        <div className="restore-summary">
          <strong>
            {quote.input.model} · {usd(quote.upperMicros)}
          </strong>
          <p>
            {quote.input.kind === "audio"
              ? t(
                  "费用预留基于本机已核实的价格配置；不保证供应商账单不会超出。确认后将把下面这句对白发送给语音合成服务，可能产生真实费用。",
                  "Reservation uses locally verified pricing; provider overruns remain possible. Confirmation sends the dialogue line below to the speech synthesis service and may incur real charges.",
                )
              : t(
                  "费用预留基于本机已核实的价格配置；不保证供应商账单不会超出。确认后将向服务商发送此镜头描述，可能产生真实费用。",
                  "Reservation uses locally verified pricing; provider overruns remain possible. Confirmation sends this shot description to the provider and may incur real charges.",
                )}
          </p>
          <p>{quote.input.prompt}</p>
          {quote.billingNote && <p className="fine">{quote.billingNote}</p>}
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const next = await update("provider-submit", {
                  quoteId: quote.id,
                  operationId: operation.current,
                  revision: project.revision,
                });
                const job = next.provider!.jobs.find(
                  (j) => j.operationId === operation.current,
                )!;
                if (live.current) setQuote(null);
                await update("provider-run", { jobId: job.id });
              })
            }
          >
            {t("确认费用并生成此镜头", "Confirm cost and generate this shot")}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {busy && (
        <p role="status">
          {t(
            "正在处理；远端任务不会因关闭页面而取消。",
            "Working; closing the page does not cancel a remote task.",
          )}
        </p>
      )}
      <ul className="provider-jobs">
        {jobs
          .slice()
          .reverse()
          .map((j) => (
            <li key={j.id}>
              <strong>
                {
                  project.shots.find((s) => s.id === j.quote.input.shotId)
                    ?.title
                }{" "}
                · {j.quote.input.model}
              </strong>
              {j.quote.billingNote && (
                <p className="fine">{j.quote.billingNote}</p>
              )}
              <p>
                {states[j.state]} ·{" "}
                {j.actualMicros === null
                  ? t("账单待核对", "Bill unreconciled")
                  : usd(j.actualMicros)}
              </p>
              {j.errorCode && (
                <p className="fine">
                  {j.errorCode === "provider_http_401"
                    ? t(
                        "服务拒绝了本次鉴权，请检查该模型渠道。未自动重试，费用保留待核对。",
                        "The service rejected authentication. Check this model route. No automatic retry; billing remains unreconciled.",
                      )
                    : t(
                        "请求未完成，费用保留待核对。",
                        "Request incomplete; billing remains unreconciled.",
                      )}{" "}
                  · {j.errorCode}
                </p>
              )}
              {j.recoveryBlocked ? (
                <p>
                  {t(
                    "备份副本仅保留记录，不继续远端任务。",
                    "Restored copy keeps records without resuming remote work.",
                  )}
                </p>
              ) : (
                !["succeeded", "failed"].includes(j.state) && (
                  <button
                    className="secondary"
                    disabled={busy || (!j.upstreamId && j.state === "unknown")}
                    onClick={() =>
                      act(async () => {
                        await update("provider-run", { jobId: j.id });
                      })
                    }
                  >
                    {j.state === "reserved"
                      ? t("执行已批准任务", "Run approved job")
                      : t("查询原任务", "Query original job")}
                  </button>
                )
              )}
              {j.resultVideo && (
                <video
                  controls
                  preload="metadata"
                  src={j.resultVideo}
                  aria-label={t("生成候选视频", "Generated candidate video")}
                />
              )}
              {j.state === "reserved" && !j.recoveryBlocked && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await update("provider-cancel", {
                        jobId: j.id,
                        revision: project.revision,
                      });
                    })
                  }
                >
                  {t("取消未提交任务", "Cancel unsubmitted job")}
                </button>
              )}
              {j.resultImage && !j.resultVideo && (
                <img
                  className="provider-image"
                  src={j.resultImage}
                  alt={t("生成候选图片", "Generated candidate image")}
                />
              )}
              {j.resultAudio && (
                <>
                  <audio
                    controls
                    preload="metadata"
                    src={j.resultAudio}
                    aria-label={t("生成的配音", "Generated voiceover")}
                  />
                  <p>{t("试听后明确采用；同镜旧配音将移出当前编排，原文件和历史保留。", "Preview, then adopt. This replaces the same shot's voice in the current arrangement; files and history remain.")}</p>
                  <button className="secondary" disabled={busy} onClick={() => act(async () => { await update("provider-audio-adopt", {jobId:j.id, revision:project.revision}); })}>
                    {project.audioTracks?.some(track => track.id === j.id) ? t("已采用 · 重新应用", "Adopted · apply again") : t("采用 / 替换该镜配音", "Adopt / replace shot voice")}
                  </button>
                </>
              )}
              {j.state === "succeeded" && j.quote.input.kind !== "audio" && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await update("adopt", {
                        shotId: j.quote.input.shotId,
                        candidateId: j.id,
                        revision: project.revision,
                      });
                    })
                  }
                >
                  {t("人工采纳此候选", "Adopt this candidate")}
                </button>
              )}
              {["succeeded", "failed", "unknown"].includes(j.state) &&
                j.actualMicros === null && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setBillJob(j.id)}
                  >
                    {t("核对账单", "Reconcile bill")}
                  </button>
                )}
            </li>
          ))}
      </ul>
      {billJob && (
        <div className="restore-summary">
          <label>
            {t("账单实付美元", "Actual billed USD")}
            <input
              type="number"
              min="0"
              step="0.000001"
              value={bill}
              onChange={(e) => setBill(e.target.value)}
            />
          </label>
          <label>
            {t(
              "账单编号或核对依据（不要填密钥）",
              "Bill reference or evidence (no secrets)",
            )}
            <input
              maxLength={500}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </label>
          <button
            className="secondary"
            disabled={busy || bill === "" || !evidence.trim()}
            onClick={() =>
              act(async () => {
                await update("provider-reconcile", {
                  jobId: billJob,
                  actualMicros: Math.round(Number(bill) * 1000000),
                  evidence,
                  revision: project.revision,
                });
                if (live.current) {
                  setBillJob("");
                  setBill("");
                  setEvidence("");
                }
              })
            }
          >
            {t(
              "记录实账并结清预留",
              "Record actual bill and settle reservation",
            )}
          </button>
        </div>
      )}
    </section>
  );
}
