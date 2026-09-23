import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../packages/storage-local/store.ts";
import { createApi } from "../apps/local-service/server.ts";
import { client } from "./http-helper.ts";
import {
  createBackup,
  restoreBackup,
} from "../packages/storage-local/backup.ts";
import { claimProvider } from "../packages/providers/ledger.ts";
test("API requires a server-issued quote and explicit USD budget; replay, backup and restore preserve reservations", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-provider-api-"));
  const store = new Store(":memory:");
  let calls = 0;
  const config = {
    enabled: true,
    routes: [
      {
        id: "test",
        kind: "image" as const,
        model: "fixture",
        size: "1024x1024",
        upperMicros: 100000,
        pricingVersion: "test-v1",
        expiresAt: Date.now() + 60000,
      },
    ],
  };
  const adapter = {
    submit: async () => {
      calls++;
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
  const server = createApi(store, 4311, 5178, path.join(dir, "exports"), {
    config,
    key: "never-expose-key",
    adapter,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const request = client(server);
  try {
    await request("/api/session");
    let p = (await request("/api/preview", { revision: 1 })).data;
    let q = (
      await request("/api/provider-quote", {
        revision: p.revision,
        shotId: p.shots[0].id,
        routeId: "test",
      })
    ).data;
    assert.equal(
      (
        await request("/api/provider-submit", {
          quoteId: q.id,
          operationId: "operation-123",
          revision: p.revision,
        })
      ).status,
      409,
    );
    p = (
      await request("/api/provider-budget", {
        micros: 1000000,
        revision: p.revision,
      })
    ).data;
    assert.equal(
      (
        await request("/api/provider-submit", {
          quoteId: "invented",
          operationId: "operation-123",
          revision: p.revision,
        })
      ).status,
      409,
    );
    p = (
      await request("/api/provider-submit", {
        quoteId: q.id,
        operationId: "operation-123",
        revision: p.revision,
      })
    ).data;
    const id = p.provider.jobs[0].id;
    assert.equal(
      (
        await request("/api/provider-submit", {
          quoteId: q.id,
          operationId: "operation-123",
          revision: 1,
        })
      ).status,
      200,
    );
    const result = await request("/api/provider-run", { jobId: id });
    assert.equal(result.status, 200);
    assert.equal(result.data.provider.jobs[0].state, "succeeded");
    assert.equal(calls, 1);
    await request("/api/provider-run", { jobId: id });
    assert.equal(calls, 1);
    const archive = await createBackup(
      store,
      "sample",
      path.join(dir, "assets"),
    );
    assert.ok(!JSON.stringify(archive).includes("never-expose-key"));
    const copy = await restoreBackup(store, archive, path.join(dir, "assets"));
    assert.equal(copy.provider!.jobs[0].reservedMicros, 100000);
    assert.equal(copy.provider!.jobs[0].recoveryBlocked, true);
    assert.equal(claimProvider(copy, id), null);
    assert.ok(
      !JSON.stringify((await request("/api/provider")).data).includes(
        "never-expose-key",
      ),
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
