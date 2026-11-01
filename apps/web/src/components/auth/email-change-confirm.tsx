'use client';
import { HydratedForm } from './hydrated-form';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { securityApi } from '@/lib/security-api';
import { useMailToken, clearMailToken } from '@/lib/mail-token';
import { FormNotice, SubmitButton } from './auth-fields';
import { useAuthRefresh } from './use-auth-change';
export function EmailChangeConfirm() {
  const token = useMailToken();
  const refresh = useAuthRefresh();
  const mutation = useMutation({
    mutationFn: () => securityApi.confirmEmail(token),
    retry: false,
    onSuccess: async () => {
      clearMailToken();
      await refresh();
    },
  });
  return (
    <HydratedForm
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-sm text-muted-foreground">
        确认后使用新邮箱登录，所有设备的旧会话与安全链接都会失效
      </p>
      <FormNotice error={mutation.error} message={mutation.data?.data.message} />
      {mutation.isSuccess ? (
        <Link href="/login" className="underline">
          使用新邮箱登录
        </Link>
      ) : (
        <SubmitButton pending={mutation.isPending} disabled={!token}>
          确认新邮箱
        </SubmitButton>
      )}
    </HydratedForm>
  );
}
