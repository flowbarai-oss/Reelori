import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  seedProject,
  confirmPreview,
  queueSample,
  tick,
  summary,
  updateShot,
  adopt,
  setBudget,
  pause,
  markUnknown,
  manifest,
} from "../packages/core/project.ts";
import { Store } from "../packages/storage-local/store.ts";
const prepared = () => {
  const p = seedProject();
  confirmPreview(p, p.revision);
  return p;
};
test("generation requires current preview; edits invalidate it without mutating snapshot", () => {
  const p = seedProject();
  assert.throws(() => queueSample(p, [p.shots[0].id], "attempt-1", p.revision));
  confirmPreview(p, p.revision);
  const original = p.preview!.shots[0].dialogue;
  updateShot(p, p.shots[0].id, { dialogue: "Changed" }, p.revision);
  assert.equal(p.preview!.shots[0].dialogue, original);
  assert.throws(() => queueSample(p, [p.shots[0].id], "attempt-2", p.revision));
});
test("locked dialogue blocks AI changes, human may explicitly edit", () => {
  const p = seedProject();
  assert.throws(() =>
    updateShot(
      p,
      p.shots[0].id,
      { dialogue: "AI overwrite" },
      p.revision,
      "ai",
    ),
  );
  updateShot(p, p.shots[0].id, { dialogue: "Human edit" }, p.revision);
  assert.equal(p.shots[0].dialogue, "Human edit");
});
test("stale clients cannot overwrite changes", () => {
  const p = seedProject();
  const base = p.revision;
  updateShot(p, p.shots[0].id, { title: "New" }, base);
  assert.throws(() => updateShot(p, p.shots[0].id, { title: "Old" }, base));
  assert.equal(p.shots[0].title, "New");
});
test("idempotent submission reserves budget once, including stale response retries", () => {
  const p = prepared();
  const base = p.revision;
  queueSample(p, [p.shots[0].id], "attempt-1", base, 100);
  queueSample(p, [p.shots[0].id], "attempt-1", base, 100);
  assert.equal(p.jobs.length, 1);
  assert.equal(summary(p).reservedCents, 240);
  assert.throws(() => queueSample(p, [p.shots[1].id], "attempt-1", p.revision));
});
test("budget prevents oversubscription and cannot shrink below reservation", () => {
  const p = prepared();
  setBudget(p, 240, p.revision);
  queueSample(p, [p.shots[0].id], "attempt-1", p.revision);
  assert.throws(() => queueSample(p, [p.shots[1].id], "attempt-2", p.revision));
  assert.throws(() => setBudget(p, 239, p.revision));
  assert.equal(summary(p).availableCents, 0);
});
test("completion settles once and never auto-adopts", () => {
  const p = prepared();
  queueSample(p, [p.shots[0].id], "attempt-1", p.revision, 100);
  tick(p, 100);
  tick(p, 4000);
  tick(p, 8000);
  assert.equal(p.shots[0].candidates.length, 1);
  assert.equal(summary(p).settledCents, 240);
  assert.equal(summary(p).reservedCents, 0);
  assert.equal(summary(p).usableSeconds, 0);
  adopt(p, p.shots[0].id, p.shots[0].candidates[0].id, p.revision);
  assert.equal(summary(p).usableSeconds, 5);
});
test("pausing stops only later jobs, current job can finish", () => {
  const p = prepared();
  queueSample(
    p,
    p.shots.map((s) => s.id),
    "attempt-1",
    p.revision,
    100,
  );
  tick(p, 100);
  pause(p, true);
  tick(p, 4000);
  assert.equal(p.jobs[0].status, "succeeded");
  assert.equal(p.jobs[1].status, "queued");
  assert.equal(summary(p).reservedCents, 480);
  pause(p, false);
  tick(p, 4100);
  assert.equal(p.jobs[1].status, "running");
});
test("unknown jobs retain reservation and cannot be blindly resubmitted", () => {
  const p = prepared();
  queueSample(p, [p.shots[0].id], "attempt-1", p.revision);
  markUnknown(p, p.jobs[0].id);
  tick(p);
  assert.equal(summary(p).reservedCents, 240);
  assert.throws(() => queueSample(p, [p.shots[0].id], "attempt-2", p.revision));
});
test("candidate from a stale shot cannot be adopted", () => {
  const p = prepared();
  queueSample(p, [p.shots[0].id], "attempt-1", p.revision, 100);
  tick(p, 100);
  updateShot(p, p.shots[0].id, { title: "Changed while running" }, p.revision);
  tick(p, 4000);
  assert.throws(() =>
    adopt(p, p.shots[0].id, p.shots[0].candidates[0].id, p.revision),
  );
});
test("a new candidate preserves the adopted result until explicitly replaced", () => {
  const p = prepared();
  const s = p.shots[0];
  queueSample(p, [s.id], "attempt-1", p.revision, 100);
  tick(p, 100);
  tick(p, 4000);
  adopt(p, s.id, s.candidates[0].id, p.revision);
  const oldId = s.adoptedId;
  queueSample(p, [s.id], "attempt-2", p.revision, 5000);
  tick(p, 5000);
  tick(p, 9000);
  assert.equal(s.adoptedId, oldId);
  assert.equal(s.candidates.length, 2);
  adopt(p, s.id, s.candidates[1].id, p.revision);
  assert.notEqual(s.adoptedId, oldId);
});
test("manifest requires every shot adopted and explicitly labels simulated costs", () => {
  const p = prepared();
  assert.throws(() => manifest(p));
  queueSample(
    p,
    p.shots.map((s) => s.id),
    "attempt-1",
    p.revision,
    100,
  );
  for (const now of [100, 4000, 8000, 12000]) tick(p, now);
  for (const s of p.shots) adopt(p, s.id, s.candidates[0].id, p.revision);
  const m = manifest(p);
  assert.equal(m.durationSeconds, 15);
  assert.equal(m.cost.simulated, true);
  assert.equal(m.cost.settledCents, 720);
  updateShot(p, p.shots[0].id, { seconds: 6 }, p.revision);
  assert.throws(() => manifest(p));
});
test("malformed mutations are rejected with domain errors", () => {
  const p = prepared();
  assert.throws(() => updateShot(p, p.shots[0].id, null as never, p.revision), {
    status: 400,
  });
  assert.throws(() => queueSample(p, null as never, "attempt-1", p.revision), {
    status: 400,
  });
  assert.throws(() =>
    updateShot(p, p.shots[0].id, { seconds: 99 }, p.revision),
  );
});
test("SQLite persists queued work across restart and atomically rolls back failed writes", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "drama-test-"));
  const file = path.join(dir, "test.sqlite");
  let store = new Store(file);
  try {
    store.transact((p) => {
      confirmPreview(p, p.revision);
      queueSample(p, [p.shots[0].id], "attempt-1", p.revision, 100);
    });
    store.close();
    store = new Store(file);
    assert.equal(store.get().jobs.length, 1);
    assert.equal(summary(store.get()).reservedCents, 240);
    assert.throws(() =>
      store.transact((p) => {
        p.title = "Broken";
        throw Error("failure");
      }),
    );
    assert.equal(store.get().title, "明日底片");
    store.tick(100);
    store.tick(4000);
    assert.equal(store.get().jobs[0].status, "succeeded");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
