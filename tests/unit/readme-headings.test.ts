import { describe, expect, it } from 'vitest';
import { readmeHeadings } from '../../apps/web/src/lib/readme-headings.js';

const release = '3cabba2c-340d-4edb-8357-a1404f6f878a';
describe('公开README章节目录', () => {
  it('使用CommonMark识别ATX、Setext、嵌套标题并排除代码和HTML', () => {
    const text =
      '# 故事\r\n\r\n相处方式\r\n-------\r\n\r\n> ### 对话\r\n\r\n```md\r\n## 假标题\r\n```\r\n\r\n    # 缩进代码\r\n\r\n<h2>HTML标题</h2>\r\n';
    expect(readmeHeadings(text, release).map(({ title, depth }) => ({ title, depth }))).toEqual([
      { title: '故事', depth: 1 },
      { title: '相处方式', depth: 2 },
      { title: '对话', depth: 3 },
    ]);
    expect(text).toContain('\r\n');
  });
  it('重复标题和空白标题不会冲突，读取行内实际文本而不提取链接地址或HTML', () => {
    const text =
      '## 使用建议\n\n## 使用建议\n\n##\n\n# **温柔** [来信](https://example.invalid) `日常` ![图片](asset://bad) <i>你好</i>';
    const headings = readmeHeadings(text, release);
    expect(headings.map((item) => item.title)).toEqual([
      '使用建议',
      '使用建议',
      '温柔 来信 日常 图片 你好',
    ]);
    expect(new Set(headings.map((item) => item.id)).size).toBe(3);
    expect(headings.map((item) => text.slice(item.offset, item.offset + 1))).toEqual([
      '#',
      '#',
      '#',
    ]);
  });
  it('同版本同正文地址稳定，不同版本分离，标题不能造成DOM clobbering', () => {
    const text = '# __proto__\n\n## location\n';
    const first = readmeHeadings(text, release);
    expect(readmeHeadings(text, release)).toEqual(first);
    expect(first[0]?.id).toBe('pm-readme-' + release + '-0');
    expect(first[1]?.id).not.toBe('location');
    expect(readmeHeadings(text, '8c248fec-d511-4e8c-a1bf-a66a05c1e532')[0]?.id).not.toBe(
      first[0]?.id,
    );
  });
  it('空文和普通段落不生成虚构章节，非法文档身份拒绝进入锚点', () => {
    expect(readmeHeadings('', release)).toEqual([]);
    expect(readmeHeadings('只有正文，没有标题', release)).toEqual([]);
    expect(() => readmeHeadings('# 故事', 'location')).toThrow();
  });
  it('GFM行内标记和大量重复标题使用独立源位置，输入不被改写', () => {
    const text = '# ~~旧称~~ 新称\n\n' + '## 章节\n\n正文\n\n'.repeat(1000);
    const headings = readmeHeadings(text, release);
    expect(headings).toHaveLength(1001);
    expect(headings[0]?.title).toBe('旧称 新称');
    expect(new Set(headings.map((item) => item.id)).size).toBe(1001);
    expect(text.endsWith('## 章节\n\n正文\n\n')).toBe(true);
  });
});
