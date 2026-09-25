import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ProviderError } from "./flowbar.ts";

/** Resolve a content-addressed upload only from the local asset directory. */
export async function readH3Reference(assetDir: string, image: string): Promise<Buffer> {
  const match = /^\/api\/assets\/([a-f0-9]{64})\.(png|jpg)$/.exec(image);
  if (!match) throw new ProviderError("invalid_reference_asset");
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(assetDir, `${match[1]}.${match[2]}`));
  } catch {
    throw new ProviderError("reference_asset_missing");
  }
  if (bytes.length < 1 || bytes.length > 5 * 1024 * 1024 ||
      createHash("sha256").update(bytes).digest("hex") !== match[1])
    throw new ProviderError("reference_asset_changed");
  let width = 0, height = 0;
  if (match[2] === "png") {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString("ascii", 12, 16) !== "IHDR")
      throw new ProviderError("reference_image_format_invalid");
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216)
      throw new ProviderError("reference_image_format_invalid");
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 255) break;
      const marker = bytes[i + 1], len = bytes.readUInt16BE(i + 2);
      if (len < 2 || i + 2 + len > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && len >= 7) {
        height = bytes.readUInt16BE(i + 5);
        width = bytes.readUInt16BE(i + 7);
        break;
      }
      i += 2 + len;
    }
  }
  if (width < 256 || height < 256 || width > 5760 || height > 5760 ||
      width / height < 0.4 || width / height > 2.5)
    throw new ProviderError("reference_image_dimensions_unsupported");
  return bytes;
}
