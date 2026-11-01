// 通用文件适配只解析内容，不联网、不恢复外部身份
import {
  MARKET_DOCUMENT_MAX_BYTES,
  MarketPersonaSchema,
  type MarketPersona,
  type PersonaContent,
  type ImportTextEncoding,
} from '@personamarket/contracts';
import { ImportParseError, parseImportDocument, parseEncodedImportDocument } from './parser.js';
import { inspectMarkdownImages } from './markdown-assets.js';

export type MarketMedium = 'json' | 'zip';

/** 不联网；链接仍是不可信声明，须经独立确认与现有安全图片导入流程 */
export function validateMarketPersona(input: unknown, medium: MarketMedium): MarketPersona {
  const checked = MarketPersonaSchema.safeParse(input);
  if (!checked.success)
    throw new ImportParseError('INVALID_FORMAT', '通用人设文件结构或素材清单不正确');
  const document = checked.data;
  const targets = new Set<string>();
  const referenced = new Set<string>();
  for (const image of document.assets) {
    if (medium === 'zip') {
      if (!('path' in image))
        throw new ImportParseError('INVALID_FORMAT', '完整包只能使用包内素材');
      targets.add(image.path);
    } else {
      if (!('url' in image))
        throw new ImportParseError('INVALID_FORMAT', '通用JSON的图片应使用在线引用清单');
      targets.add(`asset://${image.key}`);
    }
  }
  for (const url of inspectMarkdownImages(document.metadata.readmeMarkdown).urls) {
    if (!targets.has(url))
      throw new ImportParseError('INVALID_FORMAT', 'README图片引用不在通用文件素材清单中');
    referenced.add(url);
  }
  for (const key of [document.metadata.avatarKey, document.metadata.coverKey]) {
    if (!key) continue;
    const image = document.assets.find((candidate) => candidate.key === key);
    if (!image) throw new ImportParseError('INVALID_FORMAT', '作品图片引用不在素材清单中');
    referenced.add('path' in image ? image.path : `asset://${image.key}`);
  }
  if (
    document.assets.some(
      (image) => !referenced.has('path' in image ? image.path : `asset://${image.key}`),
    )
  )
    throw new ImportParseError('INVALID_FORMAT', '素材清单包含作品未引用的文件');
  return document;
}

export function parseMarketPersona(bytes: Uint8Array, medium: MarketMedium) {
  return validateMarketPersona(parseImportDocument(bytes, 'json'), medium);
}

/** 独立上传的JSON可选择常见文本编码；ZIP包内文档仍遵守通用格式的UTF-8约定 */
export function parseMarketPersonaFile(bytes: Uint8Array, encoding: ImportTextEncoding) {
  const parsed = parseEncodedImportDocument(bytes, 'json', encoding);
  return {
    document: validateMarketPersona(parsed.document, 'json'),
    sourceEncoding: parsed.sourceEncoding,
    warnings: parsed.warnings,
  };
}

export function serializeMarketPersona(input: MarketPersona, medium: MarketMedium) {
  const document = validateMarketPersona(input, medium);
  const output = JSON.stringify(document, null, 2) + '\n';
  if (new TextEncoder().encode(output).byteLength > MARKET_DOCUMENT_MAX_BYTES)
    throw new ImportParseError('IMPORT_TOO_LARGE', '通用人设文件超过4MiB，请减少内容后重试');
  return output;
}

export function marketPersonaContent(
  document: MarketPersona,
  createRowId: () => string,
): PersonaContent {
  return document.platform === 'maibot'
    ? { platform: 'maibot', content: structuredClone(document.content) }
    : {
        platform: 'astrbot',
        content: {
          systemPrompt: document.content.systemPrompt,
          dialoguePairs: document.content.dialoguePairs.map((pair) => ({
            ...pair,
            id: createRowId(),
          })),
        },
      };
}
