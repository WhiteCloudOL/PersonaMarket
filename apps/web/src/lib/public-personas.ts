import {
  getPublicPersona,
  getPublicRelease,
  getPublicReleaseHistory,
  listPublicPersonas,
  getPublicPersonaFilters,
  getPublicStatistics,
} from '@personamarket/api-client';
import {
  PublicReleaseResponseSchema,
  PublicReleaseListResponseSchema,
  PublicPersonaListResponseSchema,
  PublicFacetsResponseSchema,
  PublicStatisticsResponseSchema,
  type PublicPersonaQuery,
} from '@personamarket/contracts';
import { notFound } from 'next/navigation';
import { cache } from 'react';
const options = () => ({
  baseUrl: process.env['API_INTERNAL_ORIGIN'] ?? 'http://127.0.0.1:3001',
  cache: 'no-store' as const,
  signal: AbortSignal.timeout(8000),
});
// 超时signal关闭fetch的默认请求合并；只在本次RSC渲染内复用元数据与正文读取
export const readPublicPersona = cache(async (id: string, releaseId?: string) => {
  const result = releaseId
    ? await getPublicRelease({ ...options(), params: { path: { id, releaseId } } })
    : await getPublicPersona({ ...options(), params: { path: { id } } });
  if (result.response.status === 404 || result.response.status === 400) notFound();
  if (!result.response.ok) throw new Error('暂时无法读取作品，请稍后重试');
  return PublicReleaseResponseSchema.parse(result.data).data;
});
export async function readPublicHistory(id: string, page = 1) {
  const result = await getPublicReleaseHistory({
    ...options(),
    params: { path: { id }, query: { page } },
  });
  if (!result.response.ok) return null;
  return PublicReleaseListResponseSchema.parse(result.data).data;
}
export async function readPublicPersonas(input: Partial<PublicPersonaQuery> = {}) {
  try {
    const result = await listPublicPersonas({
      ...options(),
      params: {
        query: {
          page: input.page ?? 1,
          pageSize: input.pageSize ?? 12,
          q: input.q ?? '',
          sort: input.sort ?? 'newest',
          ...(input.platform ? { platform: input.platform } : {}),
          ...(input.categoryId ? { categoryId: input.categoryId } : {}),
          ...(input.tagId ? { tagId: input.tagId } : {}),
          ...(input.tagIds ? { tagIds: input.tagIds } : {}),
          ...(input.hasDialogue ? { hasDialogue: input.hasDialogue } : {}),
          ...(input.featured ? { featured: input.featured } : {}),
          ...(input.publishedWithin ? { publishedWithin: input.publishedWithin } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.origin ? { origin: input.origin } : {}),
          ...(input.redistribution ? { redistribution: input.redistribution } : {}),
        },
      },
    });
    if (!result.response.ok) return null;
    return PublicPersonaListResponseSchema.parse(result.data);
  } catch {
    return null;
  }
}
export async function readPublicFacets() {
  try {
    const result = await getPublicPersonaFilters(options());
    return result.response.ok ? PublicFacetsResponseSchema.parse(result.data).data : null;
  } catch {
    return null;
  }
}
export async function readPublicStatistics() {
  try {
    const result = await getPublicStatistics(options());
    return result.response.ok ? PublicStatisticsResponseSchema.parse(result.data) : null;
  } catch {
    return null;
  }
}
