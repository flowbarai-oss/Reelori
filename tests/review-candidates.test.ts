import assert from "node:assert/strict";
import test from "node:test";
import { seedProject } from "../packages/core/project.ts";
import { currentCandidates, selectedCandidate } from "../apps/web/src/review-candidates.ts";

test("review exposes current versions and defaults to the adopted one", () => {
  const shot = seedProject().shots[0];
  shot.candidates = [
    { id: "old-input", image: "/old.png", createdAt: 300, inputRevision: 0, mode: "sample" },
    { id: "adopted", image: "/adopted.png", createdAt: 100, inputRevision: 1, mode: "sample" },
    { id: "latest", image: "/latest.png", createdAt: 200, inputRevision: 1, mode: "provider" },
  ];
  shot.adoptedId = "adopted";
  shot.review = "accepted";
  assert.deepEqual(currentCandidates(shot).map((item) => item.id), ["latest", "adopted"]);
  assert.equal(selectedCandidate(shot, "")?.id, "adopted");
  assert.equal(selectedCandidate(shot, "latest")?.id, "latest");
  assert.equal(selectedCandidate(shot, "old-input")?.id, "adopted");
  shot.revision = 2;
  assert.equal(selectedCandidate(shot, ""), undefined);
});

test("a fresh sample has coherent cast and scene assignments", () => {
  const project = seedProject();
  assert.equal(project.characters?.[0]?.name, "林夏");
  assert.equal(project.scenes?.length, 2);
  assert.ok(project.shots.every((shot) =>
    project.scenes?.some((scene) => scene.id === shot.sceneId)
    && shot.characterIds?.includes(project.characters![0].id),
  ));
});
