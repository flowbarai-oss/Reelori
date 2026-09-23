import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../apps/local-service/server.ts";
import { Store } from "../packages/storage-local/store.ts";
import { client } from "./http-helper.ts";
import * as clients from "../apps/web/src/project-client.ts";
test("a delayed project operation stays bound to its original project after switching", async () => {
  const store = new Store(":memory:");
  const a = store.create({ title: "A", story: "A" }),
    b = store.create({ title: "B", story: "B" });
  const server = createApi(store);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const request = client(server);
  try {
    await request("/api/session");
    let activeId = a.id;
    const bound = clients.createProjectClient(activeId, (route, body) =>
      request("/api/" + route, body),
    );
    let release!: () => void;
    const ready = new Promise<void>((r) => {
      release = r;
    });
    const pending = (async () => {
      await ready;
      return bound("budget", { revision: 1, cents: 1700 });
    })();
    activeId = b.id;
    release();
    assert.equal((await pending).status, 200);
    assert.equal(store.get(a.id).budgetCents, 1700);
    assert.equal(store.get(activeId).budgetCents, 6000);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});
