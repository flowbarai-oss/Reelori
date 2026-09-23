import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../packages/storage-local/store.ts";
import { createApi } from "../apps/local-service/server.ts";
import { client } from "./http-helper.ts";

test("local model-group edits persist without exposing credentials or accepting stale edits", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-model-groups-"));
  const store = new Store(path.join(dir, "studio.sqlite"));
  const initial = {
    enabled: true,
    routes: [
      {
        id: "existing",
        provider: "flowbar" as const,
        kind: "image" as const,
        model: "fixture-image",
        size: "1024x1024",
        upperMicros: 150000,
        pricingVersion: "verified-v1",
        expiresAt: Date.now() + 86400000,
        billingNote: "fixture price",
      },
    ],
  };
  const server = createApi(store, 4311, 5178, path.join(dir, "exports"), {
    config: initial,
    key: "fixture-secret",
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = client(server);
  try {
    await request("/api/session");
    const before = (await request("/api/provider")).data;
    assert.equal(typeof before.configRevision, "string");
    assert.equal(before.routes.length, 1);
    assert.equal(before.credentials.flowbar, true);
    assert.ok(!JSON.stringify(before).includes("fixture-secret"));
    const added = {
      id: "new-image",
      provider: "flowbar",
      kind: "image",
      model: "fixture-image-2",
      size: "1024x1024",
      upperMicros: 220000,
      pricingVersion: "checked-v2",
      expiresAt: Date.now() + 86400000,
      billingNote: "manually checked USD cap",
      enabled: true,
    };
    const update = await request("/api/provider-routes", {
      revision: before.configRevision,
      routes: [...before.routes, added],
    });
    assert.equal(update.status, 200, JSON.stringify(update.data));
    assert.equal(update.data.routes.length, 2);
    assert.notEqual(update.data.configRevision, before.configRevision);
    const disabled = await request("/api/provider-routes", {
      revision: update.data.configRevision,
      routes: update.data.routes.map((r: any) =>
        r.id === "new-image" ? { ...r, enabled: false } : r,
      ),
    });
    assert.equal(disabled.status, 200);
    const visible = (await request("/api/provider")).data;
    assert.equal(visible.routes.length, 1);
    assert.equal(visible.catalogRoutes.length, 2);
    const project = (await request("/api/project")).data;
    const hiddenQuote = await request("/api/provider-quote", {
      routeId: "new-image",
      shotId: project.shots[0].id,
      revision: project.revision,
    });
    assert.equal(hiddenQuote.status, 409);
    assert.equal(
      (
        await request("/api/provider-routes", {
          revision: before.configRevision,
          routes: [],
        })
      ).status,
      409,
    );
    const invalid = await request("/api/provider-routes", {
      revision: disabled.data.configRevision,
      routes: [
        {
          ...added,
          id: "bad-h3",
          provider: "minimax-cn",
          kind: "video",
          model: "unknown-h3",
          size: "768P:9:16",
        },
      ],
    });
    assert.equal(invalid.status, 409);
    const attemptedSecret = await request("/api/provider-routes", {
      revision: disabled.data.configRevision,
      routes: [
        ...disabled.data.catalogRoutes,
        { ...added, id: "leak", key: "must-never-save" },
      ],
    });
    assert.equal(attemptedSecret.status, 409);
    const duplicate = await request("/api/provider-routes", {
      revision: disabled.data.configRevision,
      routes: [...disabled.data.catalogRoutes, { ...added, id: "existing" }],
    });
    assert.equal(duplicate.status, 409);
    assert.equal((await request("/api/provider")).data.routes.length, 1);
    const saved = readFileSync(path.join(dir, "flowbar.json"), "utf8");
    assert.ok(saved.includes("new-image"));
    assert.ok(!saved.includes("fixture-secret"));
    assert.ok(!saved.includes("must-never-save"));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a MiniMax key never unlocks a FlowBar international route", async () => {
  const previous = process.env.REELORI_MINIMAX_KEY;
  process.env.REELORI_MINIMAX_KEY = "minimax-only-fixture";
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-flowbar-key-scope-"));
  const store = new Store(path.join(dir, "studio.sqlite"));
  const config = {
    enabled: true,
    routes: [
      {
        id: "international-flowbar",
        provider: "flowbar" as const,
        kind: "image" as const,
        model: "fixture-image",
        size: "1024x1024",
        upperMicros: 100000,
        pricingVersion: "fixture-v1",
        expiresAt: Date.now() + 86400000,
      },
    ],
  };
  const server = createApi(store, 4311, 5178, path.join(dir, "exports"), {
    config,
    key: "",
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = client(server);
  try {
    await request("/api/session");
    const connection = (await request("/api/provider")).data;
    assert.equal(connection.keyConfigured, true);
    assert.equal(connection.credentials.flowbar, false);
    assert.equal(connection.credentials.minimax, true);
    const quote = await request("/api/provider-quote", {
      routeId: "international-flowbar",
    });
    assert.equal(quote.status, 409);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.REELORI_MINIMAX_KEY;
    else process.env.REELORI_MINIMAX_KEY = previous;
  }
});
