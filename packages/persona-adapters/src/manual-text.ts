import type { ImportTextEncoding } from '@personamarket/contracts';
import { decodeImportText, ImportParseError } from './parser.js';

/** 原文只当作供用户选择的纯文本，不渲染HTML、不按标题猜测平台字段 */
export function readManualImportText(bytes: Uint8Array, encoding: ImportTextEncoding) {
  const decoded = decodeImportText(bytes, encoding);
  if (!decoded.text.length)
    throw new ImportParseError('INVALID_FORMAT', '请选择包含正文的文本文件');
  if (decoded.text.includes('\0'))
    throw new ImportParseError('INVALID_ENCODING', '文件包含空字符，请选择正确的文本编码后重试');
  return decoded;
}
