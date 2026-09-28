export type FlowbarKeyCheck =
  | { state: "authenticated" }
  | { state: "rejected" }
  | { state: "unavailable" };

export async function checkFlowbarKey(
  key: string,
  request: typeof fetch = fetch,
): Promise<FlowbarKeyCheck> {
  try {
    const response = await request("https://api.flowbarai.com/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 200) return { state: "authenticated" };
    if (response.status === 401 || response.status === 403) return { state: "rejected" };
  } catch { /* Network failure is not proof that a key is invalid. */ }
  return { state: "unavailable" };
}
