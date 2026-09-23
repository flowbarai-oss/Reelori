import { useState } from "react";

export type ModelRoute = {
  id: string;
  provider: "flowbar" | "minimax" | "minimax-cn" | "aliyun";
  kind: "image" | "video" | "audio";
  model: string;
  size: string;
  upperMicros: number;
  pricingVersion: string;
  expiresAt: number;
  billingNote?: string;
  enabled: boolean;
};

export type ModelConnection = {
  configured: boolean;
  keyConfigured: boolean;
  credentials?: { flowbar: boolean; minimax: boolean; aliyun: boolean };
  configRevision: string;
  routes: ModelRoute[];
  catalogRoutes: ModelRoute[];
};

type Draft = Omit<ModelRoute, "upperMicros" | "expiresAt"> & {
  upperUsd: string;
  expiry: string;
};

const sizes: Record<
  ModelRoute["provider"],
  { kind: ModelRoute["kind"]; size: string; label: string }[]
> = {
  flowbar: [
    { kind: "image", size: "1024x1024", label: "Image · 1024×1024" },
    { kind: "video", size: "720*1280", label: "Video · 720×1280" },
    { kind: "video", size: "1280*720", label: "Video · 1280×720" },
  ],
  minimax: [
    { kind: "video", size: "768P:9:16", label: "H3 · 768P portrait" },
    { kind: "video", size: "768P:16:9", label: "H3 · 768P landscape" },
  ],
  "minimax-cn": [
    { kind: "video", size: "768P:9:16", label: "H3 · 768P portrait" },
    { kind: "video", size: "768P:16:9", label: "H3 · 768P landscape" },
  ],
  aliyun: [{ kind: "audio", size: "tts", label: "Voiceover · TTS" }],
};

