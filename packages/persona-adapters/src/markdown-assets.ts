// 使用Markdown AST识别图片，只重映射地址，不重排作者原文
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import { parse, postprocess, preprocess } from 'micromark';
import { ImportParseError } from './parser.js';

type Span = { start: number; end: number; url: string };
type Destination = { start: number; end: number; definition: boolean };
function destination(
  tokens: readonly Destination[],
  start: number,
  end: number,
  definition: boolean,
) {
  // 外层图片地址在替代文本之后，内嵌链接不会被误当成外层图片地址
  const token = tokens.findLast(
    (item) => item.definition === definition && item.start >= start && item.end <= end,
  );
  if (!token) throw new ImportParseError('INVALID_FORMAT', 'Markdown图片地址无法映射');
  return { start: token.start, end: token.end };
}

export function inspectMarkdownImages(markdown: string) {
  if (Array.from(markdown).length > 30000)
    throw new ImportParseError('IMPORT_TOO_LARGE', 'README超过30000个字符');
  const destinations: Destination[] = [];
  // 使用同一CommonMark解析器的公开token位置，不手写括号/转义/代码/HTML的语法
  for (const [event, token] of postprocess(
    parse()
      .document()
      .write(preprocess()(markdown, undefined, true)),
  )) {
    if (
      event === 'enter' &&
      (token.type === 'resourceDestinationString' || token.type === 'definitionDestinationString')
    )
      destinations.push({
        start: token.start.offset,
        end: token.end.offset,
        definition: token.type === 'definitionDestinationString',
      });
  }
  const tree = unified().use(remarkParse).parse(markdown);
  const definitions = new Map<string, { url: string; start: number; end: number }>();
  const used = new Set<string>();
  const spans: Span[] = [];
  const urls: string[] = [];
  visit(tree, 'definition', (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined && !definitions.has(node.identifier))
      definitions.set(node.identifier, { url: node.url, start, end });
  });
  visit(tree, 'image', (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined)
      throw new ImportParseError('INVALID_FORMAT', 'Markdown图片位置不可用');
    urls.push(node.url);
    if (node.url) spans.push({ ...destination(destinations, start, end, false), url: node.url });
  });
  visit(tree, 'imageReference', (node) => {
    const match = definitions.get(node.identifier);
    if (match) {
      urls.push(match.url);
      used.add(node.identifier);
    }
  });
  for (const identifier of used) {
    const match = definitions.get(identifier);
    if (match?.url)
      spans.push({ ...destination(destinations, match.start, match.end, true), url: match.url });
  }
  if (urls.length > 20) throw new ImportParseError('INVALID_FORMAT', 'README最多引用20张图片');
  return { urls, spans };
}

export function remapMarkdownImages(markdown: string, replacements: ReadonlyMap<string, string>) {
  const { spans } = inspectMarkdownImages(markdown);
  let output = markdown;
  for (const span of spans.sort((left, right) => right.start - left.start)) {
    const next = replacements.get(span.url);
    if (next !== undefined) {
      if (!/^(asset:\/\/[a-f0-9-]{36}|assets\/[a-f0-9-]{36}\.(png|jpe?g|webp))$/.test(next))
        throw new ImportParseError('INVALID_FORMAT', '图片映射目标无效');
      output = output.slice(0, span.start) + next + output.slice(span.end);
    }
  }
  return output;
}
