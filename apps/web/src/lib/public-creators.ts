import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getCreator, listCreatorPersonas } from '@personamarket/api-client';
import {
  PublicCreatorResponseSchema,
  PublicPersonaListResponseSchema,
  type CreatorPersonasQuery,
} from '@personamarket/contracts';
const options = () => ({
  baseUrl: process.env['API_INTERNAL_ORIGIN'] ?? 'http://127.0.0.1:3001',
  cache: 'no-store' as const,
  signal: AbortSignal.timeout(8000),
});
export const readPublicCreator = cache(async (username: string) => {
  const result = await getCreator({ ...options(), params: { path: { username } } });
  if (result.response.status === 404 || result.response.status === 400) notFound();
  if (!result.response.ok) throw Error('暂时无法读取创作者资料，请稍后重试');
  return PublicCreatorResponseSchema.parse(result.data).data;
});
export async function readCreatorPersonas(username: string, query: CreatorPersonasQuery) {
  const { platform, ...filters } = query;
  const result = await listCreatorPersonas({
    ...options(),
    params: { path: { username }, query: { ...filters, ...(platform ? { platform } : {}) } },
  });
  if (result.response.status === 404) notFound();
  if (!result.response.ok) throw Error('暂时无法读取创作者作品，请稍后重试');
  return PublicPersonaListResponseSchema.parse(result.data);
}
