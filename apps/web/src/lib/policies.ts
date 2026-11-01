import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getPublicPolicies, getPublicPolicy } from '@personamarket/api-client';
import {
  PolicyReadQuerySchema,
  PublicPoliciesResponseSchema,
  PublicPolicyResponseSchema,
  type PolicySlug,
} from '@personamarket/contracts';
import { trustedPublicHeaders } from './trusted-public-headers';
import { publicMetadata, defaultBrand } from './seo';
import { readPublicBrand } from './site-data';

export type PolicyPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function policyPublicationId(searchParams: PolicyPageProps['searchParams']) {
  const { publicationId } = await searchParams;
  const parsed = PolicyReadQuerySchema.safeParse(
    publicationId === undefined ? {} : { publicationId },
  );
  if (!parsed.success) notFound();
  return parsed.data.publicationId?.toLowerCase();
}

async function options() {
  return {
    baseUrl: process.env['API_INTERNAL_ORIGIN'] ?? 'http://127.0.0.1:3001',
    cache: 'no-store' as const,
    signal: AbortSignal.timeout(8000),
    headers:
      process.env['TRUST_PROXY_HOPS'] === '1'
        ? trustedPublicHeaders('1', (await headers()).get('x-forwarded-for'))
        : {},
  };
}

// 元数据和正文仅在本次服务端渲染共享；新访问始终核对当前已批准公开指针。
export const readPublicPolicy = cache(async (slug: PolicySlug, publicationId?: string) => {
  const input = PolicyReadQuerySchema.safeParse(
    publicationId === undefined ? {} : { publicationId },
  );
  if (!input.success) notFound();
  const result = await getPublicPolicy({
    ...(await options()),
    params: {
      path: { slug },
      ...(input.data.publicationId ? { query: { publicationId: input.data.publicationId } } : {}),
    },
  });
  if ([400, 404].includes(result.response.status)) notFound();
  if (!result.response.ok) throw new Error('公共规则暂时无法读取，请稍后重试');
  const item = PublicPolicyResponseSchema.parse(result.data).data;
  if (
    item.slug !== slug ||
    (input.data.publicationId && item.publicationId !== input.data.publicationId.toLowerCase())
  )
    throw new Error('公共规则版本暂时无法核对，请稍后重试');
  return item;
});

// 查询失败不能充当“没有公开规则”；站点地图据此明确返回不可用。
export const readPublicPolicies = cache(async () => {
  const result = await getPublicPolicies(await options());
  if (!result.response.ok) throw new Error('公共规则列表暂时无法读取，请稍后重试');
  return PublicPoliciesResponseSchema.parse(result.data).data;
});

export async function policyMetadata(slug: PolicySlug, publicationId?: string) {
  const [item, brand] = await Promise.all([
    readPublicPolicy(slug, publicationId),
    readPublicBrand(),
  ]);
  return publicMetadata({
    path: '/' + item.slug,
    title: item.title,
    description: item.summary || item.title,
    brand: brand?.data ?? defaultBrand,
    publishedTime: item.publishedAt,
  });
}
