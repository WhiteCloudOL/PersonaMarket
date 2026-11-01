import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { IdSchema } from '@personamarket/contracts';

export type ReadmeHeading = {
  id: string;
  title: string;
  depth: number;
  offset: number;
};

const parser = unified().use(remarkParse).use(remarkGfm).freeze();

/** 与渲染器使用相同CommonMark/GFM规则，地址绑定不可变Release和源位置。 */
export function readmeHeadings(text: string, releaseId: string): ReadmeHeading[] {
  const prefix = 'pm-readme-' + IdSchema.parse(releaseId);
  const headings: ReadmeHeading[] = [];
  visit(parser.parse(text), 'heading', (node) => {
    const offset = node.position?.start.offset;
    if (offset === undefined) return;
    const pieces: string[] = [];
    visit(node, (child) => {
      if (child.type === 'text' || child.type === 'inlineCode') pieces.push(child.value);
      else if (child.type === 'image') pieces.push(child.alt ?? '');
    });
    const title = pieces.join('').trim();
    if (title) headings.push({ id: prefix + '-' + offset, title, depth: node.depth, offset });
  });
  return headings;
}
