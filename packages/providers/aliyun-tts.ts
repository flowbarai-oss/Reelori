import type { ProviderInput } from "./contracts.ts";
import { ProviderError, type Fetcher, type ProviderResponse } from "./flowbar.ts";
// 阿里云智能语音交互(NLS)一句话语音合成，官方文档化的同步 RESTful 接口：
// https://help.aliyun.com/zh/isi/developer-reference/restful-api-3
// 一次 POST 请求内直接拿到完整音频，不是提交/轮询的异步模型，所以 submit() 就是终态，
// query()/content() 不会被真正调用到（跟 FlowBar 的同步图片路径同一种形态）。
export class AliyunTtsAdapter {
  private token: string;
  private appkey: string;
  private fetcher: Fetcher;
  // 提供了 tokenProvider 时，每次 submit 都用它拿当前有效 token（支持 AK/SK 自动换取场景），
  // 覆盖构造时传入的静态 token；没提供就一直用构造时的静态值（向后兼容既有用法）。
  private tokenProvider?: () => Promise<string>;
  constructor(
    token: string,
    appkey: string,
    fetcher: Fetcher = fetch,
    tokenProvider?: () => Promise<string>,
  ) {
    this.token = token;
    this.appkey = appkey;
    this.fetcher = fetcher;
    this.tokenProvider = tokenProvider;
  }
  validate(input: ProviderInput) {
    if (input.kind !== "audio" || input.size !== "tts")
      throw new ProviderError("unsupported_input");
    if (!input.prompt.trim() || [...input.prompt].length > 300)
      throw new ProviderError("dialogue_too_long_for_single_request");
    if (input.model && !/^[a-z0-9_]{1,60}$/i.test(input.model))
      throw new ProviderError("unsupported_voice_preset");
  }
  async submit(input: ProviderInput): Promise<ProviderResponse> {
    this.validate(input);
    const token = this.tokenProvider ? await this.tokenProvider() : this.token;
    if (!token || !this.appkey)
      throw new ProviderError("aliyun_credential_missing");
    const response = await this.fetcher(
      "https://nls-gateway-cn-shanghai.aliyuncs.com/stream/v1/tts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appkey: this.appkey,
          token,
          text: input.prompt,
          format: "wav",
          sample_rate: 16000,
          voice: input.model || "xiaoyun",
        }),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.startsWith("audio/")) {
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProviderError(`aliyun_http_${response.status}`);
      }
      const max = 4 * 1024 * 1024;
      if (Number(response.headers.get("content-length")) > max) {
        await response.body?.cancel();
        throw new ProviderError("response_too_large");
      }
      if (!response.body) throw new ProviderError("response_empty");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.length;
          if (size > max) throw new ProviderError("response_too_large");
          chunks.push(item.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      return {
        state: "succeeded",
        audioBase64: Buffer.concat(chunks).toString("base64"),
      };
    }
    // 非音频响应：按文档是 JSON 错误体 {task_id, status, message, result}
    let body: { status?: number; message?: string } = {};
    try {
      const text = await boundedText(response,8192,'aliyun_tts_response_too_large');
      if (text.length <= 8192) body = JSON.parse(text);
    } catch {
      // 解析失败时仍走下面的兜底错误码，不吞掉失败状态
    }
    if (body.status === 40000001)
      throw new ProviderError("aliyun_auth_failed_token_may_be_expired");
    if (body.status === 40000003) throw new ProviderError("aliyun_invalid_params");
    throw new ProviderError(
      "aliyun_tts_failed_" + (body.status ?? response.status),
    );
  }
  async query(): Promise<ProviderResponse> {
    throw new ProviderError("sync_provider_has_no_async_query");
  }
  async content(): Promise<Buffer> {
    throw new ProviderError("sync_provider_has_no_async_content");
  }
}
import {boundedText} from './bounded-text.ts';
