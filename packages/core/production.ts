import { randomUUID } from "node:crypto";
import type { Project, Scene, Character } from "../contracts/index.ts";
import { DomainError } from "./project.ts";

function checkRevision(project: Project, revision: unknown) {
  if (project.revision !== revision) throw new DomainError("项目已更新，请刷新后重试", 409);
}
function label(value: unknown, max: number, required = false): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0") ||
    (required && !value.trim())) throw new DomainError("场景或角色文字无效");
  return value.trim();
}
function log(project: Project, message: string) {
  project.events.push({ id: (project.events.at(-1)?.id ?? 0) + 1, text: message, at: Date.now() });
  if (project.events.length > 100) project.events.shift();
}
function invalidateAssigned(project: Project, kind: "scene" | "character", id: string) {
  let affected = false;
  for (const shot of project.shots) {
    if (kind === "scene" ? shot.sceneId === id : (shot.characterIds ?? []).includes(id)) {
      shot.revision++;
      shot.review = "pending";
      affected = true;
    }
  }
  if (affected) project.inputRevision++;
}
export function saveScene(project: Project, input: unknown, revision: unknown) {
  checkRevision(project, revision);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new DomainError("场景格式无效");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["id", "name", "location", "notes"].includes(key)))
    throw new DomainError("场景字段无效");
  const name = label(value.name, 80, true), location = label(value.location, 120), notes = label(value.notes, 500);
  const scenes = project.scenes ?? (project.scenes = []);
  if (value.id === undefined) {
    if (scenes.length >= 8) throw new DomainError("最多 8 个场景", 409);
    scenes.push({ id: randomUUID(), name, location, notes });
  } else {
    if (typeof value.id !== "string") throw new DomainError("场景标识无效");
    const scene = scenes.find((item) => item.id === value.id);
    if (!scene) throw new DomainError("场景不存在", 404);
    if (scene.name === name && scene.location === location && scene.notes === notes) return;
    Object.assign(scene, { name, location, notes } satisfies Partial<Scene>);
    invalidateAssigned(project, "scene", scene.id);
  }
  project.revision++;
  log(project, "场景资料已保存");
}
export function saveCharacter(project: Project, input: unknown, revision: unknown) {
  checkRevision(project, revision);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new DomainError("角色格式无效");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["id", "name", "description", "referenceId"].includes(key)))
    throw new DomainError("角色字段无效");
  const name = label(value.name, 80, true), description = label(value.description, 500);
  const referenceId = value.referenceId === "" ? undefined : value.referenceId;
  if (referenceId !== undefined &&
    (typeof referenceId !== "string" || !(project.references ?? []).some((item) => item.id === referenceId)))
    throw new DomainError("角色参考图不存在", 409);
  const characters = project.characters ?? (project.characters = []);
  if (value.id === undefined) {
    if (characters.length >= 8) throw new DomainError("最多 8 个角色", 409);
    characters.push({ id: randomUUID(), name, description, ...(referenceId ? { referenceId } : {}) });
  } else {
    if (typeof value.id !== "string") throw new DomainError("角色标识无效");
    const character = characters.find((item) => item.id === value.id);
    if (!character) throw new DomainError("角色不存在", 404);
    if (character.name === name && character.description === description && character.referenceId === referenceId) return;
    const referenceChanged = character.referenceId !== referenceId;
    Object.assign(character, { name, description } satisfies Partial<Character>);
    if (referenceId === undefined) delete character.referenceId;
    else character.referenceId = referenceId;
    invalidateAssigned(project, "character", character.id);
    if (referenceChanged) project.referenceRevision++;
  }
  project.revision++;
  log(project, "角色资料已保存");
}
