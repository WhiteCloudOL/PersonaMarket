'use client';
import { useQuery } from '@tanstack/react-query';
import { getOwnSubmissionPendingHint } from '@personamarket/api-client';
import { SubmissionPendingHintResponseSchema } from '@personamarket/contracts';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import { ApiError, checkedResponse, sessionRequestOptions } from '@/lib/auth-api';
import { requestAuthSessionRefresh } from '@/lib/auth-session-events';
import { FormNotice } from '../auth/auth-fields';

export function PendingSubmissionHint({
  personaId,
  submissionId,
  onStatusChanged,
}: {
  personaId: string;
  submissionId: string;
  onStatusChanged?: () => void;
}) {
  const query = useQuery({
    queryKey: ['private', 'submission-pending-hint', submissionId],
    queryFn: ({ signal }) =>
      getOwnSubmissionPendingHint({
        ...sessionRequestOptions,
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        params: { path: { id: submissionId } },
      })
        .then((result) => checkedResponse(result, SubmissionPendingHintResponseSchema))
        .catch((cause: unknown) => {
          if (cause instanceof ApiError && ['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code))
            requestAuthSessionRefresh();
          throw cause;
        }),
    staleTime: 0,
    retry: false,
  });
  // 读取失败时不沿用缓存中的旧提示；404表示状态已处理或资源不再可访问。
  if (query.isError) {
    const ended = query.error instanceof ApiError && query.error.code === 'NOT_FOUND';
    return (
      <div
        className="flex min-w-0 flex-col items-start gap-3"
        data-pending-hint-state={ended ? 'ended' : 'error'}
      >
        {ended ? (
          <p role="status" className="text-sm text-muted-foreground">
            审核状态有更新，请重新读取发布记录
          </p>
        ) : (
          <FormNotice error={query.error} />
        )}
        {ended ? (
          <div className="flex flex-wrap gap-3">
            {/* 审核结束后即使目标地址相同，也需重新读取列表，不能沿用路由中的旧待审缓存 */}
            <a
              href={'/dashboard/personas/' + personaId + '/releases?submission=' + submissionId}
              className={buttonVariants({ variant: 'outline' })}
            >
              查看发布记录
            </a>
            {onStatusChanged && (
              <Button type="button" variant="ghost" onClick={onStatusChanged}>
                刷新当前列表
              </Button>
            )}
          </div>
        ) : (
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            重新读取待审提示
          </Button>
        )}
      </div>
    );
  }
  if (!query.data || query.isFetching)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        正在读取待审提示…
      </p>
    );
  if (query.data.data.submissionId !== submissionId || query.data.data.pendingHint === '')
    return null;
  return (
    <Alert
      data-pending-submission-hint={submissionId}
      data-settings-revision={query.data.meta.settingsRevision}
    >
      <AlertTitle>待审提示</AlertTitle>
      <AlertDescription className="whitespace-pre-wrap [overflow-wrap:anywhere]">
        {query.data.data.pendingHint}
      </AlertDescription>
    </Alert>
  );
}
