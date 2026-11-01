'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheckIcon } from 'lucide-react';
import { MfaCodeRequestSchema, ReauthenticateRequestSchema } from '@personamarket/contracts';
import { z } from 'zod';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { Field, FieldGroup, FieldLabel, FieldError } from '@personamarket/ui/components/field';
import { Input } from '@personamarket/ui/components/input';
import { Button } from '@personamarket/ui/components/button';
import { Spinner } from '@personamarket/ui/components/spinner';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import { ApiError, authApi, authQuery, readAuthContext } from '@/lib/auth-api';
const VerificationSchema = z.discriminatedUnion('method', [
  MfaCodeRequestSchema.extend({ method: z.literal('mfa') }),
  ReauthenticateRequestSchema.extend({ method: z.literal('password') }),
]);
function VerifyOperation({ error }: { error: ApiError }) {
  const passwordRequired = error.code === 'REAUTH_REQUIRED';
  const field = passwordRequired ? 'currentPassword' : 'code';
  const [open, setOpen] = useState(false);
  const [verified, setVerified] = useState<Error>();
  const client = useQueryClient();
  const form = useForm<z.infer<typeof VerificationSchema>>({
    resolver: zodResolver(VerificationSchema),
    defaultValues: passwordRequired
      ? { method: 'password', currentPassword: '' }
      : { method: 'mfa', code: '' },
  });
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof VerificationSchema>) =>
      values.method === 'password'
        ? authApi.reauthenticate(values.currentPassword)
        : authApi.mfa(values.code),
    retry: false,
    onSuccess: async () => {
      const before = client.getQueryData<Awaited<ReturnType<typeof readAuthContext>>>(
        authQuery.queryKey,
      );
      const after = await readAuthContext();
      if (before?.data.account?.id !== after.data.account?.id) {
        await client.cancelQueries();
        client.removeQueries({ predicate: (query) => query.queryKey[0] === 'private' });
      }
      client.setQueryData(authQuery.queryKey, after);
      form.reset();
      setVerified(error);
      setOpen(false);
    },
  });
  return (
    <div className="flex flex-col items-start gap-3">
      <Alert aria-live="polite">
        <ShieldCheckIcon aria-hidden />
        <AlertTitle>{verified === error ? '身份已确认' : '确认本次高危操作'}</AlertTitle>
        <AlertDescription>
          {verified === error
            ? '身份已确认，表单内容已保留，请重试刚才的操作'
            : '完成身份验证后，可在此处继续操作，当前输入会保留'}
        </AlertDescription>
      </Alert>
      {verified !== error && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            mutation.reset();
            setOpen(true);
          }}
        >
          <ShieldCheckIcon aria-hidden />
          验证高危操作
        </Button>
      )}
      <Sheet
        open={open}
        onOpenChange={(v) => {
          if (!mutation.isPending) setOpen(v);
        }}
      >
        <SheetContent showCloseButton={!mutation.isPending}>
          <SheetHeader>
            <SheetTitle>验证高危操作</SheetTitle>
            <SheetDescription>
              {passwordRequired
                ? '输入当前登录密码，确认后返回当前操作'
                : '输入身份验证器动态码或一次性恢复码，确认后返回当前操作'}
            </SheetDescription>
          </SheetHeader>
          <form
            className="p-5"
            noValidate
            onSubmit={(event) => {
              event.stopPropagation();
              void form.handleSubmit((values) => mutation.mutate(values))(event);
            }}
          >
            <FieldGroup>
              <Field data-invalid={Boolean(form.getFieldState(field).error)}>
                <FieldLabel htmlFor="operation-verification">
                  {passwordRequired ? '当前登录密码' : '动态验证码或恢复码'}
                </FieldLabel>
                <Input
                  id="operation-verification"
                  type={passwordRequired ? 'password' : 'text'}
                  autoComplete={passwordRequired ? 'current-password' : 'one-time-code'}
                  spellCheck={false}
                  data-sensitive={passwordRequired ? 'password' : 'mfa-code'}
                  {...form.register(field)}
                  aria-invalid={Boolean(form.getFieldState(field).error)}
                />
                <FieldError>{form.getFieldState(field).error?.message}</FieldError>
              </Field>
              {mutation.error && (
                <p role="alert" className="text-sm text-destructive">
                  {mutation.error.message}
                </p>
              )}
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <Spinner className="motion-reduce:animate-none" />}
                {mutation.isPending ? '正在验证…' : '确认身份'}
              </Button>
            </FieldGroup>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
export function StepUpPrompt({ error }: { error: Error | null | undefined }) {
  return error instanceof ApiError && ['MFA_REQUIRED', 'REAUTH_REQUIRED'].includes(error.code) ? (
    <VerifyOperation key={error.code} error={error} />
  ) : null;
}
