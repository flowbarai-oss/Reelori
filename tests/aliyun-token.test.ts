import test from "node:test";
import assert from "node:assert/strict";
import {
  signAliyunRequest,
  createAliyunToken,
  createAliyunTokenManager,
} from "../packages/providers/aliyun-token.ts";
import { ProviderError } from "../packages/providers/flowbar.ts";

// 官方文档给出的测试向量：
// https://help.aliyun.com/zh/isi/getting-started/use-http-or-https-to-obtain-an-access-token
test("signAliyunRequest reproduces Aliyun's own published test vector exactly", () => {
  const params = {
    AccessKeyId: "my_access_key_id",
    Action: "CreateToken",
    Format: "JSON",
    RegionId: "cn-shanghai",
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: "b924c8c3-6d03-4c5d-ad36-d984d3116788",
    SignatureVersion: "1.0",
    Timestamp: "2019-04-18T08:32:31Z",
    Version: "2019-02-28",
  };
  const query = signAliyunRequest(params, "my_access_key_secret", "GET");
  // 文档给出的完整预期 URL 的查询串部分（顺序已按参数名字典序排列，Signature 追加在末尾）
  const expected =
    "AccessKeyId=my_access_key_id&Action=CreateToken&Format=JSON&RegionId=cn-shanghai&SignatureMethod=HMAC-SHA1&SignatureNonce=b924c8c3-6d03-4c5d-ad36-d984d3116788&SignatureVersion=1.0&Timestamp=2019-04-18T08%3A32%3A31Z&Version=2019-02-28&Signature=hHq4yNsPitlfDJ2L0nQPdugdEzM%3D";
  assert.equal(query, expected);
});

test("createAliyunToken fails closed with no network call when AK/SK are missing", async () => {
  let called = false;
  await assert.rejects(
    () =>
      createAliyunToken("", "", async () => {
        called = true;
        throw Error("must not be called");
      }),
    (e: unknown) => e instanceof ProviderError && e.code === "aliyun_akms_missing",
  );
  assert.equal(called, false);
});

test("createAliyunToken parses a successful CreateToken response into token + expiry", async () => {
  const result = await createAliyunToken("ak", "sk", async (url) => {
    assert.match(String(url), /^https:\/\/nls-meta\.cn-shanghai\.aliyuncs\.com\/\?/);
    assert.match(String(url), /Action=CreateToken/);
    assert.match(String(url), /Signature=/);
    return new Response(
      JSON.stringify({
        Token: { Id: "fake-token-value", ExpireTime: 1900000000, UserId: "u1" },
        RequestId: "r1",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  assert.equal(result.token, "fake-token-value");
  assert.equal(result.expireAtMs, 1900000000000);
});

test("createAliyunToken maps a failure response using the real ErrCode field (verified live: RAM permission denial returns ErrCode/ErrMsg, not Code/Message)", async () => {
  await assert.rejects(
    () =>
      createAliyunToken("ak", "no-permission-secret", async () =>
        new Response(
          JSON.stringify({ ErrCode: 40020503, ErrMsg: "No permission!" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    (e: unknown) =>
      e instanceof ProviderError &&
      e.code === "aliyun_token_create_failed_40020503",
  );
});

test("createAliyunToken also accepts the documented Code field as a fallback", async () => {
  await assert.rejects(
    () =>
      createAliyunToken("ak", "wrong-secret", async () =>
        new Response(
          JSON.stringify({ Code: "InvalidAccessKeyId.NotFound", Message: "..." }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    (e: unknown) =>
      e instanceof ProviderError &&
      e.code === "aliyun_token_create_failed_InvalidAccessKeyId.NotFound",
  );
});

test("createAliyunToken rejects an HTTP-level failure distinctly from an API-level failure", async () => {
  await assert.rejects(
    () => createAliyunToken("ak", "sk", async () => new Response("", { status: 500 })),
    (e: unknown) => e instanceof ProviderError && e.code === "aliyun_token_http_500",
  );
});

test("token manager caches a fresh token and does not re-request until it nears expiry", async () => {
  let calls = 0,
    now = 1000000;
  const manager = createAliyunTokenManager(
    "ak",
    "sk",
    async () => {
      calls++;
      return new Response(
        JSON.stringify({
          Token: { Id: "token-" + calls, ExpireTime: now / 1000 + 3600 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
    () => now,
  );
  assert.equal(await manager.getToken(), "token-1");
  assert.equal(await manager.getToken(), "token-1");
  assert.equal(calls, 1);
  now += 3600000 - 60000; // 只剩 1 分钟，落在 5 分钟安全边际内，应触发刷新
  assert.equal(await manager.getToken(), "token-2");
  assert.equal(calls, 2);
});

test("token manager de-duplicates concurrent refreshes into a single real request", async () => {
  let calls = 0;
  let resolveFetch: (r: Response) => void = () => {};
  const manager = createAliyunTokenManager(
    "ak",
    "sk",
    () =>
      new Promise((resolve) => {
        calls++;
        resolveFetch = resolve;
      }),
    () => 0,
  );
  const p1 = manager.getToken();
  const p2 = manager.getToken();
  resolveFetch(
    new Response(JSON.stringify({ Token: { Id: "t", ExpireTime: 999999999 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(a, "t");
  assert.equal(b, "t");
  assert.equal(calls, 1);
});
