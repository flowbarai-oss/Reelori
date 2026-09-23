import test from "node:test";
import assert from "node:assert/strict";
import { AliyunTtsAdapter } from "../packages/providers/aliyun-tts.ts";
import { ProviderError } from "../packages/providers/flowbar.ts";
import type { ProviderInput } from "../packages/providers/contracts.ts";

function input(overrides: Partial<ProviderInput> = {}): ProviderInput {
  return {
    provider: "aliyun",
    kind: "audio",
    model: "xiaoyun",
    prompt: "你好，这是一句测试对白。",
    seconds: 5,
    size: "tts",
    shotId: "shot-1",
    shotRevision: 1,
    referenceRevision: 1,
    ...overrides,
  };
}

test("validate rejects wrong kind/size, empty dialogue and dialogue over 300 characters", () => {
  const adapter = new AliyunTtsAdapter("tok", "app");
  assert.throws(() => adapter.validate(input({ kind: "video" as never })));
  assert.throws(() => adapter.validate(input({ size: "1024x1024" })));
  assert.throws(() => adapter.validate(input({ prompt: "   " })));
  assert.throws(() => adapter.validate(input({ prompt: "字".repeat(301) })));
  adapter.validate(input({ prompt: "字".repeat(300) }));
});

test("submit without configured credential fails closed without any network call", async () => {
  let called = false;
  const adapter = new AliyunTtsAdapter("", "", async () => {
    called = true;
    throw Error("must not be called");
  });
  await assert.rejects(
    () => adapter.submit(input()),
    (e: unknown) => e instanceof ProviderError && e.code === "aliyun_credential_missing",
  );
  assert.equal(called, false);
});

test("a successful audio/* response is read fully and base64-encoded", async () => {
  const audioBytes = Buffer.from("fake-wav-bytes-for-testing-only");
  const adapter = new AliyunTtsAdapter("tok", "app", async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit).body));
    assert.equal(body.appkey, "app");
    assert.equal(body.token, "tok");
    assert.equal(body.text, input().prompt);
    assert.equal(body.format, "wav");
    return new Response(audioBytes, {
      status: 200,
      headers: { "Content-Type": "audio/wav" },
    });
  });
  const result = await adapter.submit(input());
  assert.equal(result.state, "succeeded");
  assert.equal(
    (result as { audioBase64: string }).audioBase64,
    audioBytes.toString("base64"),
  );
});

test("a JSON error body maps auth failure and invalid params to distinguishable error codes", async () => {
  const authAdapter = new AliyunTtsAdapter("expired", "app", async () =>
    new Response(JSON.stringify({ status: 40000001, message: "invalid token" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  await assert.rejects(
    () => authAdapter.submit(input()),
    (e: unknown) =>
      e instanceof ProviderError &&
      e.code === "aliyun_auth_failed_token_may_be_expired",
  );
  const paramAdapter = new AliyunTtsAdapter("tok", "app", async () =>
    new Response(JSON.stringify({ status: 40000003, message: "bad param" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  await assert.rejects(
    () => paramAdapter.submit(input()),
    (e: unknown) => e instanceof ProviderError && e.code === "aliyun_invalid_params",
  );
});

test("an oversized audio response is rejected instead of being buffered without bound", async () => {
  const big = new Uint8Array(5 * 1024 * 1024);
  const adapter = new AliyunTtsAdapter("tok", "app", async () =>
    new Response(big, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(big.length),
      },
    }),
  );
  await assert.rejects(
    () => adapter.submit(input()),
    (e: unknown) => e instanceof ProviderError && e.code === "response_too_large",
  );
});

test("query and content are refused: this provider is synchronous and has no async follow-up", async () => {
  const adapter = new AliyunTtsAdapter("tok", "app");
  await assert.rejects(
    () => adapter.query(),
    (e: unknown) =>
      e instanceof ProviderError && e.code === "sync_provider_has_no_async_query",
  );
  await assert.rejects(
    () => adapter.content(),
    (e: unknown) =>
      e instanceof ProviderError &&
      e.code === "sync_provider_has_no_async_content",
  );
});

test("a tokenProvider, when given, is asked for the current token on every submit instead of using the static constructor value", async () => {
  let calls = 0;
  const tokenProvider = async () => {
    calls++;
    return "dynamic-token-" + calls;
  };
  const seenTokens: unknown[] = [];
  const adapter = new AliyunTtsAdapter(
    "stale-static-token",
    "app",
    async (_url, init) => {
      seenTokens.push(JSON.parse(String((init as RequestInit).body)).token);
      return new Response(Buffer.from("wav-bytes"), {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      });
    },
    tokenProvider,
  );
  await adapter.submit(input());
  await adapter.submit(input());
  assert.deepEqual(seenTokens, ["dynamic-token-1", "dynamic-token-2"]);
  assert.equal(calls, 2);
});
