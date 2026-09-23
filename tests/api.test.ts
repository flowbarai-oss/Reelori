import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../apps/local-service/server.ts";
import { Store } from "../packages/storage-local/store.ts";
import http from "node:http";
const fetch = (
  url: string,
  options: { headers: Record<string, string>; method?: string; body?: string },
) =>
  new Promise<{
    status: number;
    headers: { get: (key: string) => string | null };
  }>((resolve, reject) => {
    const req = http.request(
      url,
      { method: options.method, headers: options.headers },
      (res) => {
        res.resume();
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            headers: {
              get: (key) => {
                const value = res.headers[key];
                return Array.isArray(value) ? value.join(";") : (value ?? null);
              },
            },
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
test("API requires a local session and trusted origin; invalid writes cannot alter data", async () => {
  const store = new Store(":memory:");
  const server = createApi(store, 4311, 5178);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { Host: "127.0.0.1:4311" };
  try {
    assert.equal((await fetch(url + "/api/project", { headers })).status, 401);
    assert.equal(
      (
        await fetch(url + "/api/session", {
          headers: { Host: "evil.example:4311" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(url + "/api/session", {
          headers: { ...headers, Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    const response = await fetch(url + "/api/session", { headers });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const auth = {
      ...headers,
      Cookie: cookie,
      "Content-Type": "application/json",
    };
    assert.equal(
      (
        await fetch(url + "/api/preview", {
          method: "POST",
          headers: auth,
          body: "{}",
        })
      ).status,
      403,
    );
    const local = { ...auth, Origin: "http://127.0.0.1:5178" };
    assert.equal(
      (
        await fetch(url + "/api/shot", {
          method: "POST",
          headers: local,
          body: JSON.stringify({ id: "rain-letter", revision: 1 }),
        })
      ).status,
      400,
    );
    assert.equal(store.get().revision, 1);
    assert.equal(
      (
        await fetch(url + "/api/preview", {
          method: "POST",
          headers: local,
          body: JSON.stringify({ revision: 1 }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(url + "/api/preview", {
          method: "POST",
          headers: local,
          body: JSON.stringify({ revision: 1 }),
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await fetch(url + "/api/manifest", {
          headers: { ...headers, Cookie: cookie },
        })
      ).status,
      409,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});
