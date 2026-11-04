import sharp from 'sharp';
import { PERSONA_AVATAR_MAX_BYTES } from '@personamarket/contracts';
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
export async function normalizeImage(
  bytes: Uint8Array,
  expectedMime?: string,
  personaAvatar = false,
) {
  const limit = personaAvatar ? PERSONA_AVATAR_MAX_BYTES - 1 : 5242880;
  const maxSize = personaAvatar ? '10 MiB' : '5 MiB';
  if (bytes.byteLength === 0 || bytes.byteLength > limit)
    throw new BusinessError('INVALID_INPUT', `图片需要在 ${maxSize} 以内`);
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
    image.rotate();
    if (personaAvatar) image.resize(512, 512, { fit: 'inside', withoutEnlargement: true });
    const { data, info } = await image
      .webp({ quality: 85 })
      .timeout({ seconds: 5 })
      .toBuffer({ resolveWithObject: true });
    if (data.length > 5242880) throw new Error('IMAGE_TOO_LARGE');
    return { data, width: info.width, height: info.height };
  } catch (cause) {
    throw new BusinessError(
      'INVALID_INPUT',
      `图片无法处理，请上传 ${maxSize}、4000 万像素以内的静态 JPEG、PNG 或 WebP`,
      { cause },
    );
  } finally {
    const next = queue.shift();
    if (next) next();
    else running = false;
  }
}
