import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../packages/storage-local/store.ts";
import { createApi } from "../apps/local-service/server.ts";
import {
  confirmPreview,
  queueSample,
  tick,
  adopt,
} from "../packages/core/project.ts";
test("export saves an immutable local file and serves the same bytes with attachment headers", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "drama-export-"));
  const store = new Store(":memory:");
  store.transact((p) => {
    confirmPreview(p, p.revision);
    queueSample(
      p,
      p.shots.map((s) => s.id),
      "export-test",
      p.revision,
      100,
    );
    for (const time of [100, 4000, 8000, 12000]) tick(p, time);
    for (const s of p.shots) adopt(p, s.id, s.candidates[0].id, p.revision);
  });
  const server = createApi(store, 4311, 5178, dir);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const request = (route: string, method = "GET", body?: object, cookie = "") =>
    new Promise<{
      status: number;
      headers: http.IncomingHttpHeaders;
      text: string;
    }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: route,
          method,
          headers: {
            Host: "127.0.0.1:4311",
            Origin: "http://127.0.0.1:5178",
            Cookie: cookie,
            "Content-Type": "application/json",
          },
        },
        (res) => {
          let text = "";
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode!, headers: res.headers, text }),
          );
        },
      );
      req.on("error", reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  try {
    const session = await request("/api/session");
    const cookie = session.headers["set-cookie"]![0].split(";")[0];
    const exported = await request(
      "/api/export",
      "POST",
      { revision: store.get().revision },
      cookie,
    );
    assert.equal(exported.status, 200);
    const output = JSON.parse(exported.text);
    assert.equal(path.dirname(output.file), dir);
    const download = await request(output.download, "GET", undefined, cookie);
    assert.equal(download.status, 200);
    assert.match(
      String(download.headers["content-disposition"]),
      /^attachment/,
    );
    assert.equal(download.text, readFileSync(output.file, "utf8"));
    assert.equal(JSON.parse(download.text).cost.simulated, true);
    assert.equal(
      (await request("/api/download?id=../../secret", "GET", undefined, cookie))
        .status,
      400,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
