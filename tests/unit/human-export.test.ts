import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { serializeReadableMarkdown, inspectMarkdownImages } from '@personamarket/persona-adapters';

describe('可读Markdown导出', () => {
  it('围栏长于作者反引号，保留空白与脚本字面文本', () => {
    const personality = '  第一行\n`````\n<script>只是正文</script>\n  ';
    const replyStyle = '![仅为正文](https://example.org/a.webp)';
    const output = serializeReadableMarkdown({
      platform: 'maibot',
      content: { personality, replyStyle, behaviorStyle: '保持边界' },
    });
    expect(output).toContain('``````text\n' + personality + '\n``````');
    expect(output).toContain(replyStyle);
    expect(inspectMarkdownImages(output).urls).toEqual([]);
  });
  it('AstrBot零对与多对对话均按顺序输出，不夹带内部ID', () => {
    const id = randomUUID();
    const systemPrompt = '  人格原文\n  ';
    const output = serializeReadableMarkdown({
      platform: 'astrbot',
      content: { systemPrompt, dialoguePairs: [{ id, user: '用户原文', assistant: 'AI原文' }] },
    });
    expect(output).toContain(systemPrompt);
    expect(output).toContain('预设对话 1 · 用户');
    expect(output.indexOf('用户原文')).toBeLessThan(output.indexOf('AI原文'));
    expect(output).not.toContain(id);
    expect(
      serializeReadableMarkdown({
        platform: 'astrbot',
        content: { systemPrompt, dialoguePairs: [] },
      }),
    ).not.toContain('预设对话');
  });
});
