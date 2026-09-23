import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApi } from "../apps/local-service/server.ts";
import { Store } from "../packages/storage-local/store.ts";
import { client } from "./http-helper.ts";
test("reference upload validates bytes and rights, stores immutable media and rejects traversal", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-media-"));
  const store = new Store(":memory:");
  const server = createApi(store, 4311, 5178, path.join(dir, "exports"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const request = client(server);
  try {
    await request("/api/session");
    const body = {
      revision: 1,
      name: "林夏参考",
      rights: "generated",
      note: "项目内置 AI 生成图",
      data: readFileSync("public/assets/rain-portrait.png").toString("base64"),
    };
    const bad = await request("/api/reference", {
      ...body,
      data: Buffer.from("<svg></svg>").toString("base64"),
    });
    assert.equal(bad.status, 400);
    const saved = await request("/api/reference", body);
    assert.equal(saved.status, 200);
    assert.equal(saved.data.references.length, 1);
    const image = await request(saved.data.references[0].image);
    assert.equal(image.status, 200);
    assert.equal(image.headers["content-type"], "image/png");
    assert.deepEqual(
      image.bytes,
      readFileSync("public/assets/rain-portrait.png"),
    );
    assert.equal((await request("/api/reference", body)).status, 409);
    assert.equal((await request("/api/assets/..%2Fstudio.sqlite")).status, 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
