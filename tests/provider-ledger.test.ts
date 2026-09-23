import test from "node:test";
import assert from "node:assert/strict";
import { seedProject, confirmPreview } from "../packages/core/project.ts";
import * as engine from "../packages/providers/ledger.ts";
function setup() {
  const p = seedProject();
  confirmPreview(p, p.revision);
  engine.setProviderBudget(p, 1000000, p.revision);
  return p;
}
function quote(p: ReturnType<typeof setup>) {
  return engine.makeQuote(
    p,
    p.shots[0].id,
    {
      kind: "image",
      model: "fixture",
      size: "1024x1024",
      upperMicros: 300000,
      pricingVersion: "fixture-v1",
    },
    100,
  );
}
test("unsubmitted reservations can be cancelled but attempted work cannot be released", () => {
  const p = setup();
  engine.reserveProvider(p, quote(p), "operation-cancel", p.revision, 101);
  const job = p.provider!.jobs[0];
  engine.cancelReservedProvider(p, job.id, p.revision);
  assert.equal(job.state, "failed");
  assert.equal(job.actualMicros, 0);
  assert.equal(job.reservedMicros, 0);
  assert.equal(engine.claimProvider(p, job.id, 102), null);
  const q = quote(p);
  engine.reserveProvider(p, q, "operation-attempt", p.revision, 103);
  const attempted = p.provider!.jobs[1];
  engine.claimProvider(p, attempted.id, 104);
  assert.throws(() =>
    engine.cancelReservedProvider(p, attempted.id, p.revision),
  );
  assert.equal(attempted.reservedMicros, 300000);
});
test("real USD budget and immutable quote reserve atomically and deduplicate operations", () => {
  const p = setup(),
    q = quote(p);
  engine.reserveProvider(p, q, "operation-123", p.revision, 101);
  const old = structuredClone(p);
  engine.reserveProvider(p, q, "operation-123", 1, 102);
  assert.deepEqual(p, old);
  assert.equal(engine.providerTotals(p).reservedMicros, 300000);
  assert.equal(p.jobs.length, 0);
  assert.throws(() => engine.setProviderBudget(p, 299999, p.revision));
  const changed = structuredClone(q);
  changed.input.prompt = "changed";
  assert.throws(() =>
    engine.reserveProvider(p, changed, "operation-123", p.revision, 102),
  );
});
test("a deliberate redo retains the prior unsettled reservation and adopted candidate", () => {
  const p = setup();
  engine.reserveProvider(p, quote(p), "operation-original", p.revision, 101);
  const job = p.provider!.jobs[0],
    claim = engine.claimProvider(p, job.id, 102)!;
  engine.applyProvider(
    p,
    job.id,
    claim.generation,
    { state: "succeeded", image: "/assets/rain-wide.png" },
    103,
  );
  p.shots[0].adoptedId = job.id;
  engine.reserveProvider(p, quote(p), "operation-redo", p.revision, 104);
  assert.equal(engine.providerTotals(p).reservedMicros, 600000);
  assert.equal(p.shots[0].adoptedId, job.id);
  assert.equal(job.actualMicros, null);
  assert.throws(() =>
    engine.reserveProvider(
      p,
      quote(p),
      "operation-concurrent",
      p.revision,
      105,
    ),
  );
});
test("lost submit response never permits resubmission; lease takeover fences stale writes", () => {
  const p = setup();
  engine.reserveProvider(p, quote(p), "operation-123", p.revision, 101);
  const id = p.provider!.jobs[0].id;
  const first = engine.claimProvider(p, id, 102)!;
  assert.equal(first.action, "submit");
  assert.equal(engine.claimProvider(p, id, 103), null);
  const later = engine.claimProvider(p, id, first.leaseUntil + 1);
  assert.equal(later, null);
  assert.equal(p.provider!.jobs[0].state, "unknown");
  assert.equal(engine.providerTotals(p).reservedMicros, 300000);
  assert.equal(
    engine.applyProvider(
      p,
      id,
      first.generation,
      { state: "running", upstreamId: "remote-1" },
      first.leaseUntil + 2,
    ),
    false,
  );
});
test("query recovery keeps upstream identity, duplicate terminal writes do not settle unknown bills", () => {
  const p = setup();
  engine.reserveProvider(p, quote(p), "operation-123", p.revision, 101);
  const id = p.provider!.jobs[0].id;
  const first = engine.claimProvider(p, id, 102)!;
  engine.applyProvider(
    p,
    id,
    first.generation,
    { state: "running", upstreamId: "remote-1" },
    103,
  );
  p.paused = true;
  const next = engine.claimProvider(p, id, 20000)!;
  assert.equal(next.action, "query");
  engine.applyProvider(
    p,
    id,
    next.generation,
    { state: "succeeded", image: "/assets/rain-wide.png" },
    20001,
  );
  assert.equal(p.shots[0].adoptedId, null);
  assert.equal(engine.providerTotals(p).reservedMicros, 300000);
  engine.reconcileProvider(p, id, 400000, "Provider bill 123", p.revision);
  assert.equal(engine.providerTotals(p).actualMicros, 400000);
  assert.equal(p.paused, true);
  assert.equal(
    engine.applyProvider(p, id, next.generation, { state: "failed" }, 20002),
    false,
  );
  assert.equal(p.provider!.jobs[0].state, "succeeded");
});
test("stale or expired quotes cannot reserve, settled overruns remain visible", () => {
  const p = setup(),
    q = quote(p);
  assert.throws(() =>
    engine.reserveProvider(p, q, "operation-123", p.revision, q.expiresAt + 1),
  );
  p.shots[0].revision++;
  assert.throws(() =>
    engine.reserveProvider(p, q, "operation-123", p.revision, 101),
  );
});
