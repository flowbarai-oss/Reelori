import test from "node:test";
import assert from "node:assert/strict";
import { chooseStartupProjectId } from "../apps/web/src/startup-project.ts";

test("a saved project from a different workspace falls back to the bundled sample", () => {
  assert.equal(
    chooseStartupProjectId("old-workspace-id", [
      { id: "another-project" },
      { id: "sample" },
    ]),
    "sample",
  );
});

test("a valid saved project remains selected", () => {
  assert.equal(
    chooseStartupProjectId("my-project", [
      { id: "sample" },
      { id: "my-project" },
    ]),
    "my-project",
  );
});

test("an empty workspace does not invent a project id", () => {
  assert.equal(chooseStartupProjectId("old-id", []), null);
});
