import { PublicConfigResponseSchema, type PublicConfigResponse } from '@personamarket/contracts';
import { getPublicConfig } from './generated/operations.gen.js';

export * from './generated/operations.gen.js';
export async function fetchPublicConfig(
  baseUrl = '',
  signal?: AbortSignal,
): Promise<PublicConfigResponse> {
  const timeout = AbortSignal.timeout(5_000);
  try {
    const result = await getPublicConfig({
      baseUrl,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: 'no-store',
    });
    if (!result.data || result.error) throw new Error('PUBLIC_CONFIG_UNAVAILABLE');
    return PublicConfigResponseSchema.parse(result.data);
  } catch (cause) {
    throw new Error('暂时无法读取站点配置，请稍后重试', { cause });
  }
}
