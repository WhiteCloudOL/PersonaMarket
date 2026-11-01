import { ImportPreviewRequestSchema } from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';

/** Busboy普通filename头按Latin-1读取；已解码的Unicode或非UTF-8文件名不重复转码 */
export function importFilename(originalName: string) {
  let decoded = originalName;
  if (Array.from(originalName).every((character) => (character.codePointAt(0) ?? 0) <= 255)) {
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.from(originalName, 'latin1'),
      );
    } catch {
      // 编码无法确定时保留原名，由统一契约继续校验
    }
  }
  const filename = ImportPreviewRequestSchema.shape.filename.safeParse(decoded);
  if (!filename.success)
    throw new BusinessError('INVALID_INPUT', '请使用不含控制字符或路径的有效文件名');
  return filename.data;
}
