import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { getDataDir } from "../packages/core/data-dir.ts";
import { Store } from "../packages/storage-local/store.ts";
import * as selection from "../packages/core/workspace-selection.ts";
import {
  createWorkspaceArchive,
  restoreWorkspaceArchive,
} from "../packages/storage-local/workspace-backup.ts";

test("workspace path checks reject a linked ancestor", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "reelori-ancestor-link-"));
  const actual = path.join(root, "actual");
  const linked = path.join(root, "linked");
  mkdirSync(actual);
  try {
    selection.assertUnlinkedDirectory(actual, "linked workspace");
    try {
      symlinkSync(actual, linked, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        t.skip("directory links are unavailable on this machine");
        return;
      }
      throw error;
    }
    assert.throws(
      () => selection.assertUnlinkedDirectory(path.join(linked, "child"), "linked workspace"),
      /linked workspace/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an opt-in device selection chooses a restored workspace while explicit data dir remains highest priority", () => {
  const root = mkdtempSync(path.join(tmpdir(), "reelori-selection-"));
  const beforeData = process.env.REELORI_DATA_DIR,
    beforeSelection = process.env.REELORI_WORKSPACE_SELECTION_FILE;
  try {
    const target = path.join(root, "restored");
    mkdirSync(target);
    new Store(path.join(target, "studio.sqlite")).close();
    const pointer = path.join(root, "selection.json");
    writeFileSync(
      pointer,
      JSON.stringify({
        version: 1,
        active: target,
        previous: null,
        activatedAt: new Date().toISOString(),
      }),
    );
    delete process.env.REELORI_DATA_DIR;
    process.env.REELORI_WORKSPACE_SELECTION_FILE = pointer;
    assert.equal(getDataDir(), target);
    process.env.REELORI_DATA_DIR = path.join(root, "explicit");
    assert.equal(getDataDir(), path.join(root, "explicit"));
    delete process.env.REELORI_DATA_DIR;
    writeFileSync(pointer, '{"active":"."}');
    assert.throws(() => getDataDir(), /工作区选择记录/);
  } finally {
    if (beforeData === undefined) delete process.env.REELORI_DATA_DIR;
    else process.env.REELORI_DATA_DIR = beforeData;
    if (beforeSelection === undefined)
      delete process.env.REELORI_WORKSPACE_SELECTION_FILE;
    else process.env.REELORI_WORKSPACE_SELECTION_FILE = beforeSelection;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a stale device pointer cannot silently create a fresh empty workspace", () => {
  const root = mkdtempSync(path.join(tmpdir(), "reelori-stale-pointer-"));
  const pointer = path.join(root, "selection.json");
  const beforeData = process.env.REELORI_DATA_DIR,
    beforeSelection = process.env.REELORI_WORKSPACE_SELECTION_FILE;
  try {
    writeFileSync(
      pointer,
      JSON.stringify({
        version: 1,
        active: path.join(root, "missing"),
        previous: null,
        activatedAt: new Date().toISOString(),
      }),
    );
    delete process.env.REELORI_DATA_DIR;
    process.env.REELORI_WORKSPACE_SELECTION_FILE = pointer;
    assert.throws(() => getDataDir(), /工作区.*不存在/);
  } finally {
    if (beforeData === undefined) delete process.env.REELORI_DATA_DIR;
    else process.env.REELORI_DATA_DIR = beforeData;
    if (beforeSelection === undefined)
      delete process.env.REELORI_WORKSPACE_SELECTION_FILE;
    else process.env.REELORI_WORKSPACE_SELECTION_FILE = beforeSelection;
    rmSync(root, { recursive: true, force: true });
  }
});

test("offline activation verifies a paused restored workspace, switches only the device pointer, and can roll back", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "reelori-activate-"));
  const origin = path.join(root, "origin"),
    target = path.join(root, "新 工作区"),
    pointer = path.join(root, "selection.json");
  mkdirSync(origin);
  mkdirSync(target);
  const oldStore = new Store(path.join(origin, "studio.sqlite"));
  const newStore = new Store(path.join(target, "studio.sqlite"));
  try {
    newStore.transact((p) => {
      p.paused = true;
      p.revision++;
    });
    const revision = newStore.get().revision;
    oldStore.close();
    newStore.close();
    const checked = await selection.inspectWorkspaceDirectory(target);
    assert.equal(checked.projects, 1);
    assert.equal(checked.paused, true);
    await selection.activateWorkspaceSelection(pointer, origin, target);
    assert.equal(readSelectionActive(pointer), target);
    await selection.rollbackWorkspaceSelection(pointer);
    assert.equal(readSelectionActive(pointer), origin);
    const reopened = new Store(path.join(target, "studio.sqlite"));
    try {
      assert.equal(reopened.get().revision, revision);
    } finally {
      reopened.close();
    }
  } finally {
    try {
      oldStore.close();
    } catch {}
    try {
      newStore.close();
    } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test("activation refuses an unpaused or incomplete target without changing the pointer", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "reelori-selection-reject-"));
  const origin = path.join(root, "origin"),
    target = path.join(root, "target"),
    pointer = path.join(root, "selection.json");
  mkdirSync(origin);
  mkdirSync(target);
  const oldStore = new Store(path.join(origin, "studio.sqlite"));
  const newStore = new Store(path.join(target, "studio.sqlite"));
  try {
    oldStore.close();
    newStore.close();
    await assert.rejects(
      selection.activateWorkspaceSelection(pointer, origin, target),
      /未暂停/,
    );
    assert.equal(selection.readWorkspaceSelection(pointer), null);
    const edit = new Store(path.join(target, "studio.sqlite"));
    try {
      edit.transact((p) => {
        p.paused = true;
        p.shots[0].image = "/api/assets/" + "a".repeat(64) + ".png";
        p.revision++;
      });
    } finally {
      edit.close();
    }
    await assert.rejects(
      selection.activateWorkspaceSelection(pointer, origin, target),
    );
    assert.equal(selection.readWorkspaceSelection(pointer), null);
  } finally {
    try {
      oldStore.close();
    } catch {}
    try {
      newStore.close();
    } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace preflight rejects an incomplete rendered film bundle", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "reelori-film-preflight-"));
  const store = new Store(path.join(root, "studio.sqlite"));
  try {
    store.transact((p) => {
      p.paused = true;
      p.revision++;
    });
    store.close();
    mkdirSync(path.join(root, "exports"));
    writeFileSync(
      path.join(root, "exports", "00000000-0000-4000-8000-000000000001.json"),
      JSON.stringify({ kind: "mixed-media-animatic" }),
    );
    await assert.rejects(
      selection.inspectWorkspaceDirectory(root),
      /成片文件不完整/,
    );
  } finally {
    try {
      store.close();
    } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace preflight rejects a redirected exports directory", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "reelori-export-link-"));
  const target = path.join(root, "workspace"),
    outside = path.join(root, "outside");
  mkdirSync(target);
  mkdirSync(outside);
  const store = new Store(path.join(target, "studio.sqlite"));
  try {
    store.transact((p) => {
      p.paused = true;
      p.revision++;
    });
    store.close();
    try {
      symlinkSync(
        outside,
        path.join(target, "exports"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        t.skip("系统不允许创建目录链接");
        return;
      }
      throw error;
    }
    await assert.rejects(
      selection.inspectWorkspaceDirectory(target),
      /符号链接/,
    );
  } finally {
    try {
      store.close();
    } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test("device selection record cannot be stored inside the workspace being activated", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "reelori-pointer-location-"));
  const origin = path.join(root, "origin"),
    target = path.join(root, "target");
  mkdirSync(origin);
  mkdirSync(target);
  const oldStore = new Store(path.join(origin, "studio.sqlite")),
    newStore = new Store(path.join(target, "studio.sqlite"));
  try {
    newStore.transact((p) => {
      p.paused = true;
      p.revision++;
    });
    oldStore.close();
    newStore.close();
    await assert.rejects(
      selection.activateWorkspaceSelection(
        path.join(target, "selection.json"),
        origin,
        target,
      ),
      /选择记录.*工作区/,
    );
  } finally {
    try {
      oldStore.close();
    } catch {}
    try {
      newStore.close();
    } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test("offline switch command refuses a running service and activates only after it stops", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "reelori-offline-command-"));
  const origin = path.join(root, "origin"),
    target = path.join(root, "恢复 工作区"),
    pointer = path.join(root, "selection.json");
  mkdirSync(origin);
  mkdirSync(target);
  const oldStore = new Store(path.join(origin, "studio.sqlite")),
    newStore = new Store(path.join(target, "studio.sqlite"));
  const occupied = net.createServer();
  try {
    newStore.transact((p) => {
      p.paused = true;
      p.revision++;
    });
    oldStore.close();
    newStore.close();
    writeFileSync(
      pointer,
      JSON.stringify({
        version: 1,
        active: origin,
        previous: null,
        activatedAt: new Date().toISOString(),
      }),
    );
    await new Promise<void>((resolve) =>
      occupied.listen(0, "127.0.0.1", resolve),
    );
    const port = (occupied.address() as net.AddressInfo).port;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      REELORI_WORKSPACE_SELECTION_FILE: pointer,
      REELORI_WORKSPACE_TARGET: target,
      REELORI_PORT: String(port),
    };
    delete env.REELORI_DATA_DIR;
    const blocked = await runSwitch(["activate"], env);
    assert.equal(blocked.code, 1);
    assert.equal(readSelectionActive(pointer), origin);
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    const accepted = await runSwitch(["activate"], env);
    assert.equal(accepted.code, 0, accepted.stderr);
    assert.equal(readSelectionActive(pointer), target);
  } finally {
    try {
      occupied.close();
    } catch {}
    try {
      oldStore.close();
    } catch {}
    try {
      newStore.close();
    } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test("a verified backup restored under the current workspace is eligible for offline activation", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "reelori-restored-activation-"));
  const current = path.join(root, "current"),
    pointer = path.join(root, "device-selection.json");
  mkdirSync(current);
  const store = new Store(path.join(current, "studio.sqlite"));
  try {
    const archive = await createWorkspaceArchive(store, current);
    const restored = await restoreWorkspaceArchive(
      archive,
      path.join(current, "restored-workspaces"),
    );
    const before = store.get().revision;
    const details = await selection.activateWorkspaceSelection(
      pointer,
      current,
      restored.path,
    );
    assert.equal(details.projects, 1);
    assert.equal(readSelectionActive(pointer), restored.path);
    assert.equal(store.get().revision, before);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function runSwitch(args: string[], env: NodeJS.ProcessEnv) {
  const script = fileURLToPath(
    new URL("../scripts/workspace-switch.mjs", import.meta.url),
  );
  return new Promise<{ code: number; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

function readSelectionActive(file: string) {
  return JSON.parse(readFileSync(file, "utf8")).active as string;
}
