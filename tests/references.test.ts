import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../packages/core/project.ts";
test("reference replacement preserves old candidates and preview, but blocks their adoption and export", () => {
  const p = core.seedProject();
  core.confirmPreview(p, p.revision);
  core.queueSample(
    p,
    p.shots.map((s) => s.id),
    "reference-test",
    p.revision,
    100,
  );
  for (const time of [100, 4000, 8000, 12000]) core.tick(p, time);
  for (const shot of p.shots)
    core.adopt(p, shot.id, shot.candidates[0].id, p.revision);
  const old = structuredClone(p);
  const add = (core as any).addReference;
  assert.equal(typeof add, "function");
  add(
    p,
    {
      id: "ref-one",
      name: "角色参考",
      image: "/api/assets/" + "a".repeat(64) + ".png",
      rights: "owned",
      note: "自绘角色",
      createdAt: 100,
    },
    p.revision,
  );
  assert.deepEqual(p.preview, old.preview);
  assert.equal(p.referenceRevision, 2);
  assert.equal(p.shots[0].adoptedId, old.shots[0].adoptedId);
  assert.equal(p.shots[0].review, "pending");
  assert.throws(
    () => core.adopt(p, p.shots[0].id, p.shots[0].adoptedId!, p.revision),
    /旧输入/,
  );
  assert.throws(() => core.manifest(p));
  assert.throws(
    () => core.queueSample(p, [p.shots[0].id], "after-reference", p.revision),
    /预演/,
  );
  add(
    p,
    {
      id: "ref-two",
      name: "新参考",
      image: "/api/assets/" + "b".repeat(64) + ".png",
      rights: "licensed",
      note: "已获得作者许可",
      createdAt: 200,
    },
    p.revision,
  );
  assert.equal(p.references?.length, 2);
  assert.equal(
    p.references?.[0].image,
    "/api/assets/" + "a".repeat(64) + ".png",
  );
});
