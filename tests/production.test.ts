import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/storage-local/store.ts";
import { saveScene, saveCharacter } from "../packages/core/production.ts";
import { confirmPreview, updateShot } from "../packages/core/project.ts";
import { validateProject } from "../packages/storage-local/validate-project.ts";
import { createApi } from "../apps/local-service/server.ts";
import { client } from "./http-helper.ts";
import { makeQuote, reserveProvider, setProviderBudget } from "../packages/providers/ledger.ts";

test("scene and cast edits are versioned, survive storage and invalidate affected preview inputs", () => {
  const store = new Store(":memory:");
  try {
    const created = store.create({ title: "连续剧", story: "雨夜街角。\n\n暗房里。" });
    assert.equal(created.scenes?.length, 1);
    assert.ok(created.shots.every((shot) => shot.sceneId === created.scenes?.[0].id));
    let project = store.transact((draft) => {
      saveScene(draft, { name: "暗房", location: "上海", notes: "暖色灯光" }, draft.revision);
      saveCharacter(draft, { name: "林夏", description: "短发，米色风衣" }, draft.revision);
    }, created.id);
    const scene = project.scenes![1], character = project.characters![0], shotId = project.shots[1].id;
    project = store.transact((draft) => {
      updateShot(draft, shotId, { sceneId: scene.id, characterIds: [character.id] }, draft.revision);
      confirmPreview(draft, draft.revision);
    }, created.id);
    assert.equal(project.shots[1].sceneId, scene.id);
    assert.deepEqual(project.shots[1].characterIds, [character.id]);
    assert.equal(project.preview?.inputRevision, project.inputRevision);
    assert.equal(project.preview?.scenes?.[1].name, "暗房");
    assert.equal(project.preview?.characters?.[0].description, "短发，米色风衣");
    const originalShotRevision = project.shots[1].revision;
    project = store.transact((draft) => {
      saveCharacter(draft, { id: character.id, name: "林夏", description: "短发，深色风衣" }, draft.revision);
    }, created.id);
    assert.equal(project.shots[1].revision, originalShotRevision + 1);
    assert.equal(project.shots[0].revision, 1);
    assert.notEqual(project.preview?.inputRevision, project.inputRevision);
    assert.equal(project.preview?.characters?.[0].description, "短发，米色风衣");
    validateProject(project);
    assert.throws(() => store.transact((draft) =>
      updateShot(draft, shotId, { sceneId: "missing" }, draft.revision), created.id), /场景不存在/);
    assert.throws(() => store.transact((draft) =>
      saveScene(draft, { name: "坏场景", location: "", notes: "" }, 1), created.id), /项目已更新/);
    assert.equal(store.get(created.id).scenes?.length, 2);
  } finally {
    store.close();
  }
});

test("scene and character API persists assignments and rejects unknown reference IDs", async () => {
  const store = new Store(":memory:");
  const server = createApi(store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = client(server);
  try {
    await request("/api/session");
    const project = (await request("/api/projects", { title: "剧集", story: "一个故事" })).data;
    const scene = await request(`/api/scene?projectId=${project.id}`, {
      scene: { name: "车站", location: "夜晚", notes: "雨" }, revision: project.revision,
    });
    assert.equal(scene.status, 200);
    const rejected = await request(`/api/character?projectId=${project.id}`, {
      character: { name: "林夏", description: "侦探", referenceId: "unknown" }, revision: scene.data.revision,
    });
    assert.equal(rejected.status, 409);
    const cast = await request(`/api/character?projectId=${project.id}`, {
      character: { name: "林夏", description: "侦探" }, revision: scene.data.revision,
    });
    assert.equal(cast.status, 200);
    const shot = await request(`/api/shot?projectId=${project.id}`, {
      id: project.shots[0].id,
      patch: { sceneId: scene.data.scenes[1].id, characterIds: [cast.data.characters[0].id] },
      revision: cast.data.revision,
    });
    assert.equal(shot.status, 200);
    assert.equal(shot.data.shots[0].sceneId, scene.data.scenes[1].id);
    validateProject(shot.data);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

test("video quotes disclose assigned scene and cast text and reject stale context", () => {
  const store = new Store(":memory:");
  try {
    const created = store.create({ title: "夜班", story: "摄影师走入车站" });
    const project = store.transact((draft) => {
      saveScene(draft, { name: "车站月台", location: "上海 · 雨夜", notes: "蓝色顶灯" }, draft.revision);
      saveCharacter(draft, { name: "林夏", description: "短发，米色风衣" }, draft.revision);
      updateShot(draft, draft.shots[0].id, {
        sceneId: draft.scenes![1].id, characterIds: [draft.characters![0].id],
        dialogue: "找到你了。",
      }, draft.revision);
      confirmPreview(draft, draft.revision);
      setProviderBudget(draft, 1000000, draft.revision);
    }, created.id);
    const quote = makeQuote(project, project.shots[0].id, {
      provider: "minimax", kind: "video", model: "MiniMax-H3",
      size: "768P:9:16", upperMicros: 400000, pricingVersion: "fixture",
    }, 100);
    assert.match(quote.input.prompt, /车站月台/);
    assert.match(quote.input.prompt, /上海 · 雨夜/);
    assert.match(quote.input.prompt, /林夏/);
    assert.match(quote.input.prompt, /米色风衣/);
    const audio = makeQuote(project, project.shots[0].id, {
      provider: "aliyun", kind: "audio", model: "voice", size: "tts",
      upperMicros: 1000, pricingVersion: "fixture",
    }, 100);
    assert.equal(audio.input.prompt, project.shots[0].dialogue);
    const changed = store.transact((draft) => {
      saveScene(draft, { ...draft.scenes![1], notes: "暖色顶灯" }, draft.revision);
    }, created.id);
    assert.throws(() => reserveProvider(changed, quote, "stale-scene-operation", changed.revision, 101), /镜头或参考版本已变化/);
    const oversized = structuredClone(changed);
    oversized.shots[0].description = "x".repeat(1990);
    assert.throws(() => makeQuote(oversized, oversized.shots[0].id, {
      provider: "minimax", kind: "video", model: "MiniMax-H3",
      size: "768P:9:16", upperMicros: 400000, pricingVersion: "fixture",
    }, 100), /超过 2000 字/);
  } finally {
    store.close();
  }
});
