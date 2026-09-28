import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../packages/storage-local/store.ts";
import { createApi } from "../apps/local-service/server.ts";
import { loadProviderKey } from "../packages/providers/config.ts";
import { client } from "./http-helper.ts";

test("FlowBarAI key can be managed locally without exposing or switching an active job", {
  skip: process.platform !== "win32",
}, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-flowbar-key-"));
  const previousLocalAppData = process.env.LOCALAPPDATA;
  const previousDirectKey = process.env.REELORI_FLOWBAR_KEY;
  const previousKeyFile = process.env.REELORI_FLOWBAR_KEY_FILE;
  process.env.LOCALAPPDATA = dir;
  delete process.env.REELORI_FLOWBAR_KEY;
  delete process.env.REELORI_FLOWBAR_KEY_FILE;
  const store = new Store(":memory:");
  const server = createApi(store, 4311, 5178, path.join(dir, "exports"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = client(server);
  const key = "sk-" + "testsecret".repeat(4);
  try {
    await request("/api/session");
    assert.equal((await request("/api/provider")).data.flowbarKeyEditable, true);
    assert.equal((await request("/api/flowbar-credential", { action: "set", key: "short" })).status, 400);
    const saved = await request("/api/flowbar-credential", { action: "set", key });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.flowbar, true);
    assert.equal(saved.data.validation, "not-verified-remotely");
    assert.ok(!saved.bytes.includes(Buffer.from(key)));
    assert.equal((await request("/api/provider")).data.credentials.flowbar, true);
    assert.equal(loadProviderKey(), key);
    const encrypted = readFileSync(path.join(dir, "Reelori", "credentials", "flowbar.dpapi"));
    assert.ok(!encrypted.includes(Buffer.from(key)));

    store.transact((project) => {
      project.provider = {
        budgetMicros: 1000000,
        jobs: [{ state: "reserved", quote: { input: { provider: "flowbar" } } }] as any,
      };
    });
    assert.equal((await request("/api/flowbar-credential", { action: "remove" })).status, 409);
    assert.equal(loadProviderKey(), key);
    store.transact((project) => { project.provider!.jobs = []; });
    const removed = await request("/api/flowbar-credential", { action: "remove" });
    assert.equal(removed.status, 200);
    assert.equal(removed.data.flowbar, false);
    assert.equal(loadProviderKey(), "");
    assert.equal((await request("/api/provider")).data.credentials.flowbar, false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    if (previousDirectKey === undefined) delete process.env.REELORI_FLOWBAR_KEY;
    else process.env.REELORI_FLOWBAR_KEY = previousDirectKey;
    if (previousKeyFile === undefined) delete process.env.REELORI_FLOWBAR_KEY_FILE;
    else process.env.REELORI_FLOWBAR_KEY_FILE = previousKeyFile;
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(dir, { recursive: true, force: true });
  }
});
