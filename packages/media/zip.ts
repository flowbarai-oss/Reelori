import { crc32 } from "node:zlib";
import { DomainError } from "../core/project.ts";
export interface ZipEntry {
  name: string;
  bytes: Buffer;
}
export function makeZip(entries: ZipEntry[]) {
  let offset = 0;
  const local: Buffer[] = [],
    central: Buffer[] = [];
  const seen = new Set();
  if (
    entries.length > 1000 ||
    entries.reduce((n, e) => n + e.bytes.length, 0) > 128 * 1024 * 1024
  )
    throw new DomainError("交付包超过 128 MiB 上限", 413);
  for (const e of entries) {
    if (
      !/^[A-Za-z0-9/_\-.]+$/.test(e.name) ||
      e.name.startsWith("/") ||
      e.name.split("/").some((p) => p === ".." || !p) ||
      seen.has(e.name)
    )
      throw new DomainError("交付文件路径无效");
    seen.add(e.name);
    const name = Buffer.from(e.name);
    const crc = crc32(e.bytes);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x800, 6);
    h.writeUInt16LE(33, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(e.bytes.length, 18);
    h.writeUInt32LE(e.bytes.length, 22);
    h.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(33, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(e.bytes.length, 20);
    c.writeUInt32LE(e.bytes.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    local.push(h, name, e.bytes);
    central.push(c, name);
    offset += h.length + name.length + e.bytes.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
