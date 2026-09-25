import type { Store } from "../storage-local/store.ts";
import type { ProviderInput } from "./contracts.ts";
import type { ProviderResponse } from "./flowbar.ts";
import { ProviderError } from "./flowbar.ts";
import { claimProvider, applyProvider } from "./ledger.ts";
import { saveReference } from "../media/assets.ts";
import { saveVideo } from "../media/video.ts";
import { saveAudio } from "../media/audio.ts";
import { readH3Reference } from "./h3-reference.ts";
export interface Adapter {
  submit(input: ProviderInput, referenceBytes?: Buffer): Promise<ProviderResponse>;
  query(id: string): Promise<ProviderResponse>;
  content(id: string): Promise<Buffer>;
}
// Recovery may query a known task, but never creates a new remote job.
export function nextRecoveryJob(store: Store, now = Date.now()) {
  const pending: { projectId: string; jobId: string; due: number }[] = [];
  for (const row of store.list()) {
    const p = store.get(row.id);
    for (const j of p.provider?.jobs ?? []) {
      if (j.recoveryBlocked) continue;
      if (j.state === "submitting" && !j.upstreamId && j.leaseUntil <= now) {
        store.transact((copy) => {
          claimProvider(copy, j.id, now);
        }, p.id);
        continue;
      }
      if (
        j.upstreamId &&
        ["running", "unknown", "submitting"].includes(j.state) &&
        j.leaseUntil <= now &&
        j.nextQueryAt <= now &&
        j.queries < 120
      )
        pending.push({ projectId: p.id, jobId: j.id, due: j.nextQueryAt });
    }
  }
  pending.sort((a, b) => a.due - b.due);
  return pending.length
    ? { projectId: pending[0].projectId, jobId: pending[0].jobId }
    : null;
}
export async function runProviderJob(
  store: Store,
  projectId: string,
  jobId: string,
  adapter: Adapter,
  assetDir: string,
) {
  let claim: ReturnType<typeof claimProvider> = null;
  store.transact((p) => {
    claim = claimProvider(p, jobId);
  }, projectId);
  if (!claim) return;
  const work = claim as NonNullable<ReturnType<typeof claimProvider>>;
  try {
    let referenceBytes: Buffer | undefined;
    if (work.action === "submit" && work.job.quote.input.referenceImage)
      referenceBytes = await readH3Reference(assetDir, work.job.quote.input.referenceImage);
    const response =
      work.action === "submit"
        ? await adapter.submit(work.job.quote.input, referenceBytes)
        : await adapter.query(work.job.upstreamId!);
    let result: {
      image?: string;
      video?: string;
      audio?: string;
      durationMs?: number;
    } = {};
    if (response.state === "succeeded") {
      if (work.job.quote.input.kind === "image") {
        if (!response.imageBase64)
          throw new ProviderError("inline_image_missing");
        result = await saveReference(response.imageBase64, assetDir);
      } else if (work.job.quote.input.kind === "audio")
        result = await saveAudio(
          "audioBase64" in response && response.audioBase64
            ? Buffer.from(response.audioBase64, "base64")
            : await adapter.content(work.job.upstreamId!),
          assetDir,
        );
      else
        result = await saveVideo(
          await adapter.content(work.job.upstreamId!),
          assetDir,
          work.job.quote.input.seconds,
        );
    }
    store.transact((p) => {
      applyProvider(p, jobId, work.generation, {
        state: response.state,
        ...("upstreamId" in response
          ? { upstreamId: response.upstreamId }
          : {}),
        ...result,
      });
    }, projectId);
  } catch (error) {
    const errorCode =
      error instanceof ProviderError
        ? error.code
        : "provider_or_media_uncertain";
    store.transact((p) => {
      applyProvider(p, jobId, work.generation, { state: "unknown", errorCode });
    }, projectId);
  }
}
