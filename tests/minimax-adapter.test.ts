import test from "node:test";
import assert from "node:assert/strict";
import { MiniMaxAdapter } from "../packages/providers/minimax.ts";
const input = {
  provider: "minimax" as const,
  kind: "video" as const,
  model: "MiniMax-H3",
  prompt: "A paper boat on a river",
  seconds: 5,
  size: "768P:9:16",
  shotId: "one",
  shotRevision: 1,
  referenceRevision: 1,
};
test("H3 uses official v2 contract, fences task identity and never sends key to media host", async () => {
  const calls: { url: string; body: any }[] = [];
  let taskId = "remote-1";
  const a = new MiniMaxAdapter(
    "fixture-key",
    async (url, init) => {
      calls.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer fixture-key",
      );
      assert.equal(init?.redirect, "error");
      return Response.json(
        init?.method === "POST"
          ? { task_id: "remote-1" }
          : {
              task: {
                id: taskId,
                status: "succeeded",
                content: { url: "https://cdn.hailuoai.com/test.mp4" },
              },
            },
      );
    },
    async (url) => {
      assert.equal(url, "https://cdn.hailuoai.com/test.mp4");
      return Buffer.from("fixture");
    },
  );
  assert.deepEqual(await a.submit(input), {
    state: "running",
    upstreamId: "remote-1",
  });
  assert.equal(calls[0].url, "https://api.minimax.io/v2/video_generation");
  assert.deepEqual(calls[0].body, {
    model: "MiniMax-H3",
    content: [{ type: "text", text: input.prompt }],
    resolution: "768P",
    duration: 5,
    ratio: "9:16",
  });
  assert.deepEqual(await a.query("remote-1"), { state: "succeeded" });
  assert.equal((await a.content("remote-1")).toString(), "fixture");
  taskId = "wrong";
  await assert.rejects(() => a.query("remote-1"), /task_identity/);
  assert.throws(() => a.validate({ ...input, size: "2K:9:16" }));
});
test("China H3 route is explicit and never falls back across regions", async () => {
  let calls = 0;
  const a = new MiniMaxAdapter(
    "fixture",
    async (url) => {
      calls++;
      assert.equal(String(url), "https://api.minimax.cn/v2/video_generation");
      return new Response("", { status: 401 });
    },
    undefined,
    "cn",
  );
  await assert.rejects(
    () => a.submit({ ...input, provider: "minimax-cn" }),
    /minimax_http_401/,
  );
  assert.equal(calls, 1);
  await assert.rejects(() => a.submit(input), /unsupported_h3_spec/);
  assert.equal(calls, 1);
});
