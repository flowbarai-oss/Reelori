import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ProviderError } from "./flowbar.ts";
export function publicIPv4(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  );
}
export async function downloadImage(source: string): Promise<string> {
  return (await downloadBytes(source, 5 * 1024 * 1024)).toString("base64");
}
export async function downloadBytes(
  source: string,
  max = 64 * 1024 * 1024,
): Promise<Buffer> {
  let u: URL;
  try {
    u = new URL(source);
  } catch {
    throw new ProviderError("invalid_result_url");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    u.hash ||
    source.length > 4096
  )
    throw new ProviderError("unsafe_result_url");
  const addresses = await lookup(u.hostname, { family: 4, all: true });
  if (!addresses.length || addresses.some((x) => !publicIPv4(x.address)))
    throw new ProviderError("unsafe_result_host");
  const pinned = addresses[0].address;
  return new Promise((resolve, reject) => {
    const fail = () => reject(new ProviderError("result_download_failed"));
    const req = https.get(
      u,
      {
        lookup: (_host, options, callback) => {
          if ((options as any).all)
            (callback as any)(null, [{ address: pinned, family: 4 }]);
          else (callback as any)(null, pinned, 4);
        },
      },
      (res) => {
        if (
          res.statusCode !== 200 ||
          Number(res.headers["content-length"]) > max
        ) {
          res.destroy();
          fail();
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > max) {
            res.destroy();
            fail();
          } else chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", fail);
      },
    );
    const deadline = setTimeout(() => {
      req.destroy();
      fail();
    }, 20000);
    req.on("close", () => clearTimeout(deadline));
    req.on("error", fail);
  });
}
