import { describe, expect, it } from 'vitest';
import { inspectMarkdownImages, remapMarkdownImages } from '@personamarket/persona-adapters';
const oldKey = '3cabba2c-340d-4edb-8357-a1404f6f878a';
const newKey = '8c248fec-d511-4e8c-a1bf-a66a05c1e532';
const oldUrl = `asset://${oldKey}`;
const newUrl = `asset://${newKey}`;

describe('通用文件Markdown素材映射', () => {
  it('只改实际图片URL，保留代码、说明、标题、空白和换行原文', () => {
    const source = `# 标题  \r\n\r\n说明 ${oldUrl}\n\n![图](<${oldUrl}> "保留标题")\n\n\`${oldUrl}\`\n\n\`\`\`md\n![代码](${oldUrl})\n\`\`\`\n`;
    const expected = source.replace(`(<${oldUrl}>`, `(<${newUrl}>`);
    expect(remapMarkdownImages(source, new Map([[oldUrl, newUrl]]))).toBe(expected);
    expect(inspectMarkdownImages(source).urls).toEqual([oldUrl]);
  });
  it('内联、引用、折叠引用与简写引用使用CommonMark识别，重复定义采用首条', () => {
    const source = `![内联](${oldUrl})\n![引用][A]\n![A][]\n![A]\n\n[A]: <${oldUrl}>\n  "标题"\n[A]: https://example.org/unused.webp\n`;
    const result = remapMarkdownImages(source, new Map([[oldUrl, newUrl]]));
    expect(result).toBe(source.replaceAll(oldUrl, newUrl));
    expect(inspectMarkdownImages(source).urls).toEqual([oldUrl, oldUrl, oldUrl, oldUrl]);
    expect(result).toContain('[A]: https://example.org/unused.webp');
  });
  it('支持标签嵌套、转义和地址实体，替换后不会改变替代文本', () => {
    const source = `![嵌套 [标签] 和 \\] 括号](asset\\://<unused>)`;
    expect(remapMarkdownImages(source, new Map([[oldUrl, newUrl]]))).toBe(source);
    const escaped = `![嵌套 [标签] 和 \\] 括号](asset\\://${oldKey} "标题")`;
    expect(inspectMarkdownImages(escaped).urls).toEqual([oldUrl]);
    expect(remapMarkdownImages(escaped, new Map([[oldUrl, newUrl]]))).toBe(
      `![嵌套 [标签] 和 \\] 括号](${newUrl} "标题")`,
    );
    const entity = `![图](asset&#58;//${oldKey})`;
    expect(remapMarkdownImages(entity, new Map([[oldUrl, newUrl]]))).toBe(`![图](${newUrl})`);
  });
  it('未使用定义、普通链接与HTML不作为图片抓取，不发起网络请求', () => {
    const source = `[链接](${oldUrl})\n[x]: ${oldUrl}\n<img src="${oldUrl}">`;
    expect(inspectMarkdownImages(source).urls).toEqual([]);
    expect(remapMarkdownImages(source, new Map([[oldUrl, newUrl]]))).toBe(source);
  });
  it('替代文本中的代码括号不干扰真正地址位置', () => {
    const source = `![含代码 \`]\` 和文本](${oldUrl} "说明")`;
    expect(inspectMarkdownImages(source).urls).toEqual([oldUrl]);
    expect(remapMarkdownImages(source, new Map([[oldUrl, newUrl]]))).toBe(
      `![含代码 \`]\` 和文本](${newUrl} "说明")`,
    );
  });
  it('拒绝超过20张图片与不受控的映射目标', () => {
    expect(() => inspectMarkdownImages(`![图](${oldUrl})\n`.repeat(21))).toThrow();
    expect(() =>
      remapMarkdownImages(`![图](${oldUrl})`, new Map([[oldUrl, 'javascript:alert(1)']])),
    ).toThrow();
  });
});
