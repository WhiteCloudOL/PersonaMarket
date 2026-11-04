'use client';
import { useId, useRef, useState } from 'react';
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
import { ApiError, authApi, authQuery, readAuthContext } from '@/lib/auth-api';
const VerificationSchema = z.discriminatedUnion('method', [
  MfaCodeRequestSchema.extend({ method: z.literal('mfa') }),
  ReauthenticateRequestSchema.extend({ method: z.literal('password') }),
]);
function VerifyOperation({ error }: { error: ApiError }) {
  const passwordRequired = error.code === 'REAUTH_REQUIRED';
  const field = passwordRequired ? 'currentPassword' : 'code';
  const id = useId();
  const feedback = useRef<HTMLDivElement>(null);
  const credential = useRef<HTMLInputElement>(null);
  const [completed, setCompleted] = useState<{ error: ApiError; verified: boolean }>();
  const current = completed?.error === error ? completed : undefined;
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
    gcTime: 0,
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
      mutation.reset();
      setCompleted({ error, verified: true });
    },
  });
  const registration = form.register(field);
  const validationError = form.getFieldState(field, form.formState).error;
  return (
    <>
      <div ref={feedback} tabIndex={-1}>
        {current && (
          <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
            <ShieldCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {current.verified
              ? '身份已确认，表单内容已保留，请重试刚才的操作'
              : '已取消身份验证，再次提交可重新验证'}
          </p>
        )}
      </div>
      <Sheet
        open={!current}
        onOpenChange={(open, details) => {
          if (open) return;
          if (mutation.isPending) {
            details.cancel();
            return;
          }
          form.reset();
          mutation.reset();
          setCompleted({ error, verified: false });
        }}
      >
        <SheetContent
          side="bottom"
          className="max-h-[calc(100dvh-1rem)] gap-0 rounded-t-2xl sm:inset-0 sm:m-auto sm:w-[min(28rem,90vw)] sm:rounded-2xl sm:border sm:data-[side=bottom]:h-fit"
          initialFocus={(type) => type === 'touch' || credential.current}
          finalFocus={feedback}
          showCloseButton={!mutation.isPending}
        >
          <SheetHeader>
            <SheetTitle>验证高危操作</SheetTitle>
            <SheetDescription>
              {passwordRequired
                ? '输入当前登录密码，确认后返回当前操作'
                : '输入身份验证器动态码或一次性恢复码，确认后返回当前操作'}
            </SheetDescription>
          </SheetHeader>
          <form
            className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            noValidate
            onSubmit={(event) => {
              event.stopPropagation();
              void form.handleSubmit((values) => mutation.mutate(values))(event);
            }}
          >
            <FieldGroup>
              <Field data-invalid={Boolean(validationError)}>
                <FieldLabel htmlFor={id}>
                  {passwordRequired ? '当前登录密码' : '动态验证码或恢复码'}
                </FieldLabel>
                <Input
                  id={id}
                  type={passwordRequired ? 'password' : 'text'}
                  autoComplete={passwordRequired ? 'current-password' : 'one-time-code'}
                  spellCheck={false}
                  data-sensitive={passwordRequired ? 'password' : 'mfa-code'}
                  {...registration}
                  ref={(element) => {
                    credential.current = element;
                    registration.ref(element);
                  }}
                  readOnly={mutation.isPending}
                  aria-invalid={Boolean(validationError)}
                  aria-describedby={validationError ? id + '-error' : undefined}
                />
                {validationError && (
                  <FieldError id={id + '-error'}>{validationError.message}</FieldError>
                )}
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
    </>
  );
}
export function needsOperationVerification(error: unknown): error is ApiError {
  return error instanceof ApiError && ['MFA_REQUIRED', 'REAUTH_REQUIRED'].includes(error.code);
}

export function StepUpPrompt({ error }: { error: Error | null | undefined }) {
  return needsOperationVerification(error) ? (
    <VerifyOperation key={error.code} error={error} />
  ) : null;
}
