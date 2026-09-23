import net from "node:net";
import path from "node:path";
import { getDataDir } from "../packages/core/data-dir.ts";
import {
  activateWorkspaceSelection,
  inspectWorkspaceDirectory,
  readWorkspaceSelection,
  rollbackWorkspaceSelection,
} from "../packages/core/workspace-selection.ts";

function serviceIsListening(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("无法确认本机服务已停止"));
    });
    socket.once("error", (error) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
  });
}

async function main() {
  const [action, target, ...extra] = process.argv.slice(2);
  const targetFromEnv = process.env.REELORI_WORKSPACE_TARGET?.trim();
  const chosenTarget = target ?? targetFromEnv;
  if (
    extra.length ||
    !["inspect", "status", "activate", "rollback"].includes(action) ||
    ((action === "inspect" || action === "activate") && !chosenTarget) ||
    ((action === "status" || action === "rollback") && target) ||
    (target && targetFromEnv && target !== targetFromEnv)
  )
    throw new Error(
      "用法：workspace-switch.mjs inspect|activate <工作区绝对路径>，或在 REELORI_WORKSPACE_TARGET 中设置路径；status|rollback 无需目标",
    );
  if (action === "inspect") {
    console.log(JSON.stringify(await inspectWorkspaceDirectory(chosenTarget)));
    return;
  }
  const selector = process.env.REELORI_WORKSPACE_SELECTION_FILE?.trim();
  if (!selector || !path.isAbsolute(selector))
    throw new Error("请设置绝对路径 REELORI_WORKSPACE_SELECTION_FILE");
  if (action === "status") {
    console.log(
      JSON.stringify({
        active: getDataDir(),
        selection: readWorkspaceSelection(selector),
      }),
    );
    return;
  }
  if (process.env.REELORI_DATA_DIR?.trim())
    throw new Error("显式 REELORI_DATA_DIR 优先；请先移除该覆盖再切换工作区");
  const port = Number(process.env.REELORI_PORT ?? 4311);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("REELORI_PORT 无效");
  if (await serviceIsListening(port))
    throw new Error(`本机服务仍在端口 ${port} 运行，请先停止服务`);
  if (action === "activate") {
    const current = getDataDir();
    const result = await activateWorkspaceSelection(
      selector,
      current,
      chosenTarget,
    );
    console.log(
      JSON.stringify({ active: chosenTarget, previous: current, ...result }),
    );
  } else {
    const active = await rollbackWorkspaceSelection(selector);
    console.log(JSON.stringify({ active }));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
