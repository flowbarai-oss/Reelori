import { DomainError } from "../core/project.ts";
import { MAX_FILM_SECONDS, MAX_FILM_SHOTS } from "../core/film-limits.ts";
import type { Project, Shot } from "../contracts/index.ts";
import { validateLedger } from '../providers/validation.ts';
import {validateAudioTracks} from '../core/audio.ts';
const fail = () => {
  throw new DomainError("备份项目结构或数据约束无效");
};
function object(x: any, keys: string[]) {
  if (
    !x ||
    typeof x !== "object" ||
    Array.isArray(x) ||
    Object.keys(x).some((k) => !keys.includes(k))
  )
    fail();
}
function text(x: any, max = 2000, required = false) {
  if (
    typeof x !== "string" ||
    x.length > max ||
    (required && !x.trim()) ||
    x.includes("\0")
  )
    fail();
}
function num(x: any, max = Number.MAX_SAFE_INTEGER, min = 0) {
  if (!Number.isSafeInteger(x) || x < min || x > max) fail();
}
function id(x: any) {
  text(x, 100, true);
  if (!/^[a-zA-Z0-9_-]+$/.test(x)) fail();
}
function list(x: any, max: number) {
  if (!Array.isArray(x) || x.length > max) fail();
  return x as any[];
}
function enumeration(x: any, values: unknown[]) {
  if (!values.includes(x)) fail();
}
export function validImage(x: unknown): asserts x is string {
  if (
    typeof x !== "string" ||
    !(
      /^\/api\/assets\/[a-f0-9]{64}\.(png|jpg)$/.test(x) ||
      [
        "/assets/rain-wide.png",
        "/assets/darkroom.png",
        "/assets/rain-portrait.png",
      ].includes(x)
    )
  )
    fail();
}
function shots(value: any): Shot[] {
  const rows = list(value, MAX_FILM_SHOTS);
  if (!rows.length) fail();
  const ids = new Set();
  let seconds = 0;
  for (const s of rows) {
    object(s, [
      "id",
      "sceneId",
      "characterIds",
      "clipStartSeconds",
      "sourceSeconds",
      "title",
      "description",
      "dialogue",
      "seconds",
      "frame",
      "image",
      "locked",
      "revision",
      "candidates",
      "adoptedId",
      "review",
    ]);
    id(s.id);
    if (s.sceneId !== undefined) id(s.sceneId);
    if (s.characterIds !== undefined) {
      const characterIds = list(s.characterIds, 8);
      if (new Set(characterIds).size !== characterIds.length) fail();
      characterIds.forEach(id);
    }
    if (ids.has(s.id)) fail();
    ids.add(s.id);
    for (const k of ["title", "description", "dialogue", "frame"]) text(s[k]);
    num(s.seconds, 10, 2);
    if (s.clipStartSeconds !== undefined || s.sourceSeconds !== undefined) {
      num(s.clipStartSeconds, 8);
      num(s.sourceSeconds, 10, 2);
      if (s.clipStartSeconds + s.seconds > s.sourceSeconds) fail();
    }
    seconds += s.seconds;
    num(s.revision, Number.MAX_SAFE_INTEGER, 1);
    enumeration(s.locked, [true, false]);
    validImage(s.image);
    enumeration(s.review, ["pending", "accepted"]);
    const candidates = list(s.candidates, 1000);
    const cids = new Set();
    for (const c of candidates) {
      object(c, ["id", "image", "createdAt", "inputRevision", "mode", "video"]);
      if(c.video!==undefined && (typeof c.video!=='string'||!/^\/api\/assets\/[a-f0-9]{64}\.mp4$/.test(c.video)))fail();
      id(c.id);
      if (cids.has(c.id)) fail();
      cids.add(c.id);
      validImage(c.image);
      num(c.createdAt);
      num(c.inputRevision, s.revision, 1);
      enumeration(c.mode, ["sample", "provider"]);
    }
    if (s.adoptedId !== null) {
      id(s.adoptedId);
      if (!cids.has(s.adoptedId)) fail();
    }
    if (
      s.review === "accepted" &&
      !candidates.some(
        (c) => c.id === s.adoptedId && c.inputRevision === s.revision,
      )
    )
      fail();
  }
  if (seconds > MAX_FILM_SECONDS) fail();
  return rows;
}
export function validateProject(value: unknown): asserts value is Project {
  const p = value as any;
  object(p, [
    "id",
    "title",
    "story",
    "sourceName",
    "createdAt",
    "references",
    "series",
    "scenes",
    "characters",
    "revision",
    "inputRevision",
    "referenceRevision",
    "budgetCents",
    "shots",
    "jobs",
    "preview",
    "paused",
    "events",
    "provider",
    "audioTracks", "audioRevision", "subtitleCues", "subtitleRevision",
  ]);
  id(p.id);
  text(p.title, 80, true);
  text(p.story, 40000, true);
  if (p.sourceName !== undefined) text(p.sourceName, 255);
  if (p.createdAt !== undefined) num(p.createdAt);
  if (p.series !== undefined) {
    object(p.series, ["id", "title", "episode"]);
    id(p.series.id);
    text(p.series.title, 80, true);
    num(p.series.episode, 100, 1);
  }
  for (const key of ["revision", "inputRevision", "referenceRevision"])
    num(p[key], Number.MAX_SAFE_INTEGER - 1, 1);
  num(p.budgetCents, 1000000);
  enumeration(p.paused, [true, false]);
  const current = shots(p.shots);
  validateAudioTracks(p);
  validateSubtitles(p);
  if(p.provider!==undefined)validateLedger(p.provider,current,p.referenceRevision);
  let spent = 0;
  const jobIds = new Set();
  for (const j of list(p.jobs, 6000)) {
    object(j, [
      "id",
      "operationId",
      "shotId",
      "shotRevision",
      "referenceRevision",
      "status",
      "createdAt",
      "startedAt",
      "completedAt",
      "reservedCents",
      "settledCents",
      "stage",
    ]);
    id(j.id);
    if (jobIds.has(j.id)) fail();
    jobIds.add(j.id);
    text(j.operationId, 100, true);
    id(j.shotId);
    const shot = current.find((s) => s.id === j.shotId);
    if (!shot) fail();
    num(j.shotRevision, shot!.revision, 1);
    num(j.referenceRevision, p.referenceRevision, 1);
    enumeration(j.status, [
      "queued",
      "running",
      "succeeded",
      "cancelled",
      "unknown",
    ]);
    num(j.createdAt);
    for (const key of ["startedAt", "completedAt"])
      if (j[key] !== null) num(j[key]);
    for (const key of ["reservedCents", "settledCents"]) num(j[key], 1000000);
    num(j.stage, 4);
    spent += j.settledCents;
    if (["queued", "running", "unknown"].includes(j.status))
      spent += j.reservedCents;
  }
  if (spent > p.budgetCents) fail();
  if (p.preview !== null) {
    const s = p.preview;
    object(s, [
      "id",
      "inputRevision",
      "referenceRevision",
      "shots",
      "scenes",
      "characters",
      "createdAt",
    ]);
    id(s.id);
    num(s.inputRevision, p.inputRevision, 1);
    num(s.referenceRevision, p.referenceRevision, 1);
    num(s.createdAt);
    shots(s.shots);
    if (s.scenes !== undefined) for (const scene of list(s.scenes, 8)) {
      object(scene, ["id", "name", "location", "notes"]);
      id(scene.id); text(scene.name, 80, true); text(scene.location, 120); text(scene.notes, 500);
    }
    if (s.characters !== undefined) for (const character of list(s.characters, 8)) {
      object(character, ["id", "name", "description", "referenceId"]);
      id(character.id); text(character.name, 80, true); text(character.description, 500);
      if (character.referenceId !== undefined) id(character.referenceId);
    }
  }
  const refs = new Set();
  for (const r of list(p.references ?? [], 64)) {
    object(r, ["id", "name", "image", "rights", "note", "createdAt"]);
    id(r.id);
    if (refs.has(r.id)) fail();
    refs.add(r.id);
    text(r.name, 80, true);
    text(r.note, 500, true);
    validImage(r.image);
    enumeration(r.rights, ["owned", "licensed", "generated"]);
    num(r.createdAt);
  }
  const sceneIds = new Set<string>();
  for (const scene of list(p.scenes ?? [], 8)) {
    object(scene, ["id", "name", "location", "notes"]);
    id(scene.id);
    if (sceneIds.has(scene.id)) fail();
    sceneIds.add(scene.id);
    text(scene.name, 80, true);
    text(scene.location, 120);
    text(scene.notes, 500);
  }
  const characterIds = new Set<string>();
  for (const character of list(p.characters ?? [], 8)) {
    object(character, ["id", "name", "description", "referenceId"]);
    id(character.id);
    if (characterIds.has(character.id)) fail();
    characterIds.add(character.id);
    text(character.name, 80, true);
    text(character.description, 500);
    if (character.referenceId !== undefined) {
      id(character.referenceId);
      if (!refs.has(character.referenceId)) fail();
    }
  }
  for (const shot of [...current, ...(p.preview?.shots ?? [])]) {
    if (shot.sceneId !== undefined && !sceneIds.has(shot.sceneId)) fail();
    if ((shot.characterIds ?? []).some((characterId: string) => !characterIds.has(characterId))) fail();
  }
  let last = 0;
  for (const e of list(p.events, 100)) {
    object(e, ["id", "text", "at"]);
    num(e.id, Number.MAX_SAFE_INTEGER, 1);
    if (e.id <= last) fail();
    last = e.id;
    text(e.text, 2000);
    num(e.at);
  }
}
import {validateSubtitles} from '../core/subtitles.ts';
