import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// 端口可通过环境变量覆盖（默认值不变，开发时行为向后兼容），
// 跟 apps/local-service/server.ts 读的是同一对环境变量，两边不能只改一边。
const apiPort = Number(process.env.REELORI_PORT) || 4311;
const webPort = Number(process.env.REELORI_WEB_PORT) || 5178;

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("../../public", import.meta.url)),
  resolve: { dedupe: ["react", "react-dom"] },
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    port: webPort,
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});
