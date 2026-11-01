import { z } from 'zod';
import { DraftContentSchema } from './persona.js';
import { ImportPreviewRequestSchema } from './imports.js';
import {
  IMPORT_TEXT_MAX_BYTES,
  TextImportFormatSchema,
  ImportTextEncodingSchema,
  ImportSourceEncodingSchema,
} from './import-text.js';

export const TextImportFileQuerySchema = z.strictObject({
  format: TextImportFormatSchema,
  encoding: ImportTextEncodingSchema.default('auto'),
});
export const TextImportSourceResponseSchema = z.strictObject({
  data: z.strictObject({
    format: TextImportFormatSchema,
    filename: ImportPreviewRequestSchema.shape.filename,
    text: z.string().min(1).max(IMPORT_TEXT_MAX_BYTES),
    sourceEncoding: ImportSourceEncodingSchema,
    warnings: z.array(z.string().max(1000)).max(8),
  }),
});

// 复用草稿的部署级硬限；手动映射必须补齐选定平台的必需正文，不能猜拆或截断
export const MappedPersonaContentSchema = DraftContentSchema.superRefine((persona, context) => {
  const required = (value: string, path: (string | number)[]) => {
    if (!value.trim()) context.addIssue({ code: 'custom', path, message: '请填写并核对映射内容' });
    if (
      Array.from(value).some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code === 0 || (code >= 0xd800 && code <= 0xdfff);
      })
    )
      context.addIssue({
        code: 'custom',
        path,
        message: '映射内容包含空字符或不完整的 Unicode 字符，请重新选择完整文本',
      });
  };
  if (persona.platform === 'maibot') {
    for (const key of ['personality', 'replyStyle', 'behaviorStyle'] as const)
      required(persona.content[key], ['content', key]);
  } else {
    required(persona.content.systemPrompt, ['content', 'systemPrompt']);
    persona.content.dialoguePairs.forEach((pair, index) => {
      required(pair.user, ['content', 'dialoguePairs', index, 'user']);
      required(pair.assistant, ['content', 'dialoguePairs', index, 'assistant']);
    });
  }
});
export const TextMappedPreviewRequestSchema = z
  .strictObject({
    format: TextImportFormatSchema,
    filename: ImportPreviewRequestSchema.shape.filename,
    persona: MappedPersonaContentSchema,
    mapped: z.literal(true, { error: '请逐项核对字段映射后继续' }),
  })
  .refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= IMPORT_TEXT_MAX_BYTES,
    '映射后的请求超过 4 MiB，请减少内容后重试',
  );
