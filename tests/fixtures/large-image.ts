import { crc32, deflateSync } from 'node:zlib';

/** 固定种子的真实 RGB PNG，归一化后仍足够大，用于实际文件配额回归 */
export function quotaImagePng() {
  const width = 1024,
    height = 1024,
    stride = width * 3 + 1;
  const scanlines = Buffer.alloc(height * stride);
  let seed = 0x47ad91e3;
  for (let y = 0; y < height; y++) {
    for (let x = 1; x < stride; x++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      scanlines[y * stride + x] = seed & 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  function chunk(kind: string, bytes: Buffer) {
    const type = Buffer.from(kind),
      length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    checksum.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
    return Buffer.concat([length, type, bytes, checksum]);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
