import type { Project, Shot } from "../contracts/index.ts";

export function productionPrompt(project: Project, shot: Shot, kind: "image" | "video" | "audio") {
  if (kind === "audio") return shot.dialogue;
  const context: string[] = [];
  const scene = (project.scenes ?? []).find((item) => item.id === shot.sceneId);
  if (scene && (scene.name !== "场景 1" || scene.location || scene.notes)) {
    context.push(`场景：${scene.name}${scene.location ? `；地点与时间：${scene.location}` : ""}${scene.notes ? `；连续性：${scene.notes}` : ""}`);
  }
  for (const id of shot.characterIds ?? []) {
    const character = (project.characters ?? []).find((item) => item.id === id);
    if (character) context.push(`角色：${character.name}${character.description ? `；外观与性格：${character.description}` : ""}`);
  }
  return [shot.description, ...context].join("\n");
}
