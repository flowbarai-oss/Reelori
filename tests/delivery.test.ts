import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../packages/storage-local/store.ts";
import {
  confirmPreview,
  queueSample,
  tick,
  adopt,
} from "../packages/core/project.ts";
import { renderAnimatic } from "../packages/media/render.ts";
import {
  createBackup,
  restoreBackup,
} from "../packages/storage-local/backup.ts";
import * as delivery from "../packages/media/delivery.ts";
test("restored adopted images render and produce a portable delivery ZIP without private metadata", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-delivery-")),
    exports = path.join(dir, "exports"),
    assets = path.join(dir, "assets");
  const store = new Store(":memory:");
  try {
    store.transact((p) => {
      p.story = "PRIVATE ORIGINAL";
      p.shots[0].title = '=HYPERLINK("bad")';
      confirmPreview(p, p.revision);
      queueSample(
        p,
        p.shots.map((s) => s.id),
        "delivery-test",
        p.revision,
        100,
      );
      for (const n of [100, 4000, 8000, 12000]) tick(p, n);
      for (const s of p.shots) adopt(p, s.id, s.candidates[0].id, p.revision);
    });
    const archive = await createBackup(store, "sample", assets);
    const p = await restoreBackup(store, archive, assets);
    const output = await renderAnimatic(p, exports);
    const result = await delivery.createDelivery(
      output.id,
      p.id,
      exports,
      assets,
    );
    const bytes = readFileSync(result.file);
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    // Independent ZIP implementation verifies CRC and exact entry contents.
    const checked = execFileSync(
      "python",
      [
        "-c",
        "import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({'names':z.namelist(),'csv':z.read('storyboard.csv').decode('utf-8-sig'),'manifest':json.loads(z.read('manifest.json'))}))",
        result.file,
      ],
      { encoding: "utf8" },
    );
    const zip = JSON.parse(checked);
    assert.ok(zip.names.includes("film.mp4"));
    assert.ok(zip.names.includes("assets/shot-01.png"));
    assert.match(zip.csv, /'=HYPERLINK/);
    assert.doesNotMatch(
      JSON.stringify(zip.manifest),
      /PRIVATE ORIGINAL|[A-Z]:\\|\/api\/assets/,
    );
    assert.equal(zip.manifest.files.length, 8);
    await assert.rejects(
      delivery.createDelivery(output.id, "wrong-project", exports, assets),
    );
    writeFileSync(output.file, "corrupted");
    await assert.rejects(
      delivery.createDelivery(output.id, p.id, exports, assets),
      /摘要/,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
