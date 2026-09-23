import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../packages/storage-local/store.ts";
import { confirmPreview, queueSample } from "../packages/core/project.ts";
import * as backup from "../packages/storage-local/backup.ts";
import {setSubtitles} from '../packages/core/subtitles.ts';

test("portable backup restores a separate editable project with media and revision history", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-backup-"));
  const source = new Store(":memory:"),
    target = new Store(":memory:");
  try {
    source.transact((p) => {
      confirmPreview(p, p.revision);
      queueSample(p, [p.shots[0].id], "backup-inflight", p.revision);
      setSubtitles(p,[{startMs:100,endMs:1500,text:'Backup subtitle'}],p.revision);
    });
    const before = source.get();
    const archive = await backup.createBackup(
      source,
      "sample",
      path.join(dir, "source-assets"),
    );
    const checked = backup.inspectBackup(archive);
    assert.equal(checked.title, "明日底片");
    assert.equal(checked.shots, 3);
    assert.equal(checked.media, 3);
    assert.equal(checked.inFlight, 1);
    const restored = await backup.restoreBackup(
      target,
      archive,
      path.join(dir, "restored-assets"),
    );
    assert.notEqual(restored.id, "sample");
    assert.equal(restored.story, before.story);
    assert.deepEqual(restored.subtitleCues,before.subtitleCues);
    assert.equal(restored.subtitleRevision,1);
    assert.equal(restored.shots[0].locked, true);
    assert.equal(restored.jobs[0].status, "unknown");
    assert.equal(restored.jobs[0].reservedCents, 240);
    assert.equal(restored.paused, true);
    assert.equal(target.get().jobs.length, 0);
    assert.deepEqual(source.get(), before);
    assert.equal(
      target.history(restored.id).length,
      source.history("sample").length + 1,
    );
    assert.match(restored.shots[0].image, /^\/api\/assets\/[a-f0-9]{64}\.png$/);
    assert.deepEqual(
      readFileSync(
        path.join(
          dir,
          "restored-assets",
          restored.shots[0].image.split("/").at(-1)!,
        ),
      ),
      readFileSync("public/assets/rain-wide.png"),
    );
    // Restoration adds an audit revision; crossing 1000 must remain portable.
    const large = structuredClone(archive);
    large.revisions = Array.from({ length: 1000 }, (_, i) => ({ ...structuredClone(large.project), revision: i + 1 }));
    large.project = structuredClone(large.revisions.at(-1)!);
    const copy = await backup.restoreBackup(target, large, path.join(dir, "restored-assets"));
    const exported = await backup.createBackup(target, copy.id, path.join(dir, "restored-assets"));
    assert.equal(exported.revisions.length, 1001);
  } finally {
    source.close();
    target.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("tampered, incomplete and malicious backups fail before creating projects", async () => {
  const store = new Store(":memory:");
  try {
    const original = await backup.createBackup(store, "sample", "unused");
    const mutations = [
      (a: any) => {
        a.media[0].data = "AAAA";
      },
      (a: any) => {
        a.media.pop();
      },
      (a: any) => {
        a.project.shots[0].image = "../../secret";
      },
      (a: any) => {
        a.project.budgetCents = -1;
      },
      (a: any) => {
        a.project.apiKey = "never-import-secrets";
      },
      (a: any) => {
        a.version = 99;
      },
      (a: any) => {
        a.project.shots[0].adoptedId = "missing";
        a.project.shots[0].review = "accepted";
      },
      (a: any) => {
        a.revisions[0].id = "another-project";
      },
    ];
    for (const mutate of mutations) {
      const a = structuredClone(original);
      mutate(a);
      assert.throws(() => backup.inspectBackup(a));
    }
    assert.equal(store.list().length, 1);
  } finally {
    store.close();
  }
});
