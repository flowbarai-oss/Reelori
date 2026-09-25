import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedProject, addReference, confirmPreview } from "../packages/core/project.ts";
import { makeQuote, reserveProvider, setProviderBudget } from "../packages/providers/ledger.ts";
import { MiniMaxAdapter } from "../packages/providers/minimax.ts";
import { runProviderJob } from "../packages/providers/worker.ts";
import { readH3Reference } from "../packages/providers/h3-reference.ts";
import { Store } from "../packages/storage-local/store.ts";
import { createApi } from "../apps/local-service/server.ts";
import { client } from "./http-helper.ts";

const route = { provider: "minimax-cn" as const, kind: "video" as const, model: "MiniMax-H3", size: "768P:9:16", upperMicros: 400000, pricingVersion: "fixture" };
const bytes = Buffer.from("fixture-image-bytes");
const hash = createHash("sha256").update(bytes).digest("hex");
const image = `/api/assets/${hash}.png`;
function addFixtureReference(p: ReturnType<typeof seedProject>) {
  addReference(p, { id: "ref-one", name: "Test reference", image, rights: "owned", note: "fixture", createdAt: 100 }, p.revision);
  confirmPreview(p, p.revision);
  setProviderBudget(p, 1000000, p.revision);
}

test("H3 CN quote freezes a user-selected uploaded reference and rejects unsupported or stale references", () => {
  const p = seedProject();
  addFixtureReference(p);
  const quote = makeQuote(p, p.shots[0].id, route, 100, "ref-one");
  assert.equal(quote.input.referenceId, "ref-one");
  assert.equal(quote.input.referenceImage, image);
  reserveProvider(p, quote, "reference-operation", p.revision, 101);
  assert.equal(p.provider?.jobs[0].quote.input.referenceImage, image);
  assert.throws(() => makeQuote(p, p.shots[0].id, { ...route, provider: "minimax" }, 100, "ref-one"), /不支持参考图/);
  assert.throws(() => makeQuote(p, p.shots[0].id, route, 100, "missing"), /请选择已上传/);
  const changed = structuredClone(p);
  changed.references![0].image = "/api/assets/" + "a".repeat(64) + ".png";
  assert.throws(() => reserveProvider(changed, quote, "reference-operation-2", changed.revision, 101), /参考图已变化/);
});

test("H3 CN sends one reference image only when the frozen input and trusted bytes are both present", async () => {
  let body: any;
  const adapter = new MiniMaxAdapter("fixture-key", async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ task_id: "task-1" });
  }, undefined, "cn");
  const p = seedProject();
  addFixtureReference(p);
  const input = makeQuote(p, p.shots[0].id, route, 100, "ref-one").input;
  await assert.rejects(() => adapter.submit(input), /reference_image_missing/);
  await adapter.submit(input, bytes);
  assert.deepEqual(body.content, [
    { type: "text", text: input.prompt },
    { type: "image_url", role: "reference_image", image_url: "data:image/png;base64," + bytes.toString("base64") },
  ]);
  assert.throws(() => adapter.validate({ ...input, referenceImage: "https://example.com/image.png" }), /unsupported_h3_spec/);
});

test("worker refuses a changed local reference before any remote submission", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-h3-ref-"));
  const store = new Store(":memory:");
  try {
    store.transact((p) => {
      addFixtureReference(p);
      reserveProvider(p, makeQuote(p, p.shots[0].id, route, 100, "ref-one"), "reference-operation", p.revision, 101);
    });
    const job = store.get().provider!.jobs[0];
    writeFileSync(path.join(dir, `${hash}.png`), Buffer.from("tampered"));
    let sent = false;
    await runProviderJob(store, store.get().id, job.id, {
      submit: async () => { sent = true; throw new Error("must not send"); },
      query: async () => ({ state: "failed" }),
      content: async () => Buffer.alloc(0),
    }, dir);
    assert.equal(sent, false);
    assert.equal(store.get().provider!.jobs[0].state, "unknown");
    assert.equal(store.get().provider!.jobs[0].errorCode, "reference_asset_changed");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("H3 preflight accepts a real project PNG and rejects images outside provider dimensions", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-h3-preflight-"));
  try {
    const source = readFileSync("public/assets/rain-portrait.png");
    const sourceHash = createHash("sha256").update(source).digest("hex");
    copyFileSync("public/assets/rain-portrait.png", path.join(dir, `${sourceHash}.png`));
    const accepted = await readH3Reference(dir, `/api/assets/${sourceHash}.png`);
    assert.equal(accepted.length, source.length);
    const tiny = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(tiny);
    tiny.write("IHDR", 12, "ascii");
    tiny.writeUInt32BE(128, 16);
    tiny.writeUInt32BE(128, 20);
    const tinyHash = createHash("sha256").update(tiny).digest("hex");
    writeFileSync(path.join(dir, `${tinyHash}.png`), tiny);
    await assert.rejects(() => readH3Reference(dir, `/api/assets/${tinyHash}.png`), /reference_image_dimensions_unsupported/);
    await assert.rejects(() => readH3Reference(dir, "/api/assets/../../secret.png"), /invalid_reference_asset/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local API requires explicit reference consent before reserving a paid H3 job", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-h3-api-"));
  const assetDir = path.join(dir, "assets");
  mkdirSync(assetDir);
  const source = readFileSync("public/assets/rain-portrait.png");
  const sourceHash = createHash("sha256").update(source).digest("hex");
  copyFileSync("public/assets/rain-portrait.png", path.join(assetDir, `${sourceHash}.png`));
  const store = new Store(path.join(dir, "studio.sqlite"));
  store.transact((p) => {
    addReference(p, { id: "ref-real", name: "Rain portrait", image: `/api/assets/${sourceHash}.png`, rights: "owned", note: "fixture", createdAt: 100 }, p.revision);
    confirmPreview(p, p.revision);
    setProviderBudget(p, 1000000, p.revision);
  });
  const previous = process.env.REELORI_MINIMAX_KEY;
  process.env.REELORI_MINIMAX_KEY = "fixture-key";
  const server = createApi(store, 4311, 5178, path.join(dir, "exports"), {
    config: { enabled: true, routes: [{ ...route, id: "h3-cn-test", expiresAt: Date.now() + 60000 }] },
    key: "",
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = client(server);
  try {
    await request("/api/session");
    const project = (await request("/api/project")).data;
    const quoted = await request("/api/provider-quote", { routeId: "h3-cn-test", shotId: project.shots[0].id, referenceId: "ref-real", revision: project.revision });
    assert.equal(quoted.status, 200, JSON.stringify(quoted.data));
    assert.equal(quoted.data.input.referenceImage, `/api/assets/${sourceHash}.png`);
    const submit = { quoteId: quoted.data.id, operationId: "reference-api-operation", revision: project.revision };
    const refused = await request("/api/provider-submit", submit);
    assert.equal(refused.status, 409);
    assert.equal(store.get().provider?.jobs.length, 0);
    const accepted = await request("/api/provider-submit", { ...submit, referenceConsent: true });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.equal(store.get().provider?.jobs[0].state, "reserved");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    if (previous === undefined) delete process.env.REELORI_MINIMAX_KEY;
    else process.env.REELORI_MINIMAX_KEY = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
