import type { ProviderInput } from "./contracts.ts";
import {
  ProviderError,
  type Fetcher,
  type ProviderResponse,
} from "./flowbar.ts";
import { downloadBytes } from "./download.ts";
export class MiniMaxAdapter {
  private key: string;
  private fetcher: Fetcher;
  private download: (url: string) => Promise<Buffer>;
  private region: "global" | "cn";
  constructor(
    key: string,
    fetcher: Fetcher = fetch,
    download = downloadBytes,
    region: "global" | "cn" = "global",
  ) {
    this.key = key;
    this.fetcher = fetcher;
    this.download = download;
    this.region = region;
  }
  validate(input: ProviderInput) {
    if (
      input.provider !== (this.region === "cn" ? "minimax-cn" : "minimax") ||
      input.kind !== "video" ||
      input.model !== "MiniMax-H3" ||
      input.seconds !== 5 ||
      !["768P:9:16", "768P:16:9"].includes(input.size) ||
      !input.prompt.trim() ||
      input.prompt.length > 2000 ||
      ((input.referenceId === undefined) !== (input.referenceImage === undefined)) ||
      (input.referenceImage !== undefined &&
        (this.region !== "cn" ||
          !/^[A-Za-z0-9_-]{1,100}$/.test(input.referenceId!) ||
          !/^\/api\/assets\/[a-f0-9]{64}\.(png|jpg)$/.test(input.referenceImage)))
    )
      throw new ProviderError("unsupported_h3_spec");
  }
  private id(id: string) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id))
      throw new ProviderError("invalid_task_id");
  }
  private async read(route: string, body?: unknown) {
    if (!this.key) throw new ProviderError("minimax_key_missing");
    const r = await this.fetcher(
      (this.region === "cn"
        ? "https://api.minimax.cn/v2/"
        : "https://api.minimax.io/v2/") + route,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: "Bearer " + this.key,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      },
    );
    if (!r.ok) {
      await r.body?.cancel();
      throw new ProviderError("minimax_http_" + r.status);
    }
    if (Number(r.headers.get("content-length")) > 1048576) {
      await r.body?.cancel();
      throw new ProviderError("response_too_large");
    }
    if (!r.body) throw new ProviderError("response_empty");
    const reader = r.body.getReader(),
      parts: Uint8Array[] = [];
    let count = 0;
    try {
      for (;;) {
        const x = await reader.read();
        if (x.done) break;
        count += x.value.length;
        if (count > 1048576) throw new ProviderError("response_too_large");
        parts.push(x.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    try {
      return JSON.parse(Buffer.concat(parts).toString("utf8"));
    } catch {
      throw new ProviderError("invalid_response");
    }
  }
  async submit(input: ProviderInput, referenceBytes?: Buffer): Promise<ProviderResponse> {
    this.validate(input);
    if (input.referenceImage && (!referenceBytes || referenceBytes.length < 1 || referenceBytes.length > 5 * 1024 * 1024))
      throw new ProviderError("reference_image_missing_or_oversize");
    if (!input.referenceImage && referenceBytes) throw new ProviderError("unexpected_reference_image");
    const content: Array<Record<string, string>> = [{ type: "text", text: input.prompt }];
    if (input.referenceImage) {
      const mime = input.referenceImage.endsWith(".jpg") ? "image/jpeg" : "image/png";
      content.push({ type: "image_url", role: "reference_image", image_url: `data:${mime};base64,${referenceBytes!.toString("base64")}` });
    }
    const result = await this.read("video_generation", {
      model: input.model,
      content,
      resolution: "768P",
      duration: input.seconds,
      ratio: input.size.slice(5),
    });
    this.id(result.task_id);
    return { state: "running", upstreamId: result.task_id };
  }
  private async task(id: string) {
    this.id(id);
    const r = await this.read("query/video_generation/" + id);
    if (r.task?.id !== id) throw new ProviderError("task_identity_mismatch");
    return r.task;
  }
  async query(id: string): Promise<ProviderResponse> {
    const task = await this.task(id);
    if (task.status === "succeeded") return { state: "succeeded" };
    if (["failed", "cancelled"].includes(task.status))
      return { state: "failed" };
    if (["queued", "running"].includes(task.status))
      return { state: "running", upstreamId: id };
    throw new ProviderError("unrecognized_provider_state");
  }
  async content(id: string): Promise<Buffer> {
    const task = await this.task(id);
    if (task.status !== "succeeded" || typeof task.content?.url !== "string")
      throw new ProviderError("video_content_missing");
    return this.download(task.content.url);
  }
}
