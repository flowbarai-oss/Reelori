import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, lstatSync } from "node:fs";
import { assertUnlinkedDirectory, readWorkspaceSelection } from "./workspace-selection.ts";
// 统一数据目录解析：默认仍是仓库内的 data/（开发时行为不变，向后兼容），
// 但打包安装后可以通过 REELORI_DATA_DIR 指到用户级标准路径（比如
// %LOCALAPPDATA%\Reelori），不用改代码，只需要安装程序在启动脚本/快捷方式里
// 设置这个环境变量。此前 runtime.ts/config.ts/server.ts 各自硬编码了一份
// "../../data" 相对路径，三处各自为政；本模块是唯一入口，新代码不要再自己拼路径。
export function getDataDir(): string {
  const custom = process.env.REELORI_DATA_DIR?.trim();
  if (custom) return path.resolve(custom);
  const selectionFile = process.env.REELORI_WORKSPACE_SELECTION_FILE?.trim();
  if (selectionFile) {
    if (!path.isAbsolute(selectionFile))
      throw new Error("工作区选择记录须使用绝对路径");
    const selection = readWorkspaceSelection(selectionFile);
    if (selection) {
      const db = path.join(selection.active, "studio.sqlite");
      if (
        !existsSync(db) ||
        !lstatSync(selection.active).isDirectory() ||
        !lstatSync(db).isFile()
      )
        throw new Error("已选择的工作区不存在或数据库缺失");
      assertUnlinkedDirectory(selection.active, "已选择的工作区目录不允许符号链接");
      return selection.active;
    }
  }
  return path.resolve(fileURLToPath(new URL("../../data", import.meta.url)));
}
