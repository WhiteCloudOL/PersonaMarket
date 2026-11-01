import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import { IdSchema } from '@personamarket/contracts';
import { BusinessError } from './errors.js';
export function markdownImages(markdown: string) {
  const tree = unified().use(remarkParse).parse(markdown);
  const definitions = new Map<string, string>();
  visit(tree, 'definition', (node) => {
    if (!definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
  });
  const urls: string[] = [];
  visit(tree, 'image', (node) => {
    urls.push(node.url);
  });
  visit(tree, 'imageReference', (node) => {
    const url = definitions.get(node.identifier);
    if (url) urls.push(url);
  });
  const ids = new Set<string>();
  const external: string[] = [];
  for (const url of urls) {
    const match = /^asset:\/\/([a-f0-9-]+)$/i.exec(url);
    const id = IdSchema.safeParse(match?.[1]);
    if (id.success) ids.add(id.data.toLowerCase());
    else external.push(url);
  }
  return { ids: [...ids], external, count: urls.length };
}
export function assertReadmeImages(markdown: string, maximum = 20) {
  const images = markdownImages(markdown);
  if (images.count > 20) throw new BusinessError('INVALID_INPUT', 'README 最多引用 20 张图片');
  if (images.count > maximum)
    throw new BusinessError('VALIDATION_FAILED', 'README 图片数量超过当前上限，请调整后再送审', {
      fieldErrors: [{ path: 'readmeMarkdown', message: `当前最多引用 ${maximum} 张 README 图片` }],
    });
  if (images.external.length)
    throw new BusinessError('INVALID_INPUT', '请先将 README 外链图片导入本站素材，再提交发布');
  return images.ids;
}
