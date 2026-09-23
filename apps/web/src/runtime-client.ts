export function requestRuntimeCheck(request: (route: string, body?: unknown) => Promise<any>) {
  return request('diagnostics', {});
}
