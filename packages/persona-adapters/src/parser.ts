import { parse } from 'toml';
import {
  IMPORT_TEXT_MAX_BYTES,
  type ImportTextEncoding,
  type ImportSourceEncoding,
} from '@personamarket/contracts';

export type ImportParseCode =
  'IMPORT_TOO_LARGE' | 'INVALID_ENCODING' | 'INVALID_FORMAT' | 'IMPORT_TOO_COMPLEX' | 'UNSAFE_KEY';
export class ImportParseError extends Error {
  constructor(
    readonly code: ImportParseCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ImportParseError';
  }
}

export type DecodedImportText = {
  text: string;
  sourceEncoding: ImportSourceEncoding;
  warnings: string[];
};
/** 按原始字节限额解码，不重新编码计数，不裁剪作者正文或规范化换行 */
export function decodeImportText(
  bytes: Uint8Array,
  requested: ImportTextEncoding,
): DecodedImportText {
  if (bytes.byteLength > IMPORT_TEXT_MAX_BYTES)
    throw new ImportParseError('IMPORT_TOO_LARGE', '导入文件超过 4 MiB');
  if (
    (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) ||
    (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)
  )
    throw new ImportParseError('INVALID_ENCODING', '暂不支持 UTF-32，请另存为 UTF-8 或 UTF-16');
  const bom =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? 'utf-8'
      : bytes[0] === 0xff && bytes[1] === 0xfe
        ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? 'utf-16be'
          : undefined;
  if (requested !== 'auto' && bom && bom !== requested)
    throw new ImportParseError('INVALID_ENCODING', '所选编码与文件 BOM 不一致，请重新选择编码');
  const decode = (encoding: ImportSourceEncoding['encoding']) =>
    new TextDecoder(encoding, { fatal: true }).decode(bytes);
  try {
    if (requested !== 'auto')
      return {
        text: decode(requested),
        sourceEncoding: { encoding: requested, determinedBy: 'manual' },
        warnings: [],
      };
    if (bom)
      return {
        text: decode(bom),
        sourceEncoding: { encoding: bom, determinedBy: 'bom' },
        warnings: [],
      };
    try {
      return {
        text: decode('utf-8'),
        sourceEncoding: { encoding: 'utf-8', determinedBy: 'utf8' },
        warnings: [],
      };
    } catch {
      // GBK是GB18030的常用子集；字节不能可靠证明原始编码，必须让用户核对预览
      return {
        text: decode('gb18030'),
        sourceEncoding: { encoding: 'gb18030', determinedBy: 'fallback' },
        warnings: [
          '文件不符合 UTF-8，已自动按 GB18030（兼容 GBK）读取，请核对正文，出现乱码时手动选择编码',
        ],
      };
    }
  } catch (cause) {
    const label = requested === 'auto' ? 'UTF-8 或 GB18030' : requested.toUpperCase();
    throw new ImportParseError(
      'INVALID_ENCODING',
      `文件包含无法按 ${label} 读取的字节，请选择正确编码或重新保存文件`,
      { cause },
    );
  }
}

/** 只预检分配预算，完整语法仍交给JSON.parse；字符串中的结构字符不参与计数 */
function preflightJson(source: string) {
  let quoted = false;
  let escaped = false;
  let depth = 0;
  let structures = 0;
  for (const character of source) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '[' || character === '{') {
      depth++;
      structures++;
    } else if (character === ']' || character === '}') {
      if (--depth < 0) throw new ImportParseError('INVALID_FORMAT', '文件语法不正确，请检查格式');
    } else if (character === ':' || character === ',') structures++;
    // 后续遍历以根深度0为基准，空容器最多允许33层；节点数仍由解析后精确复核
    if (depth > 33 || structures > 30000)
      throw new ImportParseError('IMPORT_TOO_COMPLEX', '导入内容层级或字段过多');
  }
}

/** 只做有界、无网络的语法解析；不宣称这就是平台原生文件格式。 */
export function parseImportDocument(bytes: Uint8Array, format: 'json' | 'toml'): unknown {
  return parseEncodedImportDocument(bytes, format, 'utf-8').document;
}

export function parseEncodedImportDocument(
  bytes: Uint8Array,
  format: 'json' | 'toml',
  encoding: ImportTextEncoding,
) {
  const decoded = decodeImportText(bytes, encoding);
  return { document: parseImportText(decoded.text, format), ...decoded };
}

function parseImportText(source: string, format: 'json' | 'toml'): unknown {
  if (format === 'json') preflightJson(source);
  let document: unknown;
  try {
    document = format === 'json' ? JSON.parse(source) : parse(source, { maxDepth: 32 });
  } catch (cause) {
    throw new ImportParseError('INVALID_FORMAT', '文件语法不正确，请检查格式', { cause });
  }
  const stack = [{ value: document, depth: 0 }];
  let entries = 0;
  while (stack.length) {
    const item = stack.pop();
    if (!item) break;
    if (++entries > 10_000 || item.depth > 32)
      throw new ImportParseError('IMPORT_TOO_COMPLEX', '导入内容层级或字段过多');
    if (typeof item.value !== 'object' || item.value === null) continue;
    for (const [key, value] of Object.entries(item.value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw new ImportParseError('UNSAFE_KEY', '导入包含不允许的字段名');
      stack.push({ value, depth: item.depth + 1 });
    }
  }
  return document;
}
