import type { ProviderLedger } from "./contracts.ts";
import type { Shot } from "../contracts/index.ts";
import { DomainError } from "../core/project.ts";
export function validateLedger(
  value: unknown,
  shots: Shot[],
  referenceRevision: number,
): asserts value is ProviderLedger {
  const fail = () => {
    throw new DomainError("真实任务账本格式无效");
  };
  const obj = (x: any, keys: string[]) => {
    if (
      !x ||
      typeof x !== "object" ||
      Array.isArray(x) ||
      Object.keys(x).some((k) => !keys.includes(k))
    )
      fail();
  };
  const num = (n: any, max = Number.MAX_SAFE_INTEGER) => {
    if (!Number.isSafeInteger(n) || n < 0 || n > max) fail();
  };
  const str = (s: any, max: number) => {
    if (typeof s !== "string" || !s || s.length > max || s.includes("\0"))
      fail();
  };
  const v = value as ProviderLedger;
  obj(v, ["budgetMicros", "jobs"]);
  num(v.budgetMicros, 1000000000);
  if (!Array.isArray(v.jobs) || v.jobs.length > 1000) fail();
  const ids = new Set(),
    ops = new Set();
  for (const j of v.jobs) {
    obj(j, [
      "id",
      "operationId",
      "quote",
      "state",
      "createdAt",
      "upstreamId",
      "generation",
      "leaseUntil",
      "nextQueryAt",
      "queries",
      "reservedMicros",
      "actualMicros",
      "billingEvidence",
      "resultImage",
      "resultVideo",
      "resultAudio",
      "resultDurationMs",
      "errorCode",
      "recoveryBlocked",
    ]);
    for (const key of ["id", "operationId"] as const) {
      str(j[key], 100);
      if (!/^[A-Za-z0-9_-]+$/.test(j[key])) fail();
    }
    if (ids.has(j.id) || ops.has(j.operationId)) fail();
    ids.add(j.id);
    ops.add(j.operationId);
    if (
      ![
        "reserved",
        "submitting",
        "running",
        "succeeded",
        "failed",
        "unknown",
      ].includes(j.state)
    )
      fail();
    for (const key of [
      "createdAt",
      "generation",
      "leaseUntil",
      "nextQueryAt",
      "queries",
    ] as const)
      num(j[key]);
    num(j.reservedMicros, 1000000000);
    if (j.actualMicros !== null) {
      num(j.actualMicros, 1000000000);
      if (j.reservedMicros !== 0) fail();
    }
    if (j.billingEvidence !== null) str(j.billingEvidence, 500);
    if ((j.actualMicros === null) !== (j.billingEvidence === null)) fail();
    if (j.upstreamId !== null) {
      str(j.upstreamId, 200);
      if (!/^[A-Za-z0-9_-]+$/.test(j.upstreamId)) fail();
    }
    if (j.errorCode !== null) {
      str(j.errorCode, 100);
      if (!/^[a-z0-9_]+$/.test(j.errorCode)) fail();
    }
    if (
      j.recoveryBlocked !== undefined &&
      typeof j.recoveryBlocked !== "boolean"
    )
      fail();
    if (
      j.resultImage !== null &&
      !/^\/api\/assets\/[a-f0-9]{64}\.(png|jpg)$/.test(j.resultImage)
    )
      fail();
    if (
      j.resultVideo !== null &&
      !/^\/api\/assets\/[a-f0-9]{64}\.mp4$/.test(j.resultVideo)
    )
      fail();
    if (
      j.resultAudio != null &&
      !/^\/api\/assets\/[a-f0-9]{64}\.wav$/.test(j.resultAudio)
    )
      fail();
    if (j.resultDurationMs != null) {
      num(j.resultDurationMs, 30000);
      if (j.resultDurationMs < 100) fail();
    }
    // Pre-TTS project revisions have neither field. Treat that legacy pair as
    // absent while still rejecting one-sided or malformed audio results.
    if ((j.resultAudio == null) !== (j.resultDurationMs == null)) fail();
    obj(j.quote, [
      "id",
      "input",
      "upperMicros",
      "expiresAt",
      "pricingVersion",
      "billingNote",
    ]);
    const q = j.quote;
    str(q.id, 100);
    str(q.pricingVersion, 160);
    if (q.billingNote !== undefined) str(q.billingNote, 200);
    num(q.upperMicros, 1000000000);
    if (!q.upperMicros) fail();
    num(q.expiresAt);
    obj(q.input, [
      "provider",
      "kind",
      "model",
      "prompt",
      "seconds",
      "size",
      "shotId",
      "shotRevision",
      "referenceRevision",
      "referenceId",
      "referenceImage",
    ]);
    const i = q.input;
    if (
      i.provider !== undefined &&
      !["flowbar", "minimax", "minimax-cn", "aliyun"].includes(i.provider)
    )
      fail();
    if (!["image", "video", "audio"].includes(i.kind)) fail();
    str(i.model, 160);
    str(i.prompt, 2000);
    str(i.size, 30);
    str(i.shotId, 100);
    num(i.seconds, 10);
    if (i.seconds < 2) fail();
    const shot = shots.find((s) => s.id === i.shotId);
    if (!shot) fail();
    num(i.shotRevision, shot!.revision);
    num(i.referenceRevision, referenceRevision);
    if (!i.shotRevision || !i.referenceRevision) fail();
    if ((i.referenceId === undefined) !== (i.referenceImage === undefined)) fail();
    if (i.referenceId !== undefined) {
      str(i.referenceId, 100);
      if (!/^[A-Za-z0-9_-]+$/.test(i.referenceId) || i.provider !== "minimax-cn" || i.kind !== "video" || i.model !== "MiniMax-H3") fail();
      if (typeof i.referenceImage !== "string" || !/^\/api\/assets\/[a-f0-9]{64}\.(png|jpg)$/.test(i.referenceImage)) fail();
    }
  }
}
