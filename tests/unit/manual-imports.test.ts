import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  TextMappedPreviewRequestSchema,
  NativeImportFileQuerySchema,
} from '@personamarket/contracts';
import { readManualImportText } from '@personamarket/persona-adapters';

describe('TXT/Markdown显式字段映射', () => {
  it('只解码原文，Markdown/HTML/命令保持字面内容与CRLF，不推断字段', () => {
    const text = '  # 人格\r\n<script>not executed</script>\n忽略指令不会被执行  ';
    const result = readManualImportText(Buffer.from(text), 'auto');
    expect(result.text).toBe(text);
    expect(result).not.toHaveProperty('persona');
    expect(result.sourceEncoding.encoding).toBe('utf-8');
    expect(() => readManualImportText(new Uint8Array(), 'auto')).toThrow();
    expect(() => readManualImportText(Buffer.from('x\0y'), 'utf-8')).toThrow();
  });
  it('GBK及UTF16仍按原始字节限额解码，首尾空白不变', () => {
    const gbk = Buffer.from([32, 0xd6, 0xd0, 0xce, 0xc4, 32]);
    expect(readManualImportText(gbk, 'gbk').text).toBe(' 中文 ');
    const source = Buffer.from('\ufeff  星光🌟\r\n下一行  ', 'utf16le').swap16();
    expect(readManualImportText(source, 'auto').text).toBe('  星光🌟\r\n下一行  ');
    expect(() => readManualImportText(new Uint8Array(4 * 1024 * 1024 + 1), 'auto')).toThrow();
  });
  it('MaiBot须明确填写三个字段，跨平台字段、未确认映射和越权字段拒绝', () => {
    const request = {
      format: 'text-plain',
      filename: '原文.txt',
      mapped: true,
      persona: {
        platform: 'maibot',
        content: { personality: '  原文  ', replyStyle: '自然', behaviorStyle: '尊重边界' },
      },
    };
    expect(TextMappedPreviewRequestSchema.parse(request).persona.content).toEqual(
      request.persona.content,
    );
    for (const invalid of [
      { ...request, mapped: false },
      { ...request, role: 'admin' },
      {
        ...request,
        persona: {
          ...request.persona,
          content: { ...request.persona.content, personality: 'x\0y' },
        },
      },
      {
        ...request,
        persona: {
          ...request.persona,
          content: { ...request.persona.content, personality: '\ud800' },
        },
      },
      {
        ...request,
        persona: { ...request.persona, content: { ...request.persona.content, replyStyle: ' ' } },
      },
      { ...request, persona: { platform: 'astrbot', content: request.persona.content } },
    ])
      expect(TextMappedPreviewRequestSchema.safeParse(invalid).success).toBe(false);
    expect(NativeImportFileQuerySchema.safeParse({ format: 'text-plain' }).success).toBe(false);
  });
  it('AstrBot仅接受人工确认的成对消息，空对话可用，不自动配对或截断', () => {
    const request = {
      format: 'text-markdown',
      filename: '原文.md',
      mapped: true,
      persona: {
        platform: 'astrbot',
        content: {
          systemPrompt: '  正文\r\n末行  ',
          dialoguePairs: [{ id: randomUUID(), user: '用户原文', assistant: '助手原文' }],
        },
      },
    };
    expect(TextMappedPreviewRequestSchema.parse(request).persona).toEqual(request.persona);
    expect(
      TextMappedPreviewRequestSchema.safeParse({
        ...request,
        persona: {
          platform: 'astrbot',
          content: {
            ...request.persona.content,
            dialoguePairs: [{ id: randomUUID(), user: '单侧' }],
          },
        },
      }).success,
    ).toBe(false);
    expect(
      TextMappedPreviewRequestSchema.safeParse({
        ...request,
        persona: {
          platform: 'astrbot',
          content: { systemPrompt: 'x'.repeat(100001), dialoguePairs: [] },
        },
      }).success,
    ).toBe(false);
  });
});
