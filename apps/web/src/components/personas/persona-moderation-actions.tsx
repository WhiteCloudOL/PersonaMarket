'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  PersonaModerationSchema,
  canonicalJson,
  type AdminPersonaSummarySchema,
  type AuthContextResponse,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { Field, FieldLabel, FieldError, FieldGroup } from '@personamarket/ui/components/field';
import { Textarea } from '@personamarket/ui/components/textarea';
import { FormNotice, SubmitButton } from '../auth/auth-fields';
import { authQuery } from '@/lib/auth-api';
import { releasesApi } from '@/lib/releases-api';

const reasonSchema = PersonaModerationSchema.pick({ reason: true });
type State = z.infer<typeof PersonaModerationSchema>['state'];
type Intent = { nonce: string; state: State };
type Frozen = { nonce: string; data: z.infer<typeof AdminPersonaSummarySchema> };

export function PersonaModerationActions({
  id,
  accountId,
  onSuccess,
}: {
  id: string;
  accountId: string;
  onSuccess: () => void;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [frozen, setFrozen] = useState<Frozen | null>(null);
  const active = useRef(true);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const request = useRef<{ signature: string; key: string } | null>(null);
  const form = useForm<z.infer<typeof reasonSchema>>({
    resolver: zodResolver(reasonSchema),
    defaultValues: { reason: '' },
  });
  const key = ['private', 'persona-moderation', accountId, id, intent?.nonce ?? 'closed'];
  const context = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => releasesApi.moderationContext(id, accountId, signal),
    enabled: open && Boolean(intent),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  // 只为一次打开捕获快照；验证身份引起的查询缓存重建不能悄悄推进待确认修订号
  if (open && intent && context.data && frozen?.nonce !== intent.nonce)
    setFrozen({ nonce: intent.nonce, data: structuredClone(context.data.data) });
  const snapshot = frozen && frozen.nonce === intent?.nonce ? frozen.data : null;
  const currentActor = () => {
    const current = client.getQueryData<AuthContextResponse>(authQuery.queryKey)?.data;
    return (
      active.current &&
      current?.account?.id === accountId &&
      current.account.role === 'admin' &&
      current.assurance === 'authenticated'
    );
  };
  const mutation = useMutation({
    mutationFn: () => {
      if (!intent || !snapshot) throw new Error('请先读取并核对人设状态');
      const body = {
        state: intent.state,
        reason: form.getValues('reason'),
        expectedRevision: snapshot.revision,
      };
      const signature = canonicalJson({ id, accountId, ...body });
      const previous = request.current;
      const operation =
        previous?.signature === signature ? previous : { signature, key: crypto.randomUUID() };
      request.current = operation;
      return releasesApi.moderate(id, body, operation.key, accountId);
    },
    onSuccess: () => {
      if (currentActor()) {
        setOpen(false);
        onSuccess();
      }
    },
    retry: false,
  });
  const begin = (state: State) => {
    mutation.reset();
    form.reset();
    request.current = null;
    setFrozen(null);
    setIntent({ nonce: crypto.randomUUID(), state });
    setOpen(true);
  };
  const reload = async () => {
    const nonce = intent?.nonce;
    const result = await context.refetch();
    const data = result.data?.data;
    if (!nonce || !data || result.isError || !currentActor()) return;
    setFrozen((previous) =>
      previous?.nonce === nonce ? { nonce, data: structuredClone(data) } : previous,
    );
    mutation.reset();
  };
  const label = intent?.state === 'normal' ? '解除作品封禁' : '封禁作品';
  const reasonId = 'persona-moderation-reason-' + id;
  return (
    <>
      <Button type="button" variant="destructive" onClick={() => begin('blocked')}>
        封禁作品
      </Button>
      <Button type="button" variant="outline" onClick={() => begin('normal')}>
        解除作品封禁
      </Button>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!mutation.isPending) {
            setOpen(next);
            if (!next) void client.cancelQueries({ queryKey: key });
          }
        }}
      >
        <SheetContent showCloseButton={!mutation.isPending} className="overflow-hidden">
          <SheetHeader>
            <SheetTitle>{label}</SheetTitle>
            <SheetDescription>
              {intent?.state === 'normal'
                ? '解除封禁后仍遵守作者的隐藏选择和版本状态'
                : '所有公开版本、图片与导出入口将同步关闭'}
            </SheetDescription>
          </SheetHeader>
          <form
            className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-5"
            noValidate
            onSubmit={form.handleSubmit(() => mutation.mutate())}
          >
            {!snapshot && context.isFetching && (
              <p role="status" className="text-sm text-muted-foreground">
                正在读取人设状态…
              </p>
            )}
            {snapshot && (
              <div className="flex flex-col gap-2 text-sm leading-6">
                <p className="break-words font-medium">{snapshot.title || '未命名人设'}</p>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
                  <dt className="text-muted-foreground">当前人设状态</dt>
                  <dd>{snapshot.moderationState === 'blocked' ? '已封禁' : '正常'}</dd>
                  <dt className="text-muted-foreground">作者选择</dt>
                  <dd>{snapshot.ownerVisibility === 'hidden' ? '作者已隐藏' : '允许展示'}</dd>
                </dl>
              </div>
            )}
            <FormNotice error={context.error} />
            <Button
              type="button"
              variant="outline"
              disabled={context.isFetching || mutation.isPending}
              onClick={() => void reload()}
            >
              读取最新状态
            </Button>
            <fieldset disabled={mutation.isPending || context.isFetching} className="min-w-0">
              <legend className="sr-only">处置理由</legend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={reasonId}>操作理由</FieldLabel>
                  <Textarea
                    id={reasonId}
                    autoComplete="off"
                    {...form.register('reason')}
                    aria-invalid={Boolean(form.formState.errors.reason)}
                    aria-describedby={
                      form.formState.errors.reason ? reasonId + '-error' : undefined
                    }
                  />
                  <FieldError id={reasonId + '-error'}>
                    {form.formState.errors.reason?.message}
                  </FieldError>
                </Field>
              </FieldGroup>
            </fieldset>
            <FormNotice error={mutation.error} />
            {snapshot && snapshot.moderationState === intent?.state && (
              <p className="text-sm text-muted-foreground">当前已处于所选状态，请核对后关闭窗口</p>
            )}
            <SubmitButton
              pending={mutation.isPending}
              disabled={
                !snapshot ||
                context.isFetching ||
                Boolean(context.error) ||
                snapshot.moderationState === intent?.state
              }
              variant={intent?.state === 'normal' ? 'default' : 'destructive'}
            >
              确认{label}
            </SubmitButton>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
