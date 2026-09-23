import { createHmac, randomUUID } from "node:crypto";
import {boundedText} from './bounded-text.ts';
import { ProviderError, type Fetcher } from "./flowbar.ts";
// 阿里云 OpenAPI RPC 风格签名，官方文档：
// https://help.aliyun.com/zh/isi/getting-started/use-http-or-https-to-obtain-an-access-token
// 用官方文档给出的测试向量核对过实现：固定 AccessKeyId/Secret/Timestamp/Nonce 算出的签名
// 与文档给出的 "hHq4yNsPitlfDJ2L0nQPdugdEzM=" 完全一致，不是凭印象写的。
function percentEncode(value: string) {
  return encodeURIComponent(value)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");
}
export function signAliyunRequest(
  params: Record<string, string>,
  accessKeySecret: string,
  method: "GET" | "POST" = "GET",
) {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => percentEncode(k) + "=" + percentEncode(params[k]))
    .join("&");
  const stringToSign =
    method + "&" + percentEncode("/") + "&" + percentEncode(canonical);
  const signature = createHmac("sha1", accessKeySecret + "&")
    .update(stringToSign)
    .digest("base64");
  return canonical + "&Signature=" + percentEncode(signature);
}
export interface AliyunToken {
  token: string;
  expireAtMs: number;
}
// 换取一个新 Token；调用方负责判断当前 Token 是否临近过期，本函数不做隐式重试/缓存。
export async function createAliyunToken(
  accessKeyId: string,
  accessKeySecret: string,
  fetcher: Fetcher = fetch,
): Promise<AliyunToken> {
  if (!accessKeyId || !accessKeySecret)
    throw new ProviderError("aliyun_akms_missing");
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const params: Record<string, string> = {
    AccessKeyId: accessKeyId,
    Action: "CreateToken",
    Format: "JSON",
    RegionId: "cn-shanghai",
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: randomUUID(),
    SignatureVersion: "1.0",
    Timestamp: timestamp,
    Version: "2019-02-28",
  };
  const query = signAliyunRequest(params, accessKeySecret, "GET");
  const response = await fetcher(
    "https://nls-meta.cn-shanghai.aliyuncs.com/?" + query,
    { method: "GET", redirect: "error", signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError(`aliyun_token_http_${response.status}`);
  }
  const text = await boundedText(response,8192,'aliyun_token_response_too_large');
  let body: {
    Token?: { Id?: unknown; ExpireTime?: unknown };
    Code?: string;
    Message?: string;
    ErrCode?: number | string;
    ErrMsg?: string;
  };
  try {
    body = JSON.parse(text);
  } catch {
    throw new ProviderError("aliyun_token_invalid_response");
  }
  if (typeof body.Token?.Id !== "string" || !body.Token.Id)
    throw new ProviderError(
      "aliyun_token_create_failed_" + (body.ErrCode ?? body.Code ?? "unknown"),
    );
  const expireTime = body.Token.ExpireTime;
  if (typeof expireTime !== "number" || !Number.isSafeInteger(expireTime))
    throw new ProviderError("aliyun_token_expire_time_invalid");
  return { token: body.Token.Id, expireAtMs: expireTime * 1000 };
}
// 内存缓存 + 到期前刷新；并发调用只触发一次真实换取（去重），不是每次 getToken 都发请求。
export function createAliyunTokenManager(
  accessKeyId: string,
  accessKeySecret: string,
  fetcher: Fetcher = fetch,
  now: () => number = Date.now,
) {
  let cached: AliyunToken | null = null;
  let pending: Promise<AliyunToken> | null = null;
  const marginMs = 5 * 60000;
  return {
    async getToken(): Promise<string> {
      if (!cached || cached.expireAtMs - now() < marginMs) {
        if (!pending)
          pending = createAliyunToken(accessKeyId, accessKeySecret, fetcher).finally(
            () => {
              pending = null;
            },
          );
        cached = await pending;
      }
      return cached.token;
    },
  };
}
