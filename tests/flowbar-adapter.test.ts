import test from "node:test";
import assert from "node:assert/strict";
import { FlowBarAdapter } from "../packages/providers/flowbar.ts";
import { publicIPv4, downloadImage } from "../packages/providers/download.ts";
const input = {
  kind: "video" as const,
  model: "wan2.7-t2v",
  prompt: "A paper boat",
  seconds: 5,
  size: "720*1280",
  shotId: "one",
  shotRevision: 1,
  referenceRevision: 1,
};
test("media downloads reject private addresses and non-HTTPS URLs without forwarding keys", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.1.1",
    "::1",
  ])
    assert.equal(publicIPv4(ip), false);
  assert.equal(publicIPv4("8.8.8.8"), true);
  await assert.rejects(() => downloadImage("http://example.com/image"));
  await assert.rejects(() => downloadImage("https://127.0.0.1/image"));
});
test("FlowBar video submission, query and content stay at the chosen gateway with bounded requests", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const adapter = new FlowBarAdapter("fixture-key", async (url, init) => {
    seen.push({ url: String(url), init: init! });
    if (String(url).endsWith("/content"))
      return new Response(new Uint8Array([1, 2, 3]));
    if (init?.method === "POST") return Response.json({ id: "video_123" });
    return Response.json({ status: "completed" });
  });
  assert.deepEqual(await adapter.submit(input), {
    state: "running",
    upstreamId: "video_123",
  });
  assert.equal((await adapter.query("video_123")).state, "succeeded");
  assert.equal((await adapter.content("video_123")).length, 3);
  const body = JSON.parse(seen[0].init.body as string);
  assert.equal(body.size, "720*1280");
  assert.equal(body.metadata.parameters.resolution, "720P");
  assert.equal(body.duration, 5);
  assert.ok(
    seen.every(
      (x) =>
        x.url.startsWith("https://api.flowbarai.com/v1/") &&
        x.init.redirect === "error",
    ),
  );
  await assert.rejects(() => adapter.query("../secret"));
  assert.equal(seen.length, 3);
});
test("malformed success, external result URLs, provider errors and oversized responses are not treated as success", async () => {
  const img = {
    ...input,
    kind: "image" as const,
    model: "doubao-seedream-4.0",
    size: "1024x1024",
  };
  for (const body of [
    { data: [{ url: "http://127.0.0.1/secret" }] },
    { id: "../../secret" },
    { data: [] },
  ]) {
    const a = new FlowBarAdapter("secret", async () => Response.json(body));
    await assert.rejects(() => a.submit(img));
  }
  const fail = new FlowBarAdapter(
    "secret",
    async () => new Response("raw-secret-provider-error", { status: 500 }),
  );
  await assert.rejects(
    () => fail.submit(input),
    (e) => !String(e).includes("raw-secret"),
  );
  const large = new FlowBarAdapter(
    "secret",
    async () =>
      new Response("x", {
        headers: { "content-length": String(9 * 1024 * 1024) },
      }),
  );
  await assert.rejects(() => large.submit(input));
});
test("invalid mode/spec is rejected before a request and inline images normalize without URLs", async () => {
  let calls = 0;
  const a = new FlowBarAdapter("key", async () => {
    calls++;
    return Response.json({ data: [{ b64_json: "AAAA" }] });
  });
  await assert.rejects(() => a.submit({ ...input, seconds: 6 }));
  assert.equal(calls, 0);
  assert.deepEqual(
    await a.submit({ ...input, kind: "image", size: "1024x1024" }),
    { state: "succeeded", imageBase64: "AAAA" },
  );
});
