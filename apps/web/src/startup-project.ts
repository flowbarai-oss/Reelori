export function chooseStartupProjectId(
  savedId: string,
  projects: readonly { id: string }[],
): string | null {
  return (
    projects.find((project) => project.id === savedId)?.id ??
    projects.find((project) => project.id === "sample")?.id ??
    projects[0]?.id ??
    null
  );
}
