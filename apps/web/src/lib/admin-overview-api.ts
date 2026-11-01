import { getAdminOverview } from '@personamarket/api-client';
import { AdminOverviewResponseSchema } from '@personamarket/contracts';
import { ApiError, checkedResponse, sessionRequestOptions } from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';

export async function readAdminOverview(accountId: string, signal: AbortSignal) {
  try {
    return checkedResponse(
      await getAdminOverview({
        ...sessionRequestOptions,
        headers: { 'X-Expected-Account': accountId },
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      }),
      AdminOverviewResponseSchema,
    );
  } catch (cause) {
    if (cause instanceof ApiError && ['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code))
      requestAuthSessionRefresh();
    throw cause;
  }
}
