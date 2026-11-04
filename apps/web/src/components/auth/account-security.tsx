'use client';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ConfirmEmailChangeCodeSchema,
  ChangePasswordRequestSchema,
  DeactivationRequestSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { cn } from '@personamarket/ui/lib/utils';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Badge } from '@personamarket/ui/components/badge';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from '@personamarket/ui/components/field';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import { authQuery } from '@/lib/auth-api';
import { securityApi } from '@/lib/security-api';
import { AuthField, FormNotice, SubmitButton } from './auth-fields';
import { EmailCodeField } from './email-code-field';
import { useAuthChange } from './use-auth-change';
const submitLayout = 'h-auto min-h-11 whitespace-normal px-2 py-2';
function PasswordForm() {
  const changed = useAuthChange();
  const form = useForm<z.infer<typeof ChangePasswordRequestSchema>>({
    resolver: zodResolver(ChangePasswordRequestSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const mutation = useMutation({
    mutationFn: () => securityApi.password(ChangePasswordRequestSchema.parse(form.getValues())),
    gcTime: 0,
    retry: false,
    onSuccess: async () => {
      form.reset();
      await changed('/login?notice=password-changed', 'logout');
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>修改登录密码</h2>
        </CardTitle>
        <CardDescription>更新密码后，全部设备和旧安全链接都会失效</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          aria-label="修改登录密码"
          onSubmit={form.handleSubmit(() => mutation.mutate())}
          className="flex flex-col gap-4"
        >
          <FieldSet disabled={mutation.isPending}>
            <FieldGroup>
              <AuthField
                id="change-current-password"
                label="当前密码"
                type="password"
                autoComplete="current-password"
                {...form.register('currentPassword')}
                error={form.formState.errors.currentPassword?.message}
              />
              <AuthField
                id="change-new-password"
                label="新密码"
                type="password"
                autoComplete="new-password"
                description="12 至 64 个字符，使用独特长口令，避免常见密码与账号信息"
                {...form.register('newPassword')}
                error={form.formState.errors.newPassword?.message}
              />
            </FieldGroup>
          </FieldSet>
          <FormNotice error={mutation.error} />
          <SubmitButton pending={mutation.isPending} className={submitLayout}>
            更新登录密码
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
function EmailForm({ email }: { email: string }) {
  const changed = useAuthChange();
  const form = useForm<z.infer<typeof ConfirmEmailChangeCodeSchema>>({
    resolver: zodResolver(ConfirmEmailChangeCodeSchema),
    defaultValues: { currentPassword: '', email: '', code: '' },
  });
  const send = useMutation({
    mutationFn: securityApi.email,
    gcTime: 0,
    retry: false,
    onSuccess: () => {
      form.setValue('code', '');
      form.setFocus('code');
    },
  });
  const mutation = useMutation({
    mutationFn: securityApi.confirmEmailCode,
    gcTime: 0,
    retry: false,
    onSuccess: async () => {
      form.reset();
      await changed('/login?notice=email-changed', 'logout');
    },
  });
  async function requestCode() {
    if (await form.trigger(['currentPassword', 'email'])) {
      const { currentPassword, email: target } = form.getValues();
      send.mutate({ currentPassword, email: target.trim().toLowerCase() });
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>变更联系邮箱</h2>
        </CardTitle>
        <CardDescription>新邮箱收到 6 位验证码后，请在 10 分钟内确认换绑</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="break-all text-sm">当前邮箱：{email}</p>
        <form
          noValidate
          aria-label="变更联系邮箱"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          className="flex flex-col gap-4"
        >
          <FieldGroup>
            <AuthField
              id="email-current-password"
              disabled={mutation.isPending}
              label="当前密码"
              type="password"
              autoComplete="current-password"
              {...form.register('currentPassword')}
              error={form.formState.errors.currentPassword?.message}
            />
            <AuthField
              id="change-email"
              disabled={mutation.isPending}
              label="新邮箱"
              type="email"
              autoComplete="email"
              readOnly={send.isPending}
              {...form.register('email', {
                onChange: () => {
                  send.reset();
                  form.setValue('code', '');
                },
              })}
              error={form.formState.errors.email?.message}
            />
            <EmailCodeField
              id="change-email-code"
              disabled={mutation.isPending}
              field={form.register('code')}
              error={form.formState.errors.code?.message}
              sending={send.isPending}
              sent={send.isSuccess}
              onSend={() => void requestCode()}
            />
          </FieldGroup>
          <FormNotice error={mutation.error ?? send.error} message={send.data?.data.message} />
          <SubmitButton
            pending={mutation.isPending}
            disabled={send.isPending}
            className={submitLayout}
          >
            确认换绑邮箱
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
const deactivationKey = ['private', 'security', 'deactivation'] as const;
function DeactivationPanel() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: deactivationKey,
    queryFn: securityApi.deactivation,
    retry: false,
  });
  const form = useForm<z.infer<typeof DeactivationRequestSchema>>({
    resolver: zodResolver(DeactivationRequestSchema),
    defaultValues: { currentPassword: '', reason: '' },
  });
  const submit = useMutation({
    mutationFn: () =>
      securityApi.requestDeactivation(DeactivationRequestSchema.parse(form.getValues())),
    gcTime: 0,
    retry: false,
    onSuccess: async () => {
      form.reset();
      await client.invalidateQueries({ queryKey: deactivationKey });
    },
  });
  const withdraw = useMutation({
    mutationFn: securityApi.withdraw,
    retry: false,
    onSuccess: () => client.invalidateQueries({ queryKey: deactivationKey }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>账号停用申请</h2>
        </CardTitle>
        <CardDescription>申请等待管理员处理，处理前账号保持可用，也可以撤回</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {query.isPending ? (
          <p role="status">正在读取申请状态…</p>
        ) : query.isError ? (
          <>
            <FormNotice error={query.error.message} />
            <Button onClick={() => void query.refetch()}>重试申请状态</Button>
          </>
        ) : query.data.data.request?.status === 'pending' ? (
          <>
            <Badge variant="secondary">申请待处理</Badge>
            <p className="whitespace-pre-wrap break-words text-sm">
              {query.data.data.request.reason}
            </p>
            <Button
              variant="outline"
              disabled={withdraw.isPending}
              onClick={() => withdraw.mutate()}
            >
              撤回停用申请
            </Button>
          </>
        ) : (
          <form
            noValidate
            aria-label="账号停用申请"
            onSubmit={form.handleSubmit(() => submit.mutate())}
            className="flex flex-col gap-4"
          >
            {query.data.data.request?.status === 'withdrawn' && (
              <p role="status" className="text-sm text-muted-foreground">
                上一份申请已撤回
              </p>
            )}
            <FieldSet disabled={submit.isPending}>
              <FieldGroup>
                <AuthField
                  id="deactivation-password"
                  label="当前密码"
                  type="password"
                  autoComplete="current-password"
                  {...form.register('currentPassword')}
                  error={form.formState.errors.currentPassword?.message}
                />
                <Field data-invalid={Boolean(form.formState.errors.reason)}>
                  <FieldLabel htmlFor="deactivation-reason">申请原因</FieldLabel>
                  <Textarea
                    id="deactivation-reason"
                    aria-invalid={Boolean(form.formState.errors.reason)}
                    aria-describedby="deactivation-reason-help"
                    {...form.register('reason')}
                  />
                  <FieldDescription id="deactivation-reason-help">
                    简单说明原因，最多 500 个字符
                  </FieldDescription>
                  <FieldError errors={[form.formState.errors.reason]} />
                </Field>
                <AuthField
                  id="deactivation-confirmation"
                  label="确认申请"
                  description="输入「申请停用」以确认提交"
                  autoComplete="off"
                  {...form.register('confirmation')}
                  error={form.formState.errors.confirmation?.message}
                />
              </FieldGroup>
            </FieldSet>
            <SubmitButton pending={submit.isPending} variant="destructive" className={submitLayout}>
              提交停用申请
            </SubmitButton>
          </form>
        )}
        <FormNotice
          error={submit.error?.message ?? withdraw.error?.message}
          message={withdraw.data?.data.message}
        />
      </CardContent>
    </Card>
  );
}
export function AccountSecurity() {
  const query = useQuery(authQuery);
  if (query.isPending) return <p role="status">正在读取账号安全信息…</p>;
  if (query.isError)
    return (
      <div className="flex flex-col gap-3">
        <FormNotice error="无法读取账号，请重试" />
        <Button onClick={() => void query.refetch()}>重试账号状态</Button>
      </div>
    );
  if (!query.data.data.account)
    return (
      <Link href="/login" className="underline">
        登录后管理账号安全
      </Link>
    );
  if (query.data.data.assurance !== 'authenticated')
    return (
      <Link href="/mfa" className="underline">
        完成二次验证后继续
      </Link>
    );
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        敏感操作会校验当前密码，已开启二次验证的账号还需要近期验证身份
      </p>
      <Link
        href="/account?tab=mfa"
        className={cn(
          buttonVariants({ variant: 'link' }),
          'h-auto min-h-11 w-fit max-w-full justify-start whitespace-normal px-0 py-2 text-left underline',
        )}
      >
        重新验证二次身份
      </Link>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <PasswordForm />
        <EmailForm email={query.data.data.account.email} />
      </div>
      <DeactivationPanel />
    </div>
  );
}
