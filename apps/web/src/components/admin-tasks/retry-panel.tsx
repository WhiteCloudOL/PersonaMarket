'use client';
import { useId, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  RetryAdminTaskSchema,
  ADMIN_TASK_RETRY_LIMIT,
  ADMIN_TASK_RETRY_COOLDOWN_SECONDS,
  type RetryAdminTask,
  type AdminTaskFailure,
  type AdminTaskRetryHistoryResponseSchema,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@personamarket/ui/components/tabs';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { adminTaskApi } from '@/lib/admin-tasks-api';
import { ApiError } from '@/lib/auth-api';
import { FormNotice, SubmitButton } from '../auth/auth-fields';
import { TaskInformation } from './task-information';
import { RetryHistory, RetryHistoryError } from './retry-history';
import { taskReasons } from './task-fields';

const RetryFormSchema = z.strictObject({
  reason: RetryAdminTaskSchema.shape.reason,
  confirmed: z.boolean().refine((value) => value, '请先确认原任务'),
});
const definitiveErrors = new Set([
  'MFA_REQUIRED',
  'REAUTH_REQUIRED',
  'INVALID_INPUT',
  'CONFLICT',
  'REVISION_CONFLICT',
  'NOT_FOUND',
  'FORBIDDEN',
  'UNAUTHENTICATED',
  'RATE_LIMITED',
]);

export function TaskRetryPanel({
  task,
  accountId,
  active,
  onPendingChange,
  onCreated,
  onFinish,
}: {
  task: AdminTaskFailure;
  accountId: string;
  active: boolean;
  onPendingChange: (pending: boolean) => void;
  onCreated: () => void;
  onFinish: () => void;
}) {
  const [snapshot, setSnapshot] = useState(task),
    [unconfirmed, setUnconfirmed] = useState(false),
    [noFailure, setNoFailure] = useState(false),
    [freshMessage, setFreshMessage] = useState<string>();
  const binding = useRef<{ signature: string; body: RetryAdminTask; key: string } | undefined>(
    undefined,
  );
  const sending = useRef(false);
  const id = useId(),
    client = useQueryClient(),
    target = { source: task.source, id: task.id };
  const historyKey = ['private', 'admin-task-retries', accountId, task.source, task.id];
  const history = useQuery({
    queryKey: historyKey,
    queryFn: ({ signal }) => adminTaskApi.history(accountId, target, signal),
    enabled: active,
    retry: false,
    staleTime: 0,
  });
  const form = useForm<
    z.input<typeof RetryFormSchema>,
    undefined,
    z.output<typeof RetryFormSchema>
  >({ resolver: zodResolver(RetryFormSchema), defaultValues: { reason: '', confirmed: false } });
  const write = useMutation({
    mutationFn: (command: { body: RetryAdminTask; key: string }) =>
      adminTaskApi.retry(accountId, target, command.body, command.key),
    retry: false,
    onMutate: () => onPendingChange(true),
    onSuccess: (result) => {
      setUnconfirmed(false);
      onCreated();
      client.setQueryData<z.infer<typeof AdminTaskRetryHistoryResponseSchema>>(
        historyKey,
        (previous) =>
          previous
            ? {
                ...previous,
                data: [
                  result.data,
                  ...previous.data.filter((record) => record.id !== result.data.id),
                ]
                  .sort((a, b) => b.attempt - a.attempt)
                  .slice(0, previous.meta.maxAttempts),
              }
            : previous,
      );
      void history.refetch();
    },
    onError: (error) => {
      if (!(error instanceof ApiError) || !definitiveErrors.has(error.code)) {
        setUnconfirmed(true);
        void history.refetch();
      }
    },
    onSettled: () => {
      sending.current = false;
      onPendingChange(false);
    },
  });
  const reload = useMutation({
    mutationFn: () => adminTaskApi.detail(accountId, target, AbortSignal.timeout(10000)),
    retry: false,
    onSuccess: (result) => {
      write.reset();
      if (!result.data) {
        setNoFailure(true);
        return;
      }
      setSnapshot(result.data);
      setNoFailure(false);
      binding.current = undefined;
      form.setValue('confirmed', false, { shouldDirty: true });
      write.reset();
      setFreshMessage(
        result.meta.queueObservation.status === 'ready'
          ? '已读取最新任务，请重新核对后确认'
          : '已读取可核验状态，队列观测尚不完整，请重新核对后确认',
      );
      void history.refetch();
    },
  });
  const current = history.isError ? undefined : history.data;
  const limits = history.data?.meta ?? {
    maxAttempts: ADMIN_TASK_RETRY_LIMIT,
    cooldownSeconds: ADMIN_TASK_RETRY_COOLDOWN_SECONDS,
  };
  const reachedLimit = current && (current.data[0]?.attempt ?? 0) >= current.meta.maxAttempts;
  const changed = task.version !== snapshot.version;
  const locked = write.isPending || unconfirmed || reload.isPending;
  function submit(values: z.output<typeof RetryFormSchema>) {
    const parsed = RetryAdminTaskSchema.safeParse({ ...values, expectedVersion: snapshot.version });
    if (!parsed.success) {
      form.setError('root', { message: '请重新核对任务和处理原因' });
      return;
    }
    const signature = JSON.stringify(parsed.data);
    if (!binding.current || binding.current.signature !== signature)
      binding.current = { signature, body: parsed.data, key: crypto.randomUUID() };
    send(binding.current);
  }
  function send(command: { body: RetryAdminTask; key: string }) {
    if (sending.current) return;
    sending.current = true;
    write.mutate(command);
  }
  return (
    <Tabs defaultValue="process" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList className="min-h-11 group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="process" className="min-h-11">
            处理任务
          </TabsTrigger>
          <TabsTrigger value="history" className="min-h-11">
            操作记录
          </TabsTrigger>
        </TabsList>
        <Button
          type="button"
          variant="ghost"
          disabled={history.isFetching || write.isPending}
          onClick={() => void history.refetch()}
        >
          刷新处理记录
        </Button>
      </div>
      <TabsContent value="process" className="flex min-w-0 flex-col gap-5 pt-3">
        {write.isSuccess ? (
          <div className="flex flex-col items-start gap-3">
            <Alert aria-live="polite">
              <AlertTitle>已创建重试请求</AlertTitle>
              <AlertDescription>
                新请求和人工处理记录已保存，实际结果请刷新列表核对
              </AlertDescription>
            </Alert>
            <Button type="button" onClick={onFinish}>
              关闭并刷新列表
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={reload.isPending}
              onClick={() => reload.mutate()}
            >
              核对后续状态
            </Button>
            <FormNotice error={reload.error} />
          </div>
        ) : noFailure ? (
          <div className="flex flex-col items-start gap-3">
            <Alert aria-live="polite">
              <AlertTitle>当前已无可核验的失败记录</AlertTitle>
              <AlertDescription>这不能直接证明业务已完成，请返回列表核对当前状态</AlertDescription>
            </Alert>
            <Button type="button" onClick={onFinish}>
              返回列表核对
            </Button>
          </div>
        ) : !unconfirmed && history.isError ? (
          <RetryHistoryError
            error={history.error}
            pending={history.isFetching}
            retry={() => void history.refetch()}
          />
        ) : !unconfirmed && !current ? (
          <Skeleton aria-label="正在读取人工处理记录" className="h-32" />
        ) : !unconfirmed && reachedLimit ? (
          <Alert>
            <AlertTitle>已达到人工重试上限</AlertTitle>
            <AlertDescription>
              本任务已有 {limits.maxAttempts} 次人工重试，请检查原业务后再处理
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <p className="text-sm text-pretty text-muted-foreground">
              {taskReasons[snapshot.errorCode]}
            </p>
            {freshMessage && (
              <p role="status" className="text-sm text-muted-foreground">
                {freshMessage}
              </p>
            )}
            <p className="text-sm text-pretty text-muted-foreground">
              最多人工重试 {limits.maxAttempts} 次，每次至少间隔 {limits.cooldownSeconds}{' '}
              秒，提交时会重新核验账号和任务状态
            </p>
            <form noValidate onSubmit={(event) => void form.handleSubmit(submit)(event)}>
              <FieldGroup>
                <Field data-invalid={Boolean(form.formState.errors.reason)} data-disabled={locked}>
                  <FieldLabel htmlFor={id + '-reason'}>处理原因</FieldLabel>
                  <Textarea
                    id={id + '-reason'}
                    autoComplete="off"
                    rows={3}
                    disabled={locked}
                    aria-invalid={Boolean(form.formState.errors.reason)}
                    aria-describedby={id + '-reason-help'}
                    {...form.register('reason')}
                  />
                  <FieldDescription id={id + '-reason-help'}>
                    填写5–500个字符，记录核对结果，不要填写密码或密钥
                  </FieldDescription>
                  <FieldError>{form.formState.errors.reason?.message}</FieldError>
                </Field>
                <Controller
                  control={form.control}
                  name="confirmed"
                  render={({ field }) => (
                    <Field
                      data-invalid={Boolean(form.formState.errors.confirmed)}
                      data-disabled={locked}
                    >
                      <FieldLabel className="min-h-11 gap-3" htmlFor={id + '-confirmed'}>
                        <Checkbox
                          id={id + '-confirmed'}
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          onBlur={field.onBlur}
                          ref={field.ref}
                          name={field.name}
                          disabled={locked}
                          aria-invalid={Boolean(form.formState.errors.confirmed)}
                        />
                        我已核对原任务，确认重新处理
                      </FieldLabel>
                      <FieldError>{form.formState.errors.confirmed?.message}</FieldError>
                    </Field>
                  )}
                />
                <FormNotice error={write.error} />
                {unconfirmed && (
                  <Alert aria-live="polite">
                    <AlertTitle>上次请求结果尚未确认</AlertTitle>
                    <AlertDescription>
                      先核对同一请求，系统会复用原内容和幂等标识，避免创建重复操作
                    </AlertDescription>
                  </Alert>
                )}
                <FormNotice error={reload.error} />
                <FieldError>{form.formState.errors.root?.message}</FieldError>
                {unconfirmed ? (
                  <Button
                    type="button"
                    disabled={write.isPending}
                    onClick={() => {
                      if (binding.current) send(binding.current);
                    }}
                  >
                    {write.isPending ? '正在核对…' : '核对上次请求'}
                  </Button>
                ) : (
                  <SubmitButton pending={write.isPending} disabled={reload.isPending || changed}>
                    创建重试请求
                  </SubmitButton>
                )}
                {!unconfirmed &&
                  (changed ||
                    (write.error instanceof ApiError &&
                      ['REVISION_CONFLICT', 'CONFLICT', 'NOT_FOUND'].includes(
                        write.error.code,
                      ))) && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={write.isPending || reload.isPending}
                      onClick={() => reload.mutate()}
                    >
                      {reload.isPending ? '正在核对…' : '重新核对任务'}
                    </Button>
                  )}
              </FieldGroup>
            </form>
          </>
        )}
        <TaskInformation task={snapshot} />
      </TabsContent>
      <TabsContent value="history" className="min-w-0 pt-4">
        {history.isError ? (
          <RetryHistoryError
            error={history.error}
            pending={history.isFetching}
            retry={() => void history.refetch()}
          />
        ) : current ? (
          <RetryHistory value={current} />
        ) : (
          <Skeleton aria-label="正在读取人工处理记录" className="h-32" />
        )}
      </TabsContent>
    </Tabs>
  );
}
