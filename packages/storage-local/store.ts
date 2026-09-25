import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { DomainError, seedProject, tick } from "../core/project.ts";
import { MAX_FILM_SHOTS } from "../core/film-limits.ts";
import type { Project } from "../contracts/index.ts";
export class Store {
  db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    try {
      this.db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
      );
      const version = Number(
        this.db.prepare("PRAGMA user_version").get()!.user_version,
      );
      if (version > 1)
        throw new Error("Database is newer than this application");
      if (version === 0) {
        const legacy = this.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='projects'",
          )
          .get();
        if (legacy && file !== ":memory:") {
          const backup = file + ".before-v1.sqlite";
          if (existsSync(backup))
            throw new Error(
              "Upgrade backup already exists; inspect it before retrying migration",
            );
          this.db.prepare("VACUUM INTO ?").run(backup);
        }
        this.db.exec("BEGIN IMMEDIATE");
        try {
          const rows = legacy
            ? this.db.prepare("SELECT body FROM projects").all()
            : [];
          if (legacy)
            this.db.exec("ALTER TABLE projects RENAME TO legacy_projects_v0");
          this.db
            .exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE shots(project_id TEXT NOT NULL REFERENCES projects(id),id TEXT NOT NULL,position INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(project_id,id));
      CREATE TABLE jobs(project_id TEXT NOT NULL REFERENCES projects(id),id TEXT NOT NULL,position INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(project_id,id));
      CREATE TABLE project_revisions(project_id TEXT NOT NULL REFERENCES projects(id),revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(project_id,revision));`);
          for (const row of rows) this.save(JSON.parse(String(row.body)));
          if (!rows.length) this.save(seedProject());
          this.db.exec("PRAGMA user_version=1; COMMIT");
        } catch (error) {
          this.db.exec("ROLLBACK");
          throw error;
        }
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private save(p: Project) {
    const { shots, jobs, ...metadata } = p;
    this.db
      .prepare(
        "INSERT INTO projects VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(p.id, JSON.stringify(metadata));
    for (const [table, items] of [
      ["shots", shots],
      ["jobs", jobs],
    ] as const) {
      this.db.prepare(`DELETE FROM ${table} WHERE project_id=?`).run(p.id);
      const insert = this.db.prepare(`INSERT INTO ${table} VALUES (?,?,?,?)`);
      items.forEach((item, i) =>
        insert.run(p.id, item.id, i, JSON.stringify(item)),
      );
    }
    this.db
      .prepare("INSERT OR IGNORE INTO project_revisions VALUES (?,?,?)")
      .run(p.id, p.revision, JSON.stringify(p));
  }
  get(id = "sample"): Project {
    const row = this.db.prepare("SELECT body FROM projects WHERE id=?").get(id);
    if (!row) throw new DomainError("项目不存在", 404);
    const p = JSON.parse(String(row.body));
    for (const table of ["shots", "jobs"])
      p[table] = this.db
        .prepare(
          `SELECT body FROM ${table} WHERE project_id=? ORDER BY position`,
        )
        .all(id)
        .map((row) => JSON.parse(String(row.body)));
    return p;
  }
  list() {
    return this.db
      .prepare("SELECT body FROM projects ORDER BY rowid DESC")
      .all()
      .map((row) => {
        const p = JSON.parse(String(row.body)) as Project;
        return {
          id: p.id,
          title: p.title,
          story: p.story.slice(0, 120),
          revision: p.revision,
          createdAt: p.createdAt ?? 0,
        };
      });
  }
  create(input: {
    title: string;
    story: string;
    sourceName?: string;
  }): Project {
    if (
      typeof input.title !== "string" ||
      !input.title.trim() ||
      input.title.length > 80
    )
      throw new DomainError("项目名称须为 1–80 字");
    if (
      typeof input.story !== "string" ||
      !input.story.trim() ||
      input.story.length > 40000 ||
      /[\u0000\ufffd]/.test(input.story)
    )
      throw new DomainError("请输入有效 UTF-8 原文，最多 40,000 字");
    if (
      input.sourceName !== undefined &&
      (typeof input.sourceName !== "string" || input.sourceName.length > 255)
    )
      throw new DomainError("文件名无效");
    const p = seedProject();
    p.id = randomUUID();
    p.title = input.title.trim();
    p.story = input.story;
    p.sourceName = input.sourceName ?? "pasted";
    p.createdAt = Date.now();
    const paragraphs = input.story.trim().split(/\r?\n\s*\r?\n/);
    const lines = input.story
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const parts =
      paragraphs.length === 1 && lines.length > 1 ? lines : paragraphs;
    const count = Math.max(3, Math.min(MAX_FILM_SHOTS, parts.length));
    p.shots = Array.from({ length: count }, (_, i) => ({
      ...seedProject().shots[i % 3],
      id: randomUUID(),
      title: `镜头 ${String(i + 1).padStart(2, "0")}`,
      description:
        parts.length <= MAX_FILM_SHOTS && (parts[i]?.length ?? 0) <= 2000
          ? (parts[i] ?? "")
          : "",
      dialogue: "",
      locked: false,
    }));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.save(p);
      this.db.exec("COMMIT");
      return p;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  transact(fn: (p: Project) => void, id = "sample"): Project {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const p = this.get(id);
      fn(p);
      this.save(p);
      this.db.exec("COMMIT");
      return p;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  history(id: string): Project[] {
    this.get(id);
    return this.db
      .prepare(
        "SELECT body FROM project_revisions WHERE project_id=? ORDER BY revision",
      )
      .all(id)
      .map((row) => JSON.parse(String(row.body)));
  }
  insertRestored(project: Project, history: Project[]): Project {
    if (this.db.prepare("SELECT id FROM projects WHERE id=?").get(project.id))
      throw new DomainError("恢复目标已存在", 409);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const revision of history) this.save(revision);
      this.save(project);
      this.db.exec("COMMIT");
      return project;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  tick(now?: number) {
    for (const item of this.list()) {
      const p = this.get(item.id);
      if (
        p.jobs.some(
          (j) => j.status === "running" || (!p.paused && j.status === "queued"),
        )
      )
        this.transact((d) => {
          tick(d, now);
        }, p.id);
    }
    return this.get();
  }
  close() {
    this.db.close();
  }
}