function defaultExpiry() {
  const date = new Date(Date.now() + 7 * 86400000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toDraft(route?: ModelRoute): Draft {
  return route
    ? {
        ...route,
        upperUsd: (route.upperMicros / 1000000).toString(),
        expiry: new Date(route.expiresAt).toISOString().slice(0, 10),
      }
    : {
        id: "",
        provider: "flowbar",
        kind: "image",
        model: "",
        size: "1024x1024",
        upperUsd: "",
        pricingVersion: "",
        expiry: defaultExpiry(),
        billingNote: "",
        enabled: false,
      };
}

export function ModelRouteManager({
  connection,
  lang,
  request,
  onSaved,
}: {
  connection: ModelConnection;
  lang: string;
  request: (path: string, body?: unknown) => Promise<any>;
  onSaved: (next: ModelConnection) => void;
}) {
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(toDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(false);

  async function save(routes: ModelRoute[]) {
    setBusy(true);
    setError("");
    setNotice(false);
    try {
      const next = await request("provider-routes", {
        revision: connection.configRevision,
        routes,
      });
      onSaved(next);
      setEditing(null);
      setNotice(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function start(route?: ModelRoute) {
    setDraft(toDraft(route));
    setEditing(route?.id ?? "new");
    setError("");
    setNotice(false);
  }

  function submit() {
    const micros = Math.round(Number(draft.upperUsd) * 1000000);
    const expiry = new Date(`${draft.expiry}T23:59:59`).getTime();
    if (
      !/^[a-z0-9_-]{1,60}$/.test(draft.id) ||
      !/^[A-Za-z0-9_./-]{1,160}$/.test(draft.model) ||
      !Number.isSafeInteger(micros) ||
      micros < 1 ||
      micros > 1000000000 ||
      !draft.pricingVersion.trim() ||
      !Number.isSafeInteger(expiry) ||
      (draft.enabled && expiry <= Date.now())
    ) {
      setError(
        t(
          "请检查路线 ID、模型 ID、价格上限及有效期。",
          "Check the route ID, model ID, price cap, and expiry.",
        ),
      );
      return;
    }
    if (editing === "new" && connection.catalogRoutes.length >= 10) {
      setError(t("最多保存 10 条路线。", "Up to 10 routes can be saved."));
      return;
    }
    const route: ModelRoute = {
      id: draft.id,
      provider: draft.provider,
      kind: draft.kind,
      model: draft.model.trim(),
      size: draft.size,
      upperMicros: micros,
      pricingVersion: draft.pricingVersion.trim(),
      expiresAt: expiry,
      billingNote: draft.billingNote?.trim(),
      enabled: draft.enabled,
    };
    save(
      editing === "new"
        ? [...connection.catalogRoutes, route]
        : connection.catalogRoutes.map((item) =>
            item.id === editing ? route : item,
          ),
    );
  }

  return (
    <details className="model-route-manager">
      <summary>
        {t("管理模型组", "Manage model routes")}{" "}
        <span>{connection.catalogRoutes?.length ?? 0}/10</span>
      </summary>
      <p className="fine">
        {t(
          "在现有服务商下自定义模型路线。密钥仅在本机配置；这里不会验证模型实际可用性或价格，请核对后再启用。",
          "Add model routes for supported providers. Keys stay local. Verify the model and price before enabling; saving does not test a live provider.",
        )}
      </p>
      <div className="model-route-list">
        {connection.catalogRoutes?.map((item) => (
          <div className="model-route-item" key={item.id}>
            <div>
              <strong>{item.model}</strong>
              <span>
                {item.provider} · {item.kind} · {item.size} · $
                {(item.upperMicros / 1000000).toFixed(4)}
              </span>
              <small>
                {item.enabled && item.expiresAt > Date.now()
                  ? t("已启用", "Enabled")
                  : t("已停用或到期", "Disabled or expired")}{" "}
                · {t("有效至", "Expires")}{" "}
                {new Date(item.expiresAt).toLocaleDateString(
                  lang === "zh" ? "zh-CN" : "en-US",
                )}
              </small>
            </div>
            <div className="model-route-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => start(item)}
              >
                {t("编辑", "Edit")}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={
                  busy || (!item.enabled && item.expiresAt <= Date.now())
                }
                onClick={() =>
                  save(
                    connection.catalogRoutes.map((route) =>
                      route.id === item.id
                        ? { ...route, enabled: !route.enabled }
                        : route,
                    ),
                  )
                }
              >
                {item.enabled ? t("停用", "Disable") : t("启用", "Enable")}
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="secondary"
        disabled={busy || connection.catalogRoutes.length >= 10}
        onClick={() => start()}
      >
        {t("添加模型路线", "Add model route")}
      </button>
      {editing !== null && (
        <div className="model-route-editor">
          <h3>
            {editing === "new"
              ? t("添加模型路线", "Add model route")
              : t("编辑模型路线", "Edit model route")}
          </h3>
          <div className="model-route-fields">
            <label>
              {t("路线 ID（保存后不可改）", "Route ID (fixed after save)")}
              <input
                value={draft.id}
                disabled={editing !== "new"}
                maxLength={60}
                onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                placeholder="my-image-model"
              />
            </label>
            <label>
              {t("服务商", "Provider")}
              <select
                value={draft.provider}
                onChange={(e) => {
                  const provider = e.target.value as ModelRoute["provider"];
                  const first = sizes[provider][0];
                  setDraft({
                    ...draft,
                    provider,
                    kind: first.kind,
                    size: first.size,
                    model: provider.startsWith("minimax") ? "MiniMax-H3" : "",
                  });
                }}
              >
                <option value="flowbar">FlowBarAI international</option>
                <option value="minimax">MiniMax overseas</option>
                <option value="minimax-cn">MiniMax China</option>
                <option value="aliyun">Aliyun voice</option>
              </select>
            </label>
            <label>
              {t("模型 ID", "Model ID")}
              <input
                value={draft.model}
                maxLength={160}
                readOnly={draft.provider.startsWith("minimax")}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                placeholder="provider-model-id"
              />
            </label>
            <label>
              {t("输出规格", "Output format")}
              <select
                value={draft.size}
                onChange={(e) => {
                  const option = sizes[draft.provider].find(
                    (item) => item.size === e.target.value,
                  )!;
                  setDraft({ ...draft, kind: option.kind, size: option.size });
                }}
              >
                {sizes[draft.provider].map((item) => (
                  <option key={item.size} value={item.size}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("单次最高费用（美元）", "Maximum cost per request (USD)")}
              <input
                type="number"
                min="0.000001"
                max="1000"
                step="0.000001"
                value={draft.upperUsd}
                onChange={(e) =>
                  setDraft({ ...draft, upperUsd: e.target.value })
                }
              />
            </label>
            <label>
              {t("价格依据版本", "Price reference/version")}
              <input
                value={draft.pricingVersion}
                maxLength={160}
                onChange={(e) =>
                  setDraft({ ...draft, pricingVersion: e.target.value })
                }
                placeholder="verified-2026-09"
              />
            </label>
            <label>
              {t("价格有效至", "Price valid through")}
              <input
                type="date"
                value={draft.expiry}
                onChange={(e) => setDraft({ ...draft, expiry: e.target.value })}
              />
            </label>
            <label>
              {t("账单/价格备注", "Billing/price note")}
              <input
                value={draft.billingNote ?? ""}
                maxLength={200}
                onChange={(e) =>
                  setDraft({ ...draft, billingNote: e.target.value })
                }
                placeholder={t(
                  "例如价格页链接及核对日期；不要输入密钥",
                  "Price source and check date; never enter a key",
                )}
              />
            </label>
          </div>
          <label className="model-route-check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) =>
                setDraft({ ...draft, enabled: e.target.checked })
              }
            />
            {t(
              "已核对模型 ID、接口与单次最高价，启用供生成使用",
              "I verified the model ID, API, and maximum price; enable for generation",
            )}
          </label>
          <div className="model-route-actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={submit}
            >
              {t("保存模型路线", "Save model route")}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              {t("取消", "Cancel")}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="fine" role="status">
          {t(
            "模型组已保存；未提交的旧报价已失效。",
            "Model routes saved; previous unsubmitted quotes are invalid.",
          )}
        </p>
      )}
    </details>
  );
}
