import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../packages/storage-local/store.ts";
import { createApi } from "../apps/local-service/server.ts";
import { client } from "./http-helper.ts";
test("backup API preserves downloadable history and restore requires unchanged inspected contents", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-backup-api-"));
  const store = new Store(":memory:");
  const server = createApi(store, 4311, 5178, path.join(dir, "exports"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const request = client(server);
  try {
    await request("/api/session");
    const made = await request("/api/backup", { revision: 1 });
    assert.equal(made.status, 200);
    const saved = await request(made.data.download);
    assert.equal(saved.status, 200);
    assert.match(String(saved.headers["content-disposition"]), /reelori\.json/);
    assert.equal(
      (await request("/api/backups")).data[0].download,
      made.data.download,
    );
    const archive = saved.data;
    assert.equal((await request("/api/restore", { archive })).status, 400);
    const inspection = await request("/api/backup-inspect", { archive });
    assert.equal(inspection.status, 200);
    const altered = structuredClone(archive);
    altered.project.title = "tampered";
    assert.equal(
      (
        await request("/api/restore", {
          archive: altered,
          ...inspection.data.confirmation,
        })
      ).status,
      400,
    );
    assert.equal(store.list().length, 1);
    const restored = await request("/api/restore", {
      archive,
      ...inspection.data.confirmation,
    });
    assert.equal(restored.status, 201);
    assert.notEqual(restored.data.id, "sample");
    assert.equal(store.list().length, 2);
    assert.equal((await request("/api/backup", { revision: 0 })).status, 409);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
