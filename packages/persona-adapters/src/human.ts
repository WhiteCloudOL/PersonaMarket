import {
  DraftContentSchema,
  MARKET_DOCUMENT_MAX_BYTES,
  type PersonaContent,
} from '@personamarket/contracts';
import { ImportParseError } from './parser.js';

function section(title: string, content: string) {
  let longest = 2;
  for (const match of content.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = '`'.repeat(longest + 1);
  return `## ${title}\n\n${fence}text\n${content}${content.endsWith('\n') ? '' : '\n'}${fence}\n`;
}

/** 人类阅读格式，正文置于足够长的代码围栏中，不把作者文本当HTML或额外结构执行 */
export function serializeReadableMarkdown(persona: PersonaContent) {
  const checked = DraftContentSchema.parse(persona);
  const parts =
    checked.platform === 'maibot'
      ? [
          section('人格设定', checked.content.personality),
          section('表达风格', checked.content.replyStyle),
          section('行为风格', checked.content.behaviorStyle),
        ]
      : [
          section('人格设定', checked.content.systemPrompt),
          ...checked.content.dialoguePairs.flatMap((pair, index) => [
            section(`预设对话 ${index + 1} · 用户`, pair.user),
            section(`预设对话 ${index + 1} · AI`, pair.assistant),
          ]),
        ];
  const output = parts.join('\n');
  if (new TextEncoder().encode(output).byteLength > MARKET_DOCUMENT_MAX_BYTES)
    throw new ImportParseError('IMPORT_TOO_LARGE', 'Markdown文件超过4MiB，请减少内容后重试');
  return output;
}
