import {
  createPersonaContentSchema,
  textSchema,
  type PersonaContent,
  type ImportTextEncoding,
  type ImportSourceEncoding,
} from '@personamarket/contracts';
import { stringify } from 'smol-toml';
import { ImportParseError, parseEncodedImportDocument } from './parser.js';

// 适配器只承担部署级结构边界；可配置发布上限由应用层另行检查。
const nativeContent = createPersonaContentSchema({
  maibotField: 20_000,
  astrbotPrompt: 100_000,
  dialoguePairs: 100,
  dialogueMessage: 20_000,
});
type MaiBotPersona = Extract<PersonaContent, { platform: 'maibot' }>;
type AstrBotPersona = Extract<PersonaContent, { platform: 'astrbot' }>;
export type NativeImportResult = {
  persona: PersonaContent;
  ignoredFields: string[];
  warnings: string[];
  sourceEncoding?: ImportSourceEncoding;
};

export function nativeExportWarnings(persona: PersonaContent): string[] {
  if (persona.platform === 'maibot') return [];
  return [
    '目标 AstrBot 的原生导入器会采用自身工具与 Skills 默认设置，请在目标平台检查并限制能力',
    ...(persona.content.systemPrompt !== persona.content.systemPrompt.trim()
      ? ['目标 AstrBot 创建人格时会移除人格设定的首尾空白，请核对导入结果']
      : []),
  ];
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ImportParseError('INVALID_FORMAT', '原生文件必须是单个人设对象');
  return value as Record<string, unknown>;
}
function validate(input: unknown): PersonaContent {
  try {
    return nativeContent.parse(input);
  } catch (cause) {
    throw new ImportParseError('INVALID_FORMAT', '人设字段或对话格式不正确', { cause });
  }
}
function extras(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

export function serializeMaiBot(persona: MaiBotPersona): string {
  const checked = validate(persona);
  if (checked.platform !== 'maibot')
    throw new ImportParseError('INVALID_FORMAT', '需要 MaiBot 人设');
  return stringify(
    {
      personality: {
        personality: checked.content.personality,
        reply_style: checked.content.replyStyle,
        behavior_style: checked.content.behaviorStyle,
      },
    },
    { maxDepth: 4 },
  );
}
export function parseMaiBot(bytes: Uint8Array, encoding?: ImportTextEncoding): NativeImportResult {
  const parsed = parseEncodedImportDocument(bytes, 'toml', encoding ?? 'utf-8');
  const root = object(parsed.document);
  const fields = object(root['personality']);
  const ignoredFields = [
    ...extras(root, ['personality']),
    ...extras(fields, ['personality', 'reply_style', 'behavior_style']).map(
      (name) => `personality.${name}`,
    ),
  ];
  return {
    persona: validate({
      platform: 'maibot',
      content: {
        personality: fields['personality'],
        replyStyle: fields['reply_style'],
        behaviorStyle: fields['behavior_style'],
      },
    }),
    ignoredFields,
    warnings: [
      ...parsed.warnings,
      ...(ignoredFields.length ? ['仅保留人格设定、表达风格和行为风格，其他配置已忽略'] : []),
    ],
    ...(encoding ? { sourceEncoding: parsed.sourceEncoding } : {}),
  };
}
export function serializeAstrBot(persona: AstrBotPersona, personaId: string): string {
  const checked = validate(persona);
  if (checked.platform !== 'astrbot')
    throw new ImportParseError('INVALID_FORMAT', '需要 AstrBot 人设');
  return (
    JSON.stringify(
      {
        persona_id: textSchema(1, 100).parse(personaId),
        system_prompt: checked.content.systemPrompt,
        begin_dialogs: checked.content.dialoguePairs.flatMap(({ user, assistant }) => [
          user,
          assistant,
        ]),
      },
      null,
      2,
    ) + '\n'
  );
}
export function parseAstrBot(
  bytes: Uint8Array,
  createRowId: () => string,
  encoding?: ImportTextEncoding,
): NativeImportResult {
  const parsed = parseEncodedImportDocument(bytes, 'json', encoding ?? 'utf-8');
  const root = object(parsed.document);
  if ('schemaVersion' in root || 'format' in root)
    throw new ImportParseError('INVALID_FORMAT', '请使用 AstrBot 原生 JSON，而非本站通用文件');
  const dialogs = root['begin_dialogs'] ?? [];
  if (
    !Array.isArray(dialogs) ||
    dialogs.length % 2 !== 0 ||
    !dialogs.every((item: unknown) => typeof item === 'string')
  )
    throw new ImportParseError('INVALID_FORMAT', '预设对话必须是偶数条交替的用户与助手文本');
  const dialoguePairs = [];
  for (let index = 0; index < dialogs.length; index += 2)
    dialoguePairs.push({ id: createRowId(), user: dialogs[index], assistant: dialogs[index + 1] });
  return {
    persona: validate({
      platform: 'astrbot',
      content: { systemPrompt: root['system_prompt'], dialoguePairs },
    }),
    ignoredFields: extras(root, ['persona_id', 'system_prompt', 'begin_dialogs']),
    warnings: [
      ...parsed.warnings,
      '目标 AstrBot 的原生导入器会采用自身工具与 Skills 默认设置，请在目标平台检查并限制能力',
    ],
    ...(encoding ? { sourceEncoding: parsed.sourceEncoding } : {}),
  };
}
