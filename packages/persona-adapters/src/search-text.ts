import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { ImportParseError } from './parser.js';

type TextNode = {
  type: string;
  value?: string | undefined;
  alt?: string | null | undefined;
  children?: TextNode[] | undefined;
};

/** 仅生成公开搜索投影；不改写作者Markdown，也不索引链接地址和原始HTML */
export function markdownSearchText(markdown: string) {
  if (Array.from(markdown).length > 30000)
    throw new ImportParseError('IMPORT_TOO_LARGE', 'README超过30000个字符');
  const tree = unified().use(remarkParse).parse(markdown);
  const pending: Array<TextNode | string> = [tree];
  const output: string[] = [];
  while (pending.length) {
    const node = pending.pop();
    if (typeof node === 'string') {
      output.push(node);
      continue;
    }
    if (!node || node.type === 'html' || node.type === 'definition') continue;
    if (node.type === 'image' || node.type === 'imageReference') {
      output.push(node.alt ?? '');
      continue;
    }
    if (['break', 'thematicBreak'].includes(node.type)) {
      output.push(' ');
      continue;
    }
    if (['paragraph', 'heading', 'listItem', 'blockquote', 'code'].includes(node.type))
      pending.push(' ');
    if (node.value !== undefined) output.push(node.value);
    else if (node.children)
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index];
        if (child) pending.push(child);
      }
  }
  return output.join('').replace(/\s+/gu, ' ').trim();
}
