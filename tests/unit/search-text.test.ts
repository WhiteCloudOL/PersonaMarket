import { expect, it } from 'vitest';
import { markdownSearchText } from '@personamarket/persona-adapters';

it('搜索纯文本保留中文与代码，连接行内文本，排除地址、定义与原始HTML', () => {
  const markdown =
    '# 星**河**\n\n[读书会](https://private.invalid/hidden) ![月光](asset://hidden)\n\n' +
    '[unused]: https://private.invalid/unused\n\n<script>hidden-script</script>\n\n' +
    '```text\n原样 <code>\n```\n\n第一行\n第二行';
  expect(markdownSearchText(markdown)).toBe('星河 读书会 月光 原样 <code> 第一行 第二行');
  expect(markdown).toContain('https://private.invalid/hidden');
});
it('搜索投影有字符上限，嵌套引用和空文档可处理', () => {
  expect(markdownSearchText('')).toBe('');
  expect(markdownSearchText('> '.repeat(1000) + '深层中文')).toBe('深层中文');
  expect(() => markdownSearchText('星'.repeat(30001))).toThrow('README超过30000个字符');
});
