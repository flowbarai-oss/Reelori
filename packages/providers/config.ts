import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDataDir } from "../core/data-dir.ts";
function readWindowsCredential(provider: "flowbar" | "minimax" | "aliyun") {
  if (process.platform !== "win32") return "";
  try {
    return execFileSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      fileURLToPath(new URL("../../scripts/credentials.ps1", import.meta.url)),
      "-Action", "get", "-Provider", provider,
    ], { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 8192,
      stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return ""; }
}
export interface Route {
  enabled?: boolean;
  provider?: "flowbar" | "minimax" | "minimax-cn" | "aliyun";
  billingNote?: string;
  id: string;
  kind: "image" | "video" | "audio";
  model: string;
  size: string;
  upperMicros: number;
  pricingVersion: string;
  expiresAt: number;
}
export interface ProviderConfig {
  enabled: boolean;
  routes: Route[];
}
export function loadProviderKey(provider: "flowbar" | "minimax" = "flowbar") {
  const prefix = provider === "minimax" ? "REELORI_MINIMAX" : "REELORI_FLOWBAR";
  const direct = process.env[prefix + "_KEY"]?.trim();
  if (direct && !/\s/.test(direct)) return direct;
  const secured = readWindowsCredential(provider);
  if (secured && !/\s/.test(secured) && secured.length <= 4096) return secured;
  try {
    const file = process.env[prefix + "_KEY_FILE"];
    if (!file) return "";
    const raw = readFileSync(file, "utf8");
    if (raw.length > 16384) return "";
    const tokens = [...new Set(raw.match(/sk-[A-Za-z0-9_-]{16,}/g) ?? [])];
    return tokens.length === 1 ? tokens[0] : "";
  } catch {
    return "";
  }
}
// 阿里云智能语音交互(NLS)鉴权需要 appkey，另外需要 token（24 小时时效的动态值）
// 或 AccessKey Id + AccessKey Secret（长期凭据，用来通过 CreateToken 官方接口自动换取新 token）
// 至少一种。文件格式容忍常见的人工书写变体：中英文冒号/等号、"AccessKey Id"这种带空格的多词
// key、大小写不敏感；不强制要求某一种具体写法。
export interface AliyunCredential {
  appkey: string;
  token: string | null;
  accessKeyId: string | null;
  accessKeySecret: string | null;
}
function parseAliyunCredentialText(raw: string): AliyunCredential | null {
  if (raw.length > 4096) return null;
  let appkey = "",
    token = "",
    accessKeyId = "",
    accessKeySecret = "";
  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim().replace(/^﻿/, "");
    if (!trimmed) continue;
    const kv = trimmed.match(/^([A-Za-z][A-Za-z\s]{1,30}?)\s*[:：=]\s*(\S+)$/);
    if (kv) {
      const key = kv[1].toLowerCase().replace(/\s+/g, "");
      const value = kv[2];
      if (key === "appkey" && /^[A-Za-z0-9]{8,64}$/.test(value)) {
        if (appkey) return null;
        appkey = value;
      } else if (
        ["accesskeyid", "accessid", "ak"].includes(key) &&
        /^[A-Za-z0-9]{10,64}$/.test(value)
      ) {
        if (accessKeyId) return null;
        accessKeyId = value;
      } else if (
        ["accesskeysecret", "accesssecret", "sk"].includes(key) &&
        /^[A-Za-z0-9]{16,64}$/.test(value)
      ) {
        if (accessKeySecret) return null;
        accessKeySecret = value;
      } else if (key === "token" && /^[A-Za-z0-9]{16,64}$/.test(value)) {
        if (token) return null;
        token = value;
      }
    } else if (/^[A-Za-z0-9]{16,64}$/.test(trimmed)) {
      // 兼容旧格式：一行独立、不带 key 前缀的裸 token
      if (token) return null;
      token = trimmed;
    }
  }
  if (!appkey || (!token && !(accessKeyId && accessKeySecret))) return null;
  return {
    appkey,
    token: token || null,
    accessKeyId: accessKeyId || null,
    accessKeySecret: accessKeySecret || null,
  };
}
export function loadAliyunCredential(): AliyunCredential | null {
  const directToken = process.env.REELORI_ALIYUN_TOKEN?.trim();
  const directAppkey = process.env.REELORI_ALIYUN_APPKEY?.trim();
  const directAccessKeyId = process.env.REELORI_ALIYUN_ACCESS_KEY_ID?.trim();
  const directAccessKeySecret =
    process.env.REELORI_ALIYUN_ACCESS_KEY_SECRET?.trim();
  if (
    directAppkey &&
    /^[A-Za-z0-9]{8,64}$/.test(directAppkey) &&
    ((directToken && /^[A-Za-z0-9]{16,64}$/.test(directToken)) ||
      (directAccessKeyId &&
        directAccessKeySecret &&
        /^[A-Za-z0-9]{10,64}$/.test(directAccessKeyId) &&
        /^[A-Za-z0-9]{16,64}$/.test(directAccessKeySecret)))
  )
    return {
      appkey: directAppkey,
      token: directToken || null,
      accessKeyId: directAccessKeyId || null,
      accessKeySecret: directAccessKeySecret || null,
    };
  const secured = readWindowsCredential("aliyun");
  if (secured) return parseAliyunCredentialText(secured);
  try {
    const file = process.env.REELORI_ALIYUN_CRED_FILE;
    if (!file) return null;
    return parseAliyunCredentialText(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
export function loadProviderConfig(): ProviderConfig {
  try {
    const raw = JSON.parse(
      readFileSync(path.join(getDataDir(), "flowbar.json"), "utf8").replace(
        /^\uFEFF/,
        "",
      ),
    );
    if (
      raw.enabled !== true ||
      !Array.isArray(raw.routes) ||
      raw.routes.length > 10
    )
      throw Error();
    const ids = new Set();
    for (const r of raw.routes) {
      if (
        !r ||
        (r.enabled !== undefined && typeof r.enabled !== "boolean") ||
        (r.provider !== undefined &&
          !["flowbar", "minimax", "minimax-cn", "aliyun"].includes(
            r.provider,
          )) ||
        (r.billingNote !== undefined &&
          (typeof r.billingNote !== "string" || r.billingNote.length > 200)) ||
        typeof r.id !== "string" ||
        !/^[a-z0-9_-]{1,60}$/.test(r.id) ||
        ids.has(r.id) ||
        !["image", "video", "audio"].includes(r.kind) ||
        typeof r.model !== "string" ||
        !/^[A-Za-z0-9_./-]{1,160}$/.test(r.model) ||
        !Number.isSafeInteger(r.upperMicros) ||
        r.upperMicros <= 0 ||
        r.upperMicros > 1000000000 ||
        typeof r.pricingVersion !== "string" ||
        r.pricingVersion.length < 1 ||
        r.pricingVersion.length > 160 ||
        !Number.isSafeInteger(r.expiresAt) ||
        ![
          "1024x1024",
          "720*1280",
          "1280*720",
          "768P:9:16",
          "768P:16:9",
          "tts",
        ].includes(r.size) ||
        (r.kind === "audio") !== (r.size === "tts")
      )
        throw Error();
      ids.add(r.id);
    }
    return {
      enabled: true,
      routes: raw.routes.map((r: Route) => ({
        enabled: r.enabled !== false,
        ...(r.provider ? { provider: r.provider } : {}),
        ...(r.billingNote ? { billingNote: r.billingNote } : {}),
        id: r.id,
        kind: r.kind,
        model: r.model,
        size: r.size,
        upperMicros: r.upperMicros,
        pricingVersion: r.pricingVersion,
        expiresAt: r.expiresAt,
      })),
    };
  } catch {
    return { enabled: false, routes: [] };
  }
}
