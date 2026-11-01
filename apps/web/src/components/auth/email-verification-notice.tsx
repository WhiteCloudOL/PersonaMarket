'use client';
import { useMutation } from '@tanstack/react-query';
import { resendVerification } from '@personamarket/api-client';
import { AuthNoticeResponseSchema } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { ApiError, authenticatedWriteFor, sessionRequestOptions } from '@/lib/auth-api';
import { requestAuthSessionRefresh } from '@/lib/auth-session-events';
import { FormNotice } from './auth-fields';

export function EmailVerificationNotice({
  accountId,
  email,
}: {
  accountId: string;
  email: string;
}) {
  const mutation = useMutation({
    mutationFn: () =>
      authenticatedWriteFor(
        accountId,
        (csrf) =>
          resendVerification({
            ...sessionRequestOptions,
            body: { email },
            params: { header: csrf },
            signal: AbortSignal.timeout(10000),
          }),
        AuthNoticeResponseSchema,
        {
          accountChanged: '登录账号已变化，请在当前账号重新申请验证邮件',
          verificationRequired: '请先完成登录验证，再申请邮件',
        },
      ).catch((cause: unknown) => {
        if (cause instanceof ApiError && ['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code))
          requestAuthSessionRefresh();
        throw cause;
      }),
    retry: false,
  });
  return (
    <div className="flex min-w-0 flex-col items-start gap-3" data-email-verification="pending">
      <p className="text-sm leading-7 text-muted-foreground">
        你可以先登录、浏览和编辑私有草稿；提交作品、公开互动等操作前仍需验证邮箱。按需发送时，请在这里主动申请。
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '正在申请…' : '申请验证邮件'}
      </Button>
      <FormNotice error={mutation.error} message={mutation.data?.data.message} />
    </div>
  );
}
