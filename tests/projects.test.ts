import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../packages/storage-local/store.ts";
import {
  seedProject,
  updateShot,
  confirmPreview,
  queueSample,
} from "../packages/core/project.ts";

test("new stories remain isolated and survive reopening without copying sample jobs", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-projects-"));
  const file = path.join(dir, "studio.sqlite");
  let store = new Store(file);
  try {
    const first = store.create({
      title: "海边来信",
      story: "她走向海边。\n\n远方亮起了一盏灯。",
      sourceName: "story.txt",
    });
    assert.notEqual(first.id, "sample");
    assert.equal(first.story, "她走向海边。\n\n远方亮起了一盏灯。");
    assert.equal(first.shots.length, 3);
    assert.equal(first.shots[0].description, "她走向海边。");
    assert.deepEqual(first.jobs, []);
    assert.equal(first.preview, null);
    assert.equal(first.shots[0].locked, false);
    store.transact(
      (p) => updateShot(p, p.shots[0].id, { dialogue: "等我回来" }, p.revision),
      first.id,
    );
    assert.equal(store.get().shots[0].dialogue, "有些照片，记录的不是过去。");
    store.close();
    store = new Store(file);
    assert.equal(store.get(first.id).shots[0].dialogue, "等我回来");
    assert.equal(store.list().length, 2);
    assert.throws(() => store.get("missing"), /不存在/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("invalid story imports never create a project; long originals are not silently truncated", () => {
  const store = new Store(":memory:");
  try {
    for (const input of [
      { title: "", story: "hi" },
      { title: "ok", story: "" },
      { title: "x", story: "x".repeat(40001) },
      { title: "x", story: "bad\0text" },
    ])
      assert.throws(() => store.create(input));
    assert.equal(store.list().length, 1);
    const p = store.create({ title: "长原文", story: "字".repeat(3000) });
    assert.equal(p.story.length, 3000);
    assert.equal(p.shots[0].description, "");
  } finally {
    store.close();
  }
});
test("legacy migration preserves adopted data and creates a consistent pre-upgrade backup", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-migrate-"));
  const file = path.join(dir, "old.sqlite");
  const old = new DatabaseSync(file);
  const p = seedProject();
  p.revision = 37;
  old.exec("CREATE TABLE projects (id TEXT PRIMARY KEY,body TEXT NOT NULL)");
  old
    .prepare("INSERT INTO projects VALUES (?,?)")
    .run("sample", JSON.stringify(p));
  old.close();
  const store = new Store(file);
  try {
    assert.deepEqual(store.get(), p);
    assert.equal(
      store.db.prepare("PRAGMA user_version").get()!.user_version,
      1,
    );
    assert.ok(existsSync(file + ".before-v1.sqlite"));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("scheduler advances jobs in every project, not only sample", () => {
  const store = new Store(":memory:");
  try {
    const p = store.create({ title: "独立任务", story: "一阵风" });
    store.transact((d) => {
      confirmPreview(d, d.revision);
      queueSample(d, [d.shots[0].id], "multi-job", d.revision, 100);
    }, p.id);
    store.tick(100);
    store.tick(4000);
    assert.equal(store.get(p.id).jobs[0].status, "succeeded");
    assert.equal(store.get().jobs.length, 0);
  } finally {
    store.close();
  }
});
