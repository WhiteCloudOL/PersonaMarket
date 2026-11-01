import sharp from 'sharp';
import { BusinessError } from './errors.js';
let running = false;
let waiting = 0;
const queue: Array<() => void> = [];
async function acquire() {
  if (running) {
    if (waiting >= 3) throw new BusinessError('SERVICE_UNAVAILABLE', '图片处理繁忙，请稍后重试');
    waiting++;
    await new Promise<void>((resolve) => queue.push(resolve));
    waiting--;
  }
  running = true;
}
export async function normalizeImage(bytes: Uint8Array, expectedMime?: string) {
  if (bytes.byteLength > 5242880 || bytes.byteLength === 0)
    throw new BusinessError('INVALID_INPUT', '图片需要在 5 MiB 以内');
  await acquire();
  try {
    const image = sharp(bytes, { limitInputPixels: 40000000, animated: false, failOn: 'warning' });
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
      (metadata.pages ?? 1) > 1 ||
      (expectedMime !== undefined &&
        expectedMime !== `image/${metadata.format === 'jpeg' ? 'jpeg' : metadata.format}`)
    )
      throw new Error('UNSUPPORTED_IMAGE');
    const { data, info } = await image
      .rotate()
      .webp({ quality: 85 })
      .timeout({ seconds: 5 })
      .toBuffer({ resolveWithObject: true });
    if (data.length > 5242880) throw new Error('IMAGE_TOO_LARGE');
    return { data, width: info.width, height: info.height };
  } catch (cause) {
    throw new BusinessError(
      'INVALID_INPUT',
      '图片无法处理，请上传 5 MiB、4000 万像素以内的静态 JPEG、PNG 或 WebP',
      { cause },
    );
  } finally {
    const next = queue.shift();
    if (next) next();
    else running = false;
  }
}
