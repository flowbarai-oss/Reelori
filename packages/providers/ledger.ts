import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Project } from "../contracts/index.ts";
import type { ProviderInput, ProviderJob, ProviderQuote } from "./contracts.ts";
import { DomainError } from "../core/project.ts";
import { validateAudioTracks } from "../core/audio.ts";
const check = (ok: unknown, message: string) => {
  if (!ok) throw new DomainError(message, 409);
};
const amount = (n: number) =>
  Number.isSafeInteger(n) && n >= 0 && n <= 1000000000;
const changed = (p: Project) => {
  p.revision++;
};
export function providerTotals(p: Project) {
  return (p.provider?.jobs ?? []).reduce(
    (r, j) => ({
      actualMicros: r.actualMicros + (j.actualMicros ?? 0),
      reservedMicros: r.reservedMicros + j.reservedMicros,
    }),
    { actualMicros: 0, reservedMicros: 0 },
  );
}
export function cancelReservedProvider(
  p: Project,
  jobId: string,
  revision: number,
) {
  check(p.revision === revision, "项目版本已变化");
  const j = p.provider?.jobs.find((j) => j.id === jobId);
  check(
    j &&
      j.state === "reserved" &&
      j.generation === 0 &&
      !j.upstreamId &&
      !j.recoveryBlocked,
    "仅可取消从未提交的预留任务",
  );
  j!.state = "failed";
  j!.actualMicros = 0;
  j!.reservedMicros = 0;
  j!.billingEvidence = "Cancelled locally before first submission";
  j!.errorCode = "cancelled_before_submit";
  changed(p);
}
export function setProviderBudget(
  p: Project,
  micros: number,
  revision: number,
) {
  check(p.revision === revision, "项目版本已变化");
  check(amount(micros), "美元预算无效");
  const t = providerTotals(p);
  check(
    micros >= t.actualMicros + t.reservedMicros,
    "预算不能低于已结算与待核对费用",
  );
  p.provider ??= { budgetMicros: 0, jobs: [] };
  p.provider.budgetMicros = micros;
  changed(p);
}
export function makeQuote(
  p: Project,
  shotId: string,
  route: {
    provider?: "flowbar" | "minimax" | "minimax-cn" | "aliyun";
    billingNote?: string;
    kind: "image" | "video" | "audio";
    model: string;
    size: string;
    upperMicros: number;
    pricingVersion: string;
  },
  now = Date.now(),
): ProviderQuote {
  const s = p.shots.find((s) => s.id === shotId);
  check(s, "镜头不存在");
  check(amount(route.upperMicros) && route.upperMicros > 0, "需要可信费用上界");
  const prompt = route.kind === "audio" ? s!.dialogue : s!.description;
  check(prompt.trim(), route.kind === "audio" ? "该镜头没有对白，无法生成配音" : "镜头画面描述为空");
  return {
    id: randomUUID(),
    input: {
      ...(route.provider ? { provider: route.provider } : {}),
      kind: route.kind,
      model: route.model,
      size: route.size,
      prompt,
      seconds: s!.seconds,
      shotId,
      shotRevision: s!.revision,
      referenceRevision: p.referenceRevision,
    },
    upperMicros: route.upperMicros,
    pricingVersion: route.pricingVersion,
    ...(route.billingNote ? { billingNote: route.billingNote } : {}),
    expiresAt: now + 5 * 60000,
  };
}
export function reserveProvider(
  p: Project,
  q: ProviderQuote,
  operationId: string,
  revision: number,
  now = Date.now(),
) {
  check(
    typeof operationId === "string" &&
      /^[A-Za-z0-9_-]{8,100}$/.test(operationId),
    "操作编号无效",
  );
  const existing = p.provider?.jobs.find((j) => j.operationId === operationId);
  if (existing) {
    check(isDeepStrictEqual(existing.quote, q), "操作编号已用于其他输入");
    return;
  }
  check(p.revision === revision, "项目版本已变化");
  check(p.provider, "请先批准美元预算");
  check(!p.paused, "后续派单已暂停");
  check(
    q.expiresAt > now && amount(q.upperMicros) && q.upperMicros > 0,
    "报价已失效",
  );
  const s = p.shots.find((s) => s.id === q.input.shotId);
  check(
    s &&
      s.revision === q.input.shotRevision &&
      (q.input.kind === "audio" ? s.dialogue : s.description) ===
        q.input.prompt &&
      s.seconds === q.input.seconds &&
      p.referenceRevision === q.input.referenceRevision,
    "镜头或参考版本已变化",
  );
  check(
    p.preview?.inputRevision === p.inputRevision &&
      p.preview?.referenceRevision === p.referenceRevision,
    "请确认当前预演",
  );
  check(
    !p.provider!.jobs.some(
      (j) =>
        j.quote.input.shotId === q.input.shotId &&
        !["succeeded", "failed"].includes(j.state),
    ),
    "此镜头仍有未完成或结果未知的任务",
  );
  const t = providerTotals(p);
  check(
    t.actualMicros + t.reservedMicros + q.upperMicros <=
      p.provider!.budgetMicros,
    "美元预算不足",
  );
  check(p.provider!.jobs.length < 1000, "任务数量已达当前上限");
  p.provider!.jobs.push({
    id: randomUUID(),
    operationId,
    quote: structuredClone(q),
    state: "reserved",
    createdAt: now,
    upstreamId: null,
    generation: 0,
    leaseUntil: 0,
    nextQueryAt: 0,
    queries: 0,
    reservedMicros: q.upperMicros,
    actualMicros: null,
    billingEvidence: null,
    resultImage: null,
    resultVideo: null,
    resultAudio: null,
    resultDurationMs: null,
    errorCode: null,
  });
  changed(p);
}
export function claimProvider(
  p: Project,
  id: string,
  now = Date.now(),
): null | {
  action: "submit" | "query";
  generation: number;
  leaseUntil: number;
  job: ProviderJob;
} {
  const j = p.provider?.jobs.find((j) => j.id === id);
  if (
    !j ||
    j.recoveryBlocked ||
    ["succeeded", "failed"].includes(j.state) ||
    j.leaseUntil > now
  )
    return null;
  if (j.state === "submitting" && !j.upstreamId) {
    j.state = "unknown";
    j.errorCode = "submission_outcome_unknown";
    j.generation++;
    changed(p);
    return null;
  }
  if (j.state === "unknown" && !j.upstreamId) return null;
  const submit = j.state === "reserved";
  if (submit && p.paused) return null;
  if (!submit && (j.nextQueryAt > now || j.queries >= 120)) return null;
  if (submit) {
    j.state = "submitting";
  } else {
    j.queries++;
  }
  j.generation++;
  j.leaseUntil = now + 7 * 60000;
  changed(p);
  return {
    action: submit ? "submit" : "query",
    generation: j.generation,
    leaseUntil: j.leaseUntil,
    job: structuredClone(j),
  };
}
export function applyProvider(
  p: Project,
  id: string,
  generation: number,
  result: {
    state: "running" | "succeeded" | "failed" | "unknown";
    upstreamId?: string;
    image?: string;
    video?: string;
    audio?: string;
    durationMs?: number;
    errorCode?: string;
  },
  now = Date.now(),
) {
  const j = p.provider?.jobs.find((j) => j.id === id);
  if (
    !j ||
    j.generation !== generation ||
    j.leaseUntil <= now ||
    ["succeeded", "failed"].includes(j.state)
  )
    return false;
  if (result.upstreamId) {
    check(/^[A-Za-z0-9_-]{1,200}$/.test(result.upstreamId), "上游任务编号无效");
    check(
      !j.upstreamId || j.upstreamId === result.upstreamId,
      "上游任务编号冲突",
    );
    j.upstreamId = result.upstreamId;
  }
  if (result.state === "running") check(j.upstreamId, "缺少上游任务编号");
  if (result.state === "succeeded" && j.quote.input.kind === "audio") {
    check(
      result.audio && /^\/api\/assets\/[a-f0-9]{64}\.wav$/.test(result.audio),
      "生成音频尚未安全入库",
    );
    check(
      Number.isSafeInteger(result.durationMs) &&
        result.durationMs! >= 100 &&
        result.durationMs! <= 30000,
      "生成音频时长无效",
    );
    j.resultAudio = result.audio!;
    j.resultDurationMs = result.durationMs!;
  } else if (result.state === "succeeded") {
    check(
      result.image &&
        /^(\/assets\/(rain-wide|darkroom|rain-portrait)\.png|\/api\/assets\/[a-f0-9]{64}\.(png|jpg))$/.test(
          result.image,
        ),
      "生成图片尚未安全入库",
    );
    const s = p.shots.find((s) => s.id === j.quote.input.shotId)!;
    check(
      !result.video || /^\/api\/assets\/[a-f0-9]{64}\.mp4$/.test(result.video),
      "视频地址无效",
    );
    if (!s.candidates.some((c) => c.id === id))
      s.candidates.push({
        id,
        image: result.image!,
        video: result.video,
        createdAt: now,
        inputRevision: j.quote.input.shotRevision,
        mode: "provider",
      });
    j.resultImage = result.image!;
    j.resultVideo = result.video ?? null;
  }
  j.state = result.state;
  j.errorCode = result.errorCode ?? null;
  j.leaseUntil = 0;
  j.nextQueryAt = now + Math.min(60000, 8000 * 2 ** Math.min(j.queries, 3));
  changed(p);
  return true;
}
export function adoptProviderAudio(p: Project, id: string, revision: number) {
  check(p.revision === revision, "项目版本已变化");
  const j = p.provider?.jobs.find(j => j.id === id);
  check(j?.state === 'succeeded' && j.quote.input.kind === 'audio' && j.resultAudio && j.resultDurationMs, '配音候选不可用');
  const job = j!;
  const index = p.shots.findIndex(s => s.id === job.quote.input.shotId);
  const shot = p.shots[index];
  check(shot && shot.revision === job.quote.input.shotRevision && shot.dialogue === job.quote.input.prompt, '对白或镜头版本已变化，请重新生成当前版本的配音');
  check(job.resultDurationMs! <= shot.seconds * 1000, '配音超出对应镜头时长，请调整对白或镜头后重新生成；不会自动截断');
  // The old automatic-adoption implementation used job IDs as track IDs too.
  // Recognize those historical tracks without deleting their underlying files.
  const sameShot = new Set((p.provider?.jobs ?? []).filter(x => x.quote.input.kind === 'audio' && x.quote.input.shotId === shot.id).map(x => x.id));
  const shotStart = p.shots.slice(0,index).reduce((n,s)=>n+s.seconds*1000,0);
  const shotEnd = shotStart + shot.seconds*1000;
  const existing = p.audioTracks ?? [];
  check(!existing.some(t => t.kind === 'dialogue' && !sameShot.has(t.id) &&
    t.offsetMs < shotEnd && t.offsetMs+t.durationMs > shotStart &&
    (t.offsetMs < shotStart || t.offsetMs+t.durationMs > shotEnd)),
    '已有配音跨越此镜头边界，请先调整或移出编排后再采用');
  const tracks = [...existing.filter(t => !sameShot.has(t.id) &&
    !(t.kind === 'dialogue' && t.offsetMs < shotEnd && t.offsetMs+t.durationMs > shotStart)), {
    id: job.id, name: 'TTS · ' + shot.title.slice(0,60), audio: job.resultAudio!,
    durationMs: job.resultDurationMs!, offsetMs: shotStart,
    volume: 100, kind: 'dialogue' as const, rights: 'generated' as const, createdAt: Date.now(),
  }];
  validateAudioTracks({...p,audioTracks:tracks},true);
  p.audioTracks = tracks;
  p.audioRevision = (p.audioRevision ?? 0) + 1;
  job.errorCode = null;
  changed(p);
}
export function reconcileProvider(
  p: Project,
  id: string,
  actualMicros: number,
  evidence: string,
  revision: number,
) {
  check(p.revision === revision, "项目版本已变化");
  const j = p.provider?.jobs.find((j) => j.id === id);
  check(j, "任务不存在");
  check(
    ["succeeded", "failed", "unknown"].includes(j!.state),
    "执行中任务不能结清",
  );
  check(amount(actualMicros), "账单金额无效");
  check(
    typeof evidence === "string" &&
      evidence.trim().length > 0 &&
      evidence.length <= 500,
    "请记录账单核对依据",
  );
  check(j!.actualMicros === null, "此账单已结清");
  const over = actualMicros > j!.reservedMicros;
  j!.actualMicros = actualMicros;
  j!.reservedMicros = 0;
  j!.billingEvidence = evidence.trim();
  if (over) p.paused = true;
  changed(p);
}
