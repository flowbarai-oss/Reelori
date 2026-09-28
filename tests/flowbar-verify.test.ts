import test from "node:test";
import assert from "node:assert/strict";
import { checkFlowbarKey } from "../packages/providers/flowbar-verify.ts";

test("FlowBarAI connection check is read-only, fixed-host, and distinguishes rejection from outages", async () => {
  const secret = "sk-test-only-never-send";
  let calls = 0;
  const authenticated = await checkFlowbarKey(secret, (async (url, options) => {
    calls++;
    assert.equal(url, "https://api.flowbarai.com/v1/models");
    assert.equal(options?.method, "GET");
    assert.equal(new Headers(options?.headers).get("Authorization"), `Bearer ${secret}`);
    assert.equal(options?.redirect, "error");
    return { status: 200 } as Response;
  }) as typeof fetch);
  assert.deepEqual(authenticated, { state: "authenticated" });
  assert.equal(calls, 1);
  assert.deepEqual(await checkFlowbarKey(secret, (async () => ({ status: 401 }) as Response) as typeof fetch), { state: "rejected" });
  assert.deepEqual(await checkFlowbarKey(secret, (async () => ({ status: 429 }) as Response) as typeof fetch), { state: "unavailable" });
  assert.deepEqual(await checkFlowbarKey(secret, (async () => { throw Error("offline"); }) as typeof fetch), { state: "unavailable" });
});
