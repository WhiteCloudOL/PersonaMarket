import { getPublicSystemStatus } from '@personamarket/api-client';
import { PublicSystemStatusResponseSchema } from '@personamarket/contracts';
import { checkedResponse } from './auth-api';

export const publicSystemStatusKey = ['public', 'system-status'] as const;
export const publicSystemStatusQuery = {
  queryKey: publicSystemStatusKey,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    getPublicSystemStatus({
      cache: 'no-store',
      credentials: 'same-origin',
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    }).then((result) => checkedResponse(result, PublicSystemStatusResponseSchema)),
  retry: false as const,
  staleTime: 0,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
};
