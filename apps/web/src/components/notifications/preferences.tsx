'use client';
import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  UpdateNotificationPreferencesSchema,
  type UpdateNotificationPreferences,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from '@personamarket/ui/components/field';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { notificationsApi, notificationsKey } from '@/lib/notifications-api';
import { ApiError } from '@/lib/auth-api';
import { FormNotice, SubmitButton } from '../auth/auth-fields';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';

function PreferencesForm({ accountId }: { accountId: string }) {
  const client = useQueryClient(),
    key = [...notificationsKey(accountId), 'preferences'];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => notificationsApi.preferences(accountId, signal),
    retry: false,
  });
  return query.isPending ? (
    <Skeleton className="h-24 w-full" />
  ) : query.isError ? (
    <>
      <FormNotice error={query.error} />
      <Button onClick={() => void query.refetch()}>重试读取偏好</Button>
    </>
  ) : (
    <PreferencesFields
      accountId={accountId}
      initial={query.data.data}
      onSaved={(result) => client.setQueryData(key, result)}
    />
  );
}
function PreferencesFields({
  accountId,
  initial,
  onSaved,
}: {
  accountId: string;
  initial: { reviewEmail: boolean; revision: number };
  onSaved: (result: { data: { reviewEmail: boolean; revision: number } }) => void;
}) {
  const id = useId();
  const form = useForm<UpdateNotificationPreferences>({
    resolver: zodResolver(UpdateNotificationPreferencesSchema),
    defaultValues: { reviewEmail: initial.reviewEmail, expectedRevision: initial.revision },
  });
  const save = useMutation({
    mutationFn: (input: UpdateNotificationPreferences) =>
      notificationsApi.updatePreferences(accountId, input),
    retry: false,
    onSuccess: (result) => {
      onSaved(result);
      form.reset({ reviewEmail: result.data.reviewEmail, expectedRevision: result.data.revision });
    },
  });
  const reload = useMutation({
    mutationFn: () => notificationsApi.preferences(accountId, AbortSignal.timeout(10000)),
    retry: false,
    onSuccess: (result) => {
      onSaved(result);
      form.setValue('expectedRevision', result.data.revision, { shouldDirty: true });
      save.reset();
    },
  });
  useUnsavedDraft(form.formState.isDirty, '通知偏好尚未保存，确定离开吗');
  return (
    <form
      aria-label="通知偏好"
      noValidate
      onSubmit={form.handleSubmit((input) => save.mutate(input))}
    >
      <FieldGroup>
        <Controller
          control={form.control}
          name="reviewEmail"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Checkbox
                id={id}
                checked={field.value}
                onCheckedChange={field.onChange}
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                disabled={save.isPending || reload.isPending}
              />
              <FieldLabel htmlFor={id} className="min-h-11 flex-1 py-2">
                接收作品提交和审核结果邮件
              </FieldLabel>
            </Field>
          )}
        />
        <FieldDescription>
          站内通知与必要的账号安全邮件始终保留，已进入队列的邮件按原任务继续投递
        </FieldDescription>
        <FormNotice
          error={save.error ?? reload.error}
          message={
            save.isSuccess && !form.formState.isDirty
              ? '通知偏好已保存'
              : reload.isSuccess
                ? '已读取最新修订，你的选择已保留，请核对后再次保存'
                : undefined
          }
        />
        {save.error instanceof ApiError && save.error.code === 'REVISION_CONFLICT' && (
          <Button
            type="button"
            variant="outline"
            disabled={reload.isPending}
            onClick={() => reload.mutate()}
          >
            读取最新偏好并保留选择
          </Button>
        )}
        <SubmitButton
          pending={save.isPending}
          disabled={!form.formState.isDirty || reload.isPending}
        >
          保存通知偏好
        </SubmitButton>
      </FieldGroup>
    </form>
  );
}
export function NotificationPreferences({ accountId }: { accountId: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <Collapsible
      className="min-w-0"
      onOpenChange={(value) => {
        if (value) setOpened(true);
      }}
    >
      <CollapsibleTrigger render={<Button variant="ghost" />}>通知偏好</CollapsibleTrigger>
      <CollapsibleContent keepMounted className="max-w-2xl pt-3">
        {opened && <PreferencesForm accountId={accountId} />}
      </CollapsibleContent>
    </Collapsible>
  );
}
