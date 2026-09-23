import { randomUUID } from "node:crypto";
import type {
  Project,
  ShotPatch,
  Summary,
  ReferenceVersion,
} from "../contracts/index.ts";

export class DomainError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export const SAMPLE_COST_CENTS = 240;
export function seedProject(): Project {
  const initial = [
    [
      "雨夜来信",
      "Rain-letter",
      "雨夜的街头，她回头望向镜头，城市的灯光在雨中展开。",
      "有些照片，记录的不是过去。",
      "远景",
      "/assets/rain-wide.png",
    ],
    [
      "暗房里的明天",
      "Darkroom",
      "她在暗房里看着一张底片，暖光映在脸上，仿佛看见另一个明天。",
      "这张照片，为什么会有明天的日期？",
      "特写",
      "/assets/darkroom.png",
    ],
    [
      "她认出了自己",
      "Reflection",
      "她抬起手中的相机，雨幕中的城市忽然安静下来。",
      "这一次，我想改变结局。",
      "中景",
      "/assets/rain-portrait.png",
    ],
  ];
  return {
    id: "sample",
    title: "明日底片",
    story: "一位修复旧相机的女孩，发现照片里的明天。",
    revision: 1,
    inputRevision: 1,
    referenceRevision: 1,
    budgetCents: 6000,
    shots: initial.map((s, i) => ({
      id: s[1].toLowerCase(),
      title: s[0],
      description: s[2],
      dialogue: s[3],
      frame: s[4],
      image: s[5],
      seconds: 5,
      locked: i === 0,
      revision: 1,
      candidates: [],
      adoptedId: null,
      review: "pending",
    })),
    jobs: [],
    preview: null,
    paused: false,
    events: [],
  };
}
export function summary(p: Project): Summary {
  const settledCents = p.jobs.reduce((n, j) => n + j.settledCents, 0);
  const reservedCents = p.jobs.reduce(
    (n, j) =>
      n +
      (["queued", "running", "unknown"].includes(j.status)
        ? j.reservedCents
        : 0),
    0,
  );
  const usableSeconds = p.shots
    .filter(
      (s) =>
        s.review === "accepted" &&
        s.adoptedId &&
        s.candidates.some(
          (c) => c.id === s.adoptedId && c.inputRevision === s.revision,
        ),
    )
    .reduce((n, s) => n + s.seconds, 0);
  return {
    settledCents,
    reservedCents,
    availableCents: p.budgetCents - settledCents - reservedCents,
    usableSeconds,
  };
}
function event(p: Project, text: string, now = Date.now()) {
  p.events.push({ id: (p.events.at(-1)?.id ?? 0) + 1, text, at: now });
  if (p.events.length > 100) p.events.shift();
}
function bump(p: Project, input = false) {
  p.revision++;
  if (input) p.inputRevision++;
}
function expected(p: Project, revision: number) {
  if (revision !== p.revision)
    throw new DomainError("项目已更新，请刷新后重新保存。", 409);
}
export function updateShot(
  p: Project,
  id: string,
  patch: ShotPatch,
  base: number,
  source: "human" | "ai" = "human",
) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new DomainError("镜头修改格式不正确");
  expected(p, base);
  const shot = p.shots.find((s) => s.id === id);
  if (!shot) throw new DomainError("镜头不存在", 404);
  const allowed = [
    "title",
    "description",
    "dialogue",
    "seconds",
    "frame",
    "locked",
  ];
  for (const key of Object.keys(patch))
    if (!allowed.includes(key)) throw new DomainError("不支持的镜头字段");
  for (const key of ["title", "description", "dialogue", "frame"] as const)
    if (
      patch[key] !== undefined &&
      (typeof patch[key] !== "string" || patch[key]!.length > 2000)
    )
      throw new DomainError("文字长度或格式不正确");
  if (patch.locked !== undefined && typeof patch.locked !== "boolean")
    throw new DomainError("锁定状态不正确");
  if (
    source === "ai" &&
    shot.locked &&
    (patch.dialogue !== undefined || patch.locked === false)
  )
    throw new DomainError("已锁定台词不会被 AI 覆盖", 409);
  if (
    patch.seconds !== undefined &&
    (!Number.isInteger(patch.seconds) ||
      patch.seconds < 2 ||
      patch.seconds > 10)
  )
    throw new DomainError("镜头时长应为 2–10 秒整数");
  if (
    p.shots.reduce(
      (n, s) => n + (s.id === id ? (patch.seconds ?? s.seconds) : s.seconds),
      0,
    ) > 30
  )
    throw new DomainError("首版预演总时长不能超过 30 秒");
  const contentChanged = Object.entries(patch).some(
    ([key, value]) =>
      key !== "locked" && shot[key as keyof typeof shot] !== value,
  );
  Object.assign(shot, patch);
  if (contentChanged) {
    delete shot.clipStartSeconds;
    delete shot.sourceSeconds;
    shot.revision++;
    shot.review = "pending";
  }
  bump(p, contentChanged);
  event(p, "镜头修改已保存");
}
export function confirmPreview(p: Project, base: number) {
  expected(p, base);
  p.preview = {
    id: randomUUID(),
    inputRevision: p.inputRevision,
    referenceRevision: p.referenceRevision,
    shots: structuredClone(p.shots),
    createdAt: Date.now(),
  };
  bump(p);
  event(p, "分镜预演版本已确认");
}
export function queueSample(
  p: Project,
  ids: string[],
  operationId: string,
  base: number,
  now = Date.now(),
) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 6 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !p.shots.some((s) => s.id === id))
  )
    throw new DomainError("请选择有效镜头");
  if (
    typeof operationId !== "string" ||
    operationId.length < 8 ||
    operationId.length > 100
  )
    throw new DomainError("操作标识无效");
  const existing = p.jobs.filter((j) => j.operationId === operationId);
  if (existing.length) {
    if (
      [...new Set(ids)].sort().join() !==
      existing
        .map((j) => j.shotId)
        .sort()
        .join()
    )
      throw new DomainError("操作标识已用于其他镜头", 409);
    return;
  }
  expected(p, base);
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 6 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !p.shots.some((s) => s.id === id))
  )
    throw new DomainError("请选择有效镜头");
  if (!p.preview || p.preview.inputRevision !== p.inputRevision)
    throw new DomainError("请先预演并确认当前分镜版本", 409);
  if (p.paused) throw new DomainError("请先恢复后续任务", 409);
  if (
    p.jobs.some(
      (j) =>
        ids.includes(j.shotId) &&
        ["queued", "running", "unknown"].includes(j.status),
    )
  )
    throw new DomainError("所选镜头仍有待完成或待核对任务", 409);
  if (summary(p).availableCents < ids.length * SAMPLE_COST_CENTS)
    throw new DomainError("模拟预算不足，请调整上限或减少镜头", 409);
  for (const id of ids)
    p.jobs.push({
      id: randomUUID(),
      operationId,
      shotId: id,
      shotRevision: p.shots.find((s) => s.id === id)!.revision,
      referenceRevision: p.referenceRevision,
      status: "queued",
      createdAt: now,
      startedAt: null,
      completedAt: null,
      reservedCents: SAMPLE_COST_CENTS,
      settledCents: 0,
      stage: 0,
    });
  bump(p);
  event(p, `已预留 ${ids.length} 个示例任务的模拟预算`, now);
}
export function tick(p: Project, now = Date.now()) {
  let changed = false;
  for (const j of p.jobs.filter((j) => j.status === "running")) {
    const stage = Math.min(4, Math.floor((now - (j.startedAt ?? now)) / 850));
    if (stage !== j.stage) {
      j.stage = stage;
      changed = true;
    }
    if (stage === 4) {
      j.status = "succeeded";
      j.completedAt = now;
      j.settledCents = j.reservedCents;
      j.reservedCents = 0;
      const shot = p.shots.find((s) => s.id === j.shotId)!;
      shot.candidates.push({
        id: j.id,
        image: shot.image,
        createdAt: now,
        inputRevision: j.shotRevision,
        mode: "sample",
      });
      event(p, `示例候选已准备：${shot.title}`, now);
      changed = true;
    }
  }
  if (!p.paused && !p.jobs.some((j) => j.status === "running")) {
    const next = p.jobs.find((j) => j.status === "queued");
    if (next) {
      next.status = "running";
      next.startedAt = now;
      next.stage = 0;
      changed = true;
    }
  }
  if (changed) bump(p);
  return changed;
}
export function adopt(
  p: Project,
  shotId: string,
  candidateId: string,
  base: number,
) {
  expected(p, base);
  const shot = p.shots.find((s) => s.id === shotId);
  const candidate = shot?.candidates.find((c) => c.id === candidateId);
  if (!shot || !candidate) throw new DomainError("候选不存在", 404);
  if (candidate.inputRevision !== shot.revision)
    throw new DomainError("此候选对应旧输入，请生成当前版本", 409);
  const resetCut = shot.adoptedId !== candidateId && shot.sourceSeconds !== undefined;
  if (resetCut) {
    delete shot.clipStartSeconds;
    delete shot.sourceSeconds;
  }
  shot.adoptedId = candidateId;
  shot.review = "accepted";
  bump(p, resetCut);
  event(p, `已采用：${shot.title}`);
}
export function setBudget(p: Project, cents: number, base: number) {
  expected(p, base);
  const totals = summary(p);
  if (
    !Number.isInteger(cents) ||
    cents < totals.settledCents + totals.reservedCents ||
    cents > 1000000
  )
    throw new DomainError(
      "预算不能低于已结算与预留之和，且须在 ¥0–10,000 之间",
    );
  p.budgetCents = cents;
  bump(p);
}
export function addReference(
  p: Project,
  reference: ReferenceVersion,
  base: number,
) {
  expected(p, base);
  if (
    !reference ||
    !["owned", "licensed", "generated"].includes(reference.rights) ||
    typeof reference.name !== "string" ||
    !reference.name.trim() ||
    reference.name.length > 80 ||
    typeof reference.note !== "string" ||
    !reference.note.trim() ||
    reference.note.length > 500
  )
    throw new DomainError("请填写参考名称、来源类型和权利说明");
  p.references = [...(p.references ?? []), structuredClone(reference)];
  p.referenceRevision++;
  for (const shot of p.shots) {
    shot.revision++;
    shot.review = "pending";
  }
  bump(p, true);
  event(p, "参考版本已更新，全部镜头须重新生成并复核");
}
export function pause(p: Project, value: boolean) {
  p.paused = value;
  bump(p);
  event(
    p,
    value ? "已暂停后续示例任务，进行中的任务继续完成" : "已恢复后续示例任务",
  );
}
export function markUnknown(p: Project, jobId: string) {
  const j = p.jobs.find((j) => j.id === jobId);
  if (!j || !["running", "queued"].includes(j.status))
    throw new DomainError("任务状态无效");
  j.status = "unknown";
  bump(p);
}
export function manifest(p: Project) {
  const approved = p.shots.filter(
    (s) => s.adoptedId && s.review === "accepted",
  );
  if (approved.length !== p.shots.length)
    throw new DomainError("请先逐镜采用候选，再导出项目清单", 409);
  return {
    schemaVersion: 1,
    mode: approved.every(
      (s) => s.candidates.find((c) => c.id === s.adoptedId)?.mode === "sample",
    )
      ? "sample"
      : approved.every(
            (s) =>
              s.candidates.find((c) => c.id === s.adoptedId)?.mode ===
              "provider",
          )
        ? "provider"
        : "mixed",
    project: p.title,
    snapshotId: randomUUID(),
    createdAt: new Date().toISOString(),
    durationSeconds: approved.reduce((n, s) => n + s.seconds, 0),
    audioRevision:p.audioRevision??0,
    audioTracks:p.audioTracks??[],
    shots: approved.map((s, i) => ({
      order: i + 1,
      id: s.id,
      title: s.title,
      seconds: s.seconds,
      clipStartSeconds: s.clipStartSeconds ?? 0,
      sourceSeconds: s.sourceSeconds ?? s.seconds,
      candidateId: s.adoptedId,
      dialogue: s.dialogue,
      provenance: s.candidates.find((c) => c.id === s.adoptedId)!.mode,
      source:
        s.candidates.find((c) => c.id === s.adoptedId)!.video ??
        s.candidates.find((c) => c.id === s.adoptedId)!.image,
    })),
    cost: { ...summary(p), currency: "CNY", simulated: true },
    providerCost: {
      currency: "USD",
      unit: "micros",
      simulated: false,
      actualMicros: (p.provider?.jobs ?? []).reduce(
        (n, j) => n + (j.actualMicros ?? 0),
        0,
      ),
      reservedMicros: (p.provider?.jobs ?? []).reduce(
        (n, j) => n + j.reservedMicros,
        0,
      ),
      unsettledJobs: (p.provider?.jobs ?? []).filter(
        (j) => j.actualMicros === null,
      ).length,
    },
  };
}
