import { crc32, deflateRawSync } from 'node:zlib';

/** 安全测试专用：生成可控的ZIP字段，不能用于生产归档 */
export function fixtureZip(
  entries: Array<{
    name: string;
    bytes: Uint8Array;
    localName?: string;
    flags?: number;
    mode?: number;
    extra?: Buffer;
    method?: number;
    declaredBytes?: number;
    checksum?: number;
  }>,
) {
  const locals: Buffer[] = [];
  const directories: Buffer[] = [];
  let offset = 0;
  for (const item of entries) {
    const name = Buffer.from(item.name);
    const localName = Buffer.from(item.localName ?? item.name);
    const extra = item.extra ?? Buffer.alloc(0);
    const method = item.method ?? 0;
    const flags = item.flags ?? 0x800;
    const data = Buffer.from(item.bytes);
    const packed = method === 8 ? deflateRawSync(data) : data;
    const checksum = item.checksum ?? crc32(data);
    const size = item.declaredBytes ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(localName.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(((item.mode ?? 0o100644) * 65536) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, localName, extra, packed);
    directories.push(central, name, extra);
    offset += local.length + localName.length + extra.length + packed.length;
  }
  const directory = Buffer.concat(directories);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
