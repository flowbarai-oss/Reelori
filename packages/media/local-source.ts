import path from "node:path";
import { fileURLToPath } from "node:url";
import { DomainError } from "../core/project.ts";
export function localSource(source: string, assetDir: string) {
  if (/^\/api\/assets\/[a-f0-9]{64}\.(png|jpg|mp4|wav)$/.test(source))
    return path.join(assetDir, source.slice("/api/assets/".length));
  if (
    [
      "/assets/rain-wide.png",
      "/assets/darkroom.png",
      "/assets/rain-portrait.png",
    ].includes(source)
  )
    return fileURLToPath(new URL(`../../public${source}`, import.meta.url));
  throw new DomainError("不支持此素材来源");
}
