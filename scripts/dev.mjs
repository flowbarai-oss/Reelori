import { spawn } from "node:child_process";
// 端口读环境变量（REELORI_PORT/REELORI_WEB_PORT），默认值不变；
// 子进程默认继承父进程环境变量，这里不用额外传递。
const webPort = process.env.REELORI_WEB_PORT || "5178";
const processes = [
  spawn(process.execPath, ["apps/local-service/server.ts"], {
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--config",
      "apps/web/vite.config.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      webPort,
      "--strictPort",
    ],
    { stdio: "inherit" },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const p of processes) p.kill();
  setTimeout(() => process.exit(code), 300);
}
for (const p of processes) {
  p.on("error", () => stop(1));
  p.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
