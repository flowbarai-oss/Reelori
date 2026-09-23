import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../packages/storage-local/store.ts";
import {
  inspectRuntime,
  cachedInspector,
} from "../packages/media/diagnostics.ts";
import { createApi } from "../apps/local-service/server.ts";
import { client } from "./http-helper.ts";
import { createProjectClient } from '../apps/web/src/project-client.ts';
import { requestRuntimeCheck } from '../apps/web/src/runtime-client.ts';

test("runtime inspection encodes a real MP4 without changing project or retaining probe files", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-check-"));
  const store = new Store(":memory:");
  try {
    const before = store.get();
    const report = await inspectRuntime(store, dir);
    assert.equal(report.version, 1);
    assert.equal(report.checks.find((c) => c.id === "encoder")?.status, "pass");
    assert.equal(
      report.checks.find((c) => c.id === "database")?.status,
      "pass",
    );
    assert.deepEqual(store.get(), before);
    assert.deepEqual(readdirSync(dir), []);
    assert.ok(!JSON.stringify(report).includes(dir));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("inspection reports unavailable encoder, broken storage and unavailable database without leaking errors", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-check-"));
  const store = new Store(":memory:");
  try {
    const missing = await inspectRuntime(
      store,
      dir,
      path.join(dir, "secret-missing-executable"),
    );
    assert.equal(
      missing.checks.find((c) => c.id === "encoder")?.status,
      "fail",
    );
    assert.ok(!JSON.stringify(missing).includes("secret-missing"));
    store.close();
    writeFileSync(path.join(dir, "blocked"), "file");
    const blocked = await inspectRuntime(store, path.join(dir, "blocked"));
    assert.equal(
      blocked.checks.find((c) => c.id === "storage")?.status,
      "fail",
    );
    assert.equal(
      blocked.checks.find((c) => c.id === "database")?.status,
      "fail",
    );
    assert.equal(blocked.ready, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("concurrent checks share work and expire cached results", async () => {
  let calls = 0,
    now = 0;
  const inspect = cachedInspector(
    async () => ({ value: ++calls }),
    () => now,
  );
  const [a, b] = await Promise.all([inspect(), inspect()]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  now = 29999;
  await inspect();
  assert.equal(calls, 1);
  now = 30000;
  await inspect();
  assert.equal(calls, 2);
});
test("diagnostics API requires a session and returns cached sanitized checks", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-check-api-"));
  const store = new Store(":memory:");
  const server = createApi(store, 4311, 5178, dir);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const request = client(server);
  try {
    assert.equal((await request("/api/diagnostics", {})).status, 401);
    await request("/api/session");
    const first = await request("/api/diagnostics", {});
    assert.equal(first.status, 200);
    assert.equal(first.data.version, 1);
    const uiRequest = createProjectClient('sample', (route, body) => request('/api/' + route, body));
    assert.equal((await requestRuntimeCheck(uiRequest)).status, 200);
    assert.deepEqual((await request("/api/diagnostics", {})).data, first.data);
    assert.ok(!JSON.stringify(first.data).includes(dir));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
