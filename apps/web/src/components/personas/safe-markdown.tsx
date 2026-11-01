'use client';
import Markdown, { type Components, type ExtraProps } from 'react-markdown';
import { createElement, type ComponentProps } from 'react';
import Image from 'next/image';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';
import { IdSchema } from '@personamarket/contracts';
import { cn } from '@personamarket/ui/lib/utils';
const sectionHeadings: Components = {
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h3>{children}</h3>,
  pre: ({ children }) => (
    <pre
      role="region"
      tabIndex={0}
      aria-label="代码示例"
      className="focus-visible:outline-2 focus-visible:outline-ring"
    >
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <table
      tabIndex={0}
      aria-label="指南表格"
      className="focus-visible:outline-2 focus-visible:outline-ring"
    >
      {children}
    </table>
  ),
};
const validId = (url: string) => {
  const match = /^asset:\/\/([a-f0-9-]+)$/i.exec(url);
  const checked = IdSchema.safeParse(match?.[1]);
  return checked.success ? checked.data.toLowerCase() : null;
};
function anchoredHeadings(
  anchors: ReadonlyMap<number, string>,
  mode: 'document' | 'section',
): Components {
  const heading =
    (tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
    ({ node, children }: ComponentProps<'h1'> & ExtraProps) => {
      const id = anchors.get(node?.position?.start.offset ?? -1);
      const element = mode === 'section' && (tag === 'h1' || tag === 'h2') ? 'h3' : tag;
      return createElement(
        element,
        id
          ? {
              id,
              tabIndex: -1,
              className:
                'scroll-mt-40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring',
            }
          : {},
        children,
      );
    };
  return {
    h1: heading('h1'),
    h2: heading('h2'),
    h3: heading('h3'),
    h4: heading('h4'),
    h5: heading('h5'),
    h6: heading('h6'),
  };
}
function remarkAssets({ base }: { base: string }) {
  return (tree: Root) => {
    const definitions = new Map<string, string>();
    visit(tree, 'definition', (node) => {
      if (!definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    });
    const mapped = (url: string) => {
      const id = validId(url);
      return id ? base + '/' + id : '';
    };
    visit(tree, 'image', (node) => {
      node.url = mapped(node.url);
    });
    visit(tree, 'imageReference', (node, index, parent) => {
      if (parent && index !== undefined)
        parent.children[index] = {
          type: 'image',
          url: mapped(definitions.get(node.identifier) ?? ''),
          alt: node.alt ?? '',
        };
    });
  };
}
/** 编辑器、审核和公开页复用；图片在 Markdown AST 阶段仅映射到受控素材端点。 */
export function SafeMarkdown({
  text,
  imageBase = '/api/v1/me/assets',
  className,
  headingMode = 'document',
  headingAnchors,
}: {
  text: string;
  imageBase?: string;
  className?: string;
  headingMode?: 'document' | 'section';
  headingAnchors?: ReadonlyMap<number, string>;
}) {
  const importPreview = /^\/api\/v1\/me\/market-imports\/([a-f0-9-]{36})\/images$/.exec(imageBase);
  const base =
    /^\/api\/v1\/(?:me|public|moderation)\/assets$/.test(imageBase) ||
    (importPreview && IdSchema.safeParse(importPreview[1]).success)
      ? imageBase
      : '/api/v1/me/assets';
  return (
    <div
      className={cn(
        'min-w-0 space-y-4 break-words text-sm leading-7 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-inside [&_ul]:list-disc [&_ol]:list-inside [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2',
        className,
      )}
    >
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm, [remarkAssets, { base }]]}
        rehypePlugins={[rehypeSanitize]}
        urlTransform={(url, key) => {
          if (key === 'src')
            return url.startsWith(base + '/') &&
              IdSchema.safeParse(url.slice(base.length + 1)).success
              ? url
              : '';
          if (url.startsWith('#')) return url;
          try {
            const value = new URL(url);
            return ['http:', 'https:'].includes(value.protocol) &&
              !value.username &&
              !value.password
              ? value.href
              : '';
          } catch {
            return '';
          }
        }}
        components={{
          ...(headingMode === 'section' ? sectionHeadings : {}),
          ...(headingAnchors ? anchoredHeadings(headingAnchors, headingMode) : {}),
          a: ({ href, children }) =>
            href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer ugc"
                className="underline underline-offset-4"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ src, alt }) =>
            typeof src === 'string' && src.startsWith(base + '/') ? (
              <Image
                src={src}
                alt={alt ?? ''}
                width={800}
                height={600}
                loading="lazy"
                unoptimized
                className="h-auto max-w-full rounded-lg"
              />
            ) : (
              <span className="inline-block rounded-lg border border-dashed px-3 py-2 text-muted-foreground">
                外链图片需要先导入本站素材{alt ? ' · ' + alt : ''}
              </span>
            ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
