import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../packages/storage-local/store.ts";
import { validateProject } from "../packages/storage-local/validate-project.ts";
import { saveCharacter } from "../packages/core/production.ts";
import { createBackup, restoreBackup } from "../packages/storage-local/backup.ts";
import { createApi } from "../apps/local-service/server.ts";
import { client } from "./http-helper.ts";

test("episodes share a series and reference versions without copying shot work or jobs", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "reelori-series-"));
  const file = path.join(directory, "studio.sqlite");
  let store = new Store(file);
  try {
    const first = store.create({ title: "雨夜档案", story: "第一集的故事" });
    store.transact((project) => {
      project.references = [{ id: "costume-v1", name: "林夏", image: "/assets/rain-portrait.png", rights: "owned", note: "短发与米色风衣", createdAt: 1 }];
      project.referenceRevision++;
      project.revision++;
      saveCharacter(project, { name: "林夏", description: "摄影师", referenceId: "costume-v1" }, project.revision);
    }, first.id);
    const second = store.create({ title: "第二集：暗房", story: "完全不同的第二集原文", seriesFromProjectId: first.id });
    const third = store.create({ title: "第三集：回信", story: "第三集原文", seriesFromProjectId: first.id });
    const linkedFirst = store.get(first.id);
    assert.deepEqual([linkedFirst.series?.episode, second.series?.episode, third.series?.episode], [1, 2, 3]);
    assert.equal(linkedFirst.series?.id, second.series?.id);
    assert.equal(second.series?.id, third.series?.id);
    assert.equal(second.series?.title, "雨夜档案");
    assert.deepEqual(second.references, linkedFirst.references);
    assert.notEqual(second.references, linkedFirst.references);
    assert.deepEqual(second.characters, linkedFirst.characters);
    assert.notEqual(second.characters, linkedFirst.characters);
    assert.notEqual(second.scenes?.[0].id, linkedFirst.scenes?.[0].id);
    assert.equal(second.story, "完全不同的第二集原文");
    assert.deepEqual(second.jobs, []);
    assert.equal(second.preview, null);
    assert.ok(second.shots.every((shot) => shot.candidates.length === 0));
    assert.equal(store.list().find((item) => item.id === third.id)?.series?.episode, 3);
    validateProject(linkedFirst);
    validateProject(second);
    assert.throws(() => store.create({ title: "坏集", story: "内容", seriesFromProjectId: "missing" }), /项目不存在/);
    assert.equal(store.list().length, 4);
    store.close();
    store = new Store(file);
    assert.equal(store.get(second.id).series?.episode, 2);
    assert.equal(store.get(first.id).series?.episode, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restoring one episode produces an independent project without joining the original series", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "reelori-series-backup-"));
  const store = new Store(":memory:");
  try {
    const first = store.create({ title: "一集", story: "开场" });
    const second = store.create({ title: "二集", story: "延续", seriesFromProjectId: first.id });
    const archive = await createBackup(store, second.id, directory);
    const restored = await restoreBackup(store, archive, directory);
    assert.equal(restored.series, undefined);
    assert.equal(store.get(second.id).series?.episode, 2);
    assert.equal(store.get(restored.id).series, undefined);
    validateProject(restored);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("project API creates a next episode and returns series metadata", async () => {
  const store = new Store(":memory:");
  const server = createApi(store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = client(server);
  try {
    await request("/api/session");
    const first = await request("/api/projects", { title: "旧站", story: "第一集" });
    const second = await request("/api/projects", { title: "新线索", story: "第二集", seriesFromProjectId: first.data.id });
    assert.equal(second.status, 201);
    assert.equal(second.data.series.episode, 2);
    assert.equal((await request("/api/projects")).data.find((item: { id: string }) => item.id === first.data.id).series.episode, 1);
    assert.equal((await request(`/api/project?projectId=${second.data.id}`)).data.series.id, second.data.series.id);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});
