'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useForm, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  CreateAdminNoticeSchema,
  UsernameSchema,
  NotificationTitleSchema,
  NotificationMessageSchema,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldDescription,
} from '@personamarket/ui/components/field';
import { notificationsApi, notificationsKey } from '@/lib/notifications-api';
import { FormNotice, SubmitButton } from '../auth/auth-fields';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';

const schema = z.strictObject({
  username: UsernameSchema,
  title: NotificationTitleSchema,
  message: NotificationMessageSchema,
  confirmed: z.boolean().refine((value) => value, '请确认收件账号和通知内容'),
});
type Values = z.infer<typeof schema>;
type Recipient = { id: string; username: string };
type Nonce = { signature: string; key: string };
type Draft = { values: Values; recipient: Recipient | undefined; nonce: Nonce | undefined };
const initial = { username: '', title: '', message: '', confirmed: false };
const retainsNoticeDraft = (target: URL, current: URL) =>
  target.origin === current.origin && target.pathname === current.pathname;
export function NoticeForm({ accountId }: { accountId: string }) {
  const client = useQueryClient(),
    id = useId(),
    draftKey = useMemo(() => [...notificationsKey(accountId), 'notice-draft'], [accountId]);
  const [saved] = useState(() => client.getQueryData<Draft>(draftKey));
  const [recipient, setRecipient] = useState<Recipient | undefined>(saved?.recipient);
  const nonce = useRef<Nonce | undefined>(saved?.nonce),
    alive = useRef(true);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: saved?.values ?? initial,
  });
  const values = useWatch({ control: form.control });
  const lookup = useMutation({
    mutationFn: (username: string) => notificationsApi.recipient(accountId, username),
    retry: false,
    onSuccess: (result) => {
      if (
        alive.current &&
        result.data.username.toLowerCase() === form.getValues('username').toLowerCase()
      )
        setRecipient(result.data);
    },
  });
  const send = useMutation({
    mutationFn: async (input: Values) => {
      if (!recipient || recipient.username.toLowerCase() !== input.username.toLowerCase())
        throw new Error('请先查找并核对收件账号');
      const body = CreateAdminNoticeSchema.parse({
        recipientId: recipient.id,
        title: input.title,
        message: input.message,
        confirmed: input.confirmed,
      });
      const signature = JSON.stringify(body);
      if (!nonce.current || nonce.current.signature !== signature)
        nonce.current = { signature, key: crypto.randomUUID() };
      client.setQueryData(draftKey, {
        values: input,
        recipient,
        nonce: nonce.current,
      } satisfies Draft);
      return notificationsApi.create(accountId, body, nonce.current.key);
    },
    retry: false,
    onSuccess: () => {
      if (!alive.current) return;
      nonce.current = undefined;
      form.reset({ ...initial, username: form.getValues('username') });
      client.removeQueries({ queryKey: draftKey, exact: true });
      void client.invalidateQueries({ queryKey: [...notificationsKey(accountId), 'history'] });
    },
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    client.setQueryDefaults(draftKey, { gcTime: Infinity });
  }, [client, draftKey]);
  useEffect(() => {
    client.setQueryData(draftKey, {
      values: form.getValues(),
      recipient,
      nonce: nonce.current,
    } satisfies Draft);
  }, [client, draftKey, form, values, recipient]);
  const checkedRecipient =
    recipient?.username.toLowerCase() === values.username?.toLowerCase() ? recipient : undefined;
  useUnsavedDraft(
    Boolean(values.title || values.message || values.confirmed || send.isPending),
    '通知尚未创建，确定离开吗',
    retainsNoticeDraft,
  );
  const busy = send.isPending || lookup.isPending;
  return (
    <Card>
      <CardHeader>
        <CardTitle>写给一个账号</CardTitle>
        <CardDescription>按完整用户名查找收件人，确认后创建站内通知</CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={form.handleSubmit((input) => send.mutate(input))}>
          <FieldGroup>
            <Field data-invalid={Boolean(form.formState.errors.username)}>
              <FieldLabel htmlFor={id + '-username'}>收件用户名</FieldLabel>
              <div className="flex min-w-0 flex-wrap gap-2">
                <Input
                  {...form.register('username')}
                  id={id + '-username'}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  className="min-w-0 flex-1 basis-40"
                  aria-invalid={Boolean(form.formState.errors.username)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    const parsed = UsernameSchema.safeParse(form.getValues('username'));
                    if (!parsed.success) {
                      form.setError('username', {
                        message: parsed.error.issues[0]?.message ?? '请填写完整用户名',
                      });
                      return;
                    }
                    form.clearErrors('username');
                    setRecipient(undefined);
                    lookup.mutate(parsed.data);
                  }}
                >
                  查找收件人
                </Button>
              </div>
              <FieldError errors={[form.formState.errors.username]} />
              <FieldDescription>仅查找正常账号，不显示邮箱或其他私有资料</FieldDescription>
            </Field>
            <FormNotice error={lookup.error} />
            {checkedRecipient && (
              <p
                role="status"
                className="rounded-xl border bg-muted/40 p-3 text-sm [overflow-wrap:anywhere]"
              >
                已核对收件人：{checkedRecipient.username}
              </p>
            )}
            <Field data-invalid={Boolean(form.formState.errors.title)}>
              <FieldLabel htmlFor={id + '-title'}>通知标题</FieldLabel>
              <Input
                {...form.register('title')}
                id={id + '-title'}
                autoComplete="off"
                disabled={busy}
                aria-invalid={Boolean(form.formState.errors.title)}
              />
              <FieldError errors={[form.formState.errors.title]} />
              <FieldDescription>2–120 字，写清通知主题</FieldDescription>
            </Field>
            <Field data-invalid={Boolean(form.formState.errors.message)}>
              <FieldLabel htmlFor={id + '-message'}>通知内容</FieldLabel>
              <Textarea
                {...form.register('message')}
                id={id + '-message'}
                autoComplete="off"
                disabled={busy}
                className="max-h-[40dvh] min-h-36 resize-y overflow-y-auto [field-sizing:fixed]"
                aria-invalid={Boolean(form.formState.errors.message)}
              />
              <FieldError errors={[form.formState.errors.message]} />
              <FieldDescription>
                {Array.from(values.message ?? '').length} / 2000
                字，按纯文本发送，请勿填写密码或验证凭据
              </FieldDescription>
            </Field>
            <Controller
              control={form.control}
              name="confirmed"
              render={({ field }) => (
                <Field data-invalid={Boolean(form.formState.errors.confirmed)}>
                  <div className="flex min-h-11 items-start gap-3">
                    <Checkbox
                      id={id + '-confirm'}
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={busy}
                      aria-invalid={Boolean(form.formState.errors.confirmed)}
                      className="mt-3"
                    />
                    <FieldLabel
                      htmlFor={id + '-confirm'}
                      className="min-h-11 flex-1 py-2 leading-6"
                    >
                      我已核对收件账号和通知内容
                    </FieldLabel>
                  </div>
                  <FieldError errors={[form.formState.errors.confirmed]} />
                </Field>
              )}
            />
            <FormNotice
              error={send.error}
              message={
                send.isSuccess && !values.title && !values.message
                  ? '通知已创建，真实投递状态可在记录中查看'
                  : undefined
              }
            />
            <SubmitButton pending={send.isPending} disabled={!checkedRecipient || lookup.isPending}>
              创建通知
            </SubmitButton>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
