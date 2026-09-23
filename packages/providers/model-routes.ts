import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DomainError } from "../core/project.ts";
import type { ProviderConfig, Route } from "./config.ts";

const fail = (): never => {
  throw new DomainError("模型路线配置或规格无效", 409);
};
export function catalogRevision(config: ProviderConfig) {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}
export function validateRouteCatalog(value: unknown): ProviderConfig {
  if (!Array.isArray(value)) fail();
  const items = value as unknown[];
  if (items.length > 10) fail();
  const ids = new Set<string>();
  const routes: Route[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail();
    const r = raw as Record<string, any>;
    if (
      Object.keys(r).some(
        (k) =>
          ![
            "id",
            "provider",
            "kind",
            "model",
            "size",
            "upperMicros",
            "pricingVersion",
            "expiresAt",
            "billingNote",
            "enabled",
          ].includes(k),
      )
    )
      fail();
    if (
      typeof r.id !== "string" ||
      !/^[a-z0-9_-]{1,60}$/.test(r.id) ||
      ids.has(r.id)
    )
      fail();
    if (
      !["flowbar", "minimax", "minimax-cn", "aliyun"].includes(
        String(r.provider ?? "flowbar"),
      )
    )
      fail();
    if (
      typeof r.model !== "string" ||
      !/^[A-Za-z0-9_./-]{1,160}$/.test(r.model) ||
      typeof r.size !== "string" ||
      !["image", "video", "audio"].includes(String(r.kind))
    )
      fail();
    if (
      !Number.isSafeInteger(r.upperMicros) ||
      Number(r.upperMicros) < 1 ||
      Number(r.upperMicros) > 1000000000 ||
      typeof r.pricingVersion !== "string" ||
      r.pricingVersion.length < 1 ||
      r.pricingVersion.length > 160 ||
      !Number.isSafeInteger(r.expiresAt) ||
      typeof r.enabled !== "boolean" ||
      (r.billingNote !== undefined &&
        (typeof r.billingNote !== "string" || r.billingNote.length > 200))
    )
      fail();
    const provider = r.provider ?? "flowbar";
    if (
      provider === "flowbar" &&
      !(
        (r.kind === "image" && r.size === "1024x1024") ||
        (r.kind === "video" && ["720*1280", "1280*720"].includes(r.size))
      )
    )
      fail();
    if (
      (provider === "minimax" || provider === "minimax-cn") &&
      !(
        r.kind === "video" &&
        r.model === "MiniMax-H3" &&
        ["768P:9:16", "768P:16:9"].includes(r.size)
      )
    )
      fail();
    if (
      provider === "aliyun" &&
      !(
        r.kind === "audio" &&
        r.size === "tts" &&
        /^[A-Za-z0-9_]{1,60}$/.test(r.model)
      )
    )
      fail();
    ids.add(r.id);
    routes.push({
      id: r.id,
      provider: provider as Route["provider"],
      kind: r.kind as Route["kind"],
      model: r.model,
      size: r.size,
      upperMicros: Number(r.upperMicros),
      pricingVersion: r.pricingVersion,
      expiresAt: Number(r.expiresAt),
      ...(r.billingNote ? { billingNote: r.billingNote } : {}),
      enabled: r.enabled,
    });
  }
  return { enabled: true, routes };
}
export async function saveRouteCatalog(file: string, config: ProviderConfig) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temp, JSON.stringify(config, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}
