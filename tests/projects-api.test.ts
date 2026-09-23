import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/storage-local/store.ts";
import { createApi } from "../apps/local-service/server.ts";
import { client } from "./http-helper.ts";
test("API lists, creates and edits the selected project; unknown project reads are safe 404s", async () => {
  const store = new Store(":memory:");
  const server = createApi(store);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const request = client(server);
  try {
    await request("/api/session");
    const created = await request("/api/projects", {
      title: "新故事",
      story: "原文保留",
    });
    assert.equal(created.status, 201);
    const p = created.data;
    assert.equal((await request("/api/projects")).data.length, 2);
    assert.equal(
      (await request(`/api/project?projectId=${p.id}`)).data.title,
      "新故事",
    );
    assert.equal(
      (
        await request(`/api/shot?projectId=${p.id}`, {
          id: p.shots[0].id,
          patch: { dialogue: "你好" },
          revision: 1,
        })
      ).status,
      200,
    );
    assert.equal(store.get(p.id).shots[0].dialogue, "你好");
    assert.equal(store.get().revision, 1);
    assert.equal((await request("/api/project?projectId=missing")).status, 404);
    assert.equal((await request("/api/project?projectId=sample")).status, 200);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});
