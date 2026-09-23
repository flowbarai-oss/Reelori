import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../packages/storage-local/store.ts";
import { confirmPreview } from "../packages/core/project.ts";
import {
  setProviderBudget,
  makeQuote,
  reserveProvider,
} from "../packages/providers/ledger.ts";
import {
  runProviderJob,
  nextRecoveryJob,
} from "../packages/providers/worker.ts";
test("worker persists submission before network and imports generated image without adopting or settling", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-worker-"));
  const store = new Store(":memory:");
  try {
    store.transact((p) => {
      confirmPreview(p, p.revision);
      setProviderBudget(p, 1000000, p.revision);
      reserveProvider(
        p,
        makeQuote(p, p.shots[0].id, {
          kind: "image",
          model: "fixture",
          size: "1024x1024",
          upperMicros: 300000,
          pricingVersion: "fixture",
        }),
        "operation-123",
        p.revision,
      );
    });
    const id = store.get().provider!.jobs[0].id;
    let calls = 0;
    const adapter = {
      submit: async () => {
        calls++;
        assert.equal(store.get().provider!.jobs[0].state, "submitting");
        return {
          state: "succeeded" as const,
          imageBase64: readFileSync("public/assets/rain-wide.png").toString(
            "base64",
          ),
        };
      },
      query: async () => ({ state: "failed" as const }),
      content: async () => Buffer.alloc(0),
    };
    await Promise.all([
      runProviderJob(store, "sample", id, adapter, dir),
      runProviderJob(store, "sample", id, adapter, dir),
    ]);
    const p = store.get();
    assert.equal(calls, 1);
    assert.equal(p.provider!.jobs[0].state, "succeeded");
    assert.equal(p.provider!.jobs[0].reservedMicros, 300000);
    assert.equal(p.shots[0].candidates[0].mode, "provider");
    assert.equal(p.shots[0].adoptedId, null);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("restart recovery selects original task IDs and never dispatches new reservations or restored copies", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-recovery-"));
  let store = new Store(path.join(dir, "studio.sqlite"));
  try {
    store.transact((p) => {
      confirmPreview(p, p.revision);
      setProviderBudget(p, 1000000, p.revision);
      for (let i = 0; i < 3; i++)
        reserveProvider(
          p,
          makeQuote(p, p.shots[i].id, {
            kind: "video",
            model: "fixture",
            size: "720*1280",
            upperMicros: 100000,
            pricingVersion: "fixture",
          }),
          "operation-" + i,
          p.revision,
        );
      const jobs = p.provider!.jobs;
      jobs[1].state = "running";
      jobs[1].upstreamId = "original-id";
      jobs[1].nextQueryAt = 0;
      jobs[2].state = "running";
      jobs[2].upstreamId = "restored-id";
      jobs[2].recoveryBlocked = true;
    });
    store.close();
    store = new Store(path.join(dir, "studio.sqlite"));
    const found = nextRecoveryJob(store)!;
    assert.equal(found.jobId, store.get().provider!.jobs[1].id);
    let queried = "";
    await runProviderJob(
      store,
      found.projectId,
      found.jobId,
      {
        submit: async () => {
          throw Error("must not submit");
        },
        query: async (id) => {
          queried = id;
          return { state: "failed" };
        },
        content: async () => Buffer.alloc(0),
      },
      dir,
    );
    assert.equal(queried, "original-id");
    assert.equal(nextRecoveryJob(store), null);
    assert.equal(store.get().provider!.jobs[0].state, "reserved");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
