import type { ProviderInput } from "./contracts.ts";
import { downloadImage } from "./download.ts";
export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
export class ProviderError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
export type ProviderResponse =
  | { state: "running"; upstreamId?: string }
  | { state: "succeeded"; imageBase64?: string; audioBase64?: string }
  | { state: "failed" };
export class FlowBarAdapter {
  private key: string;
  private fetcher: Fetcher;
  constructor(key: string, fetcher: Fetcher = fetch) {
    this.key = key;
    this.fetcher = fetcher;
  }
  private async read(route: string, body?: unknown, media = false) {
    if (!this.key) throw new ProviderError("key_missing");
    const response = await this.fetcher(
      "https://api.flowbarai.com/v1/" + route,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(body === undefined ? 60000 : 360000),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderError(`provider_http_${response.status}`);
    }
    const max = (media ? 64 : 8) * 1024 * 1024;
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
    const bytes = Buffer.concat(chunks);
    if (media) return bytes;
    try {
      return JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new ProviderError("invalid_response");
    }
  }
  validate(input: ProviderInput) {
    if (
      !["image", "video"].includes(input.kind) ||
      !input.model ||
      input.model.length > 160 ||
      !input.prompt.trim() ||
      input.prompt.length > 2000
    )
      throw new ProviderError("unsupported_input");
    if (
      input.kind === "video" &&
      (input.seconds !== 5 || !["720*1280", "1280*720"].includes(input.size))
    )
      throw new ProviderError("unsupported_video_spec");
    if (input.kind === "image" && input.size !== "1024x1024")
      throw new ProviderError("unsupported_image_spec");
  }
  async submit(input: ProviderInput): Promise<ProviderResponse> {
    this.validate(input);
    const body =
      input.kind === "image"
        ? {
            model: input.model,
            prompt: input.prompt,
            n: 1,
            size: input.size,
            response_format: "b64_json",
          }
        : {
            model: input.model,
            prompt: input.prompt,
            duration: 5,
            size: input.size,
            metadata: { parameters: { resolution: "720P" } },
          };
    const result = await this.read(
      input.kind === "image" ? "images/generations" : "videos",
      body,
    );
    if (input.kind === "image") {
      const item = result?.data?.[0];
      const image =
        typeof item?.b64_json === "string"
          ? item.b64_json
          : typeof item?.url === "string"
            ? await downloadImage(item.url)
            : undefined;
      if (
        typeof image !== "string" ||
        image.length > 7 * 1024 * 1024 ||
        image.length % 4 !== 0 ||
        !image ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(image)
      )
        throw new ProviderError("inline_image_missing");
      return { state: "succeeded", imageBase64: image };
    }
    const id = result?.id ?? result?.task_id;
    this.id(id);
    return { state: "running", upstreamId: id };
  }
  private id(id: unknown): asserts id is string {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id))
      throw new ProviderError("invalid_task_id");
  }
  async query(id: string): Promise<ProviderResponse> {
    this.id(id);
    const r = await this.read(`videos/${id}`);
    const state = r?.status ?? r?.state;
    if (["completed", "succeeded", "success"].includes(state))
      return { state: "succeeded" };
    if (["failed", "cancelled", "canceled", "rejected"].includes(state))
      return { state: "failed" };
    if (
      [
        "queued",
        "pending",
        "processing",
        "in_progress",
        "running",
        "submitted",
      ].includes(state)
    )
      return { state: "running", upstreamId: id };
    throw new ProviderError("unrecognized_provider_state");
  }
  async content(id: string): Promise<Buffer> {
    this.id(id);
    return this.read(`videos/${id}/content`, undefined, true);
  }
}
