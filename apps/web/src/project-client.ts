export function createProjectClient<T>(
  projectId: string,
  request: (route: string, body?: unknown) => Promise<T>,
) {
  return (route: string, body?: unknown) =>
    request(`${route}?projectId=${encodeURIComponent(projectId)}`, body);
}
