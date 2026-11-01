'use client';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCommunitySettings, updateCommunitySettings } from '@personamarket/api-client';
import {
  InteractionSettingsSchema,
  InteractionSettingsResponseSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
import { Switch } from '@personamarket/ui/components/switch';
import { Input } from '@personamarket/ui/components/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@personamarket/ui/components/select';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import {
  ApiError,
  authenticatedWrite,
  checkedResponse,
  sessionRequestOptions,
} from '@/lib/auth-api';
import { EditorSection } from '../personas/editor-section';
import { FormNotice, SubmitButton } from '../auth/auth-fields';
import { useSettingsDirty } from './settings-navigation';

const key = ['private', 'settings', 'community'];
async function readCommunity(signal: AbortSignal) {
  return checkedResponse(
    await getCommunitySettings({
      ...sessionRequestOptions,
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    }),
    InteractionSettingsResponseSchema,
  );
}
function InteractionFields({
  initial,
  onSaved,
}: {
  initial: z.infer<typeof InteractionSettingsResponseSchema>;
  onSaved: () => void;
}) {
  const client = useQueryClient();
  const [revision, setRevision] = useState(initial.meta.revision);
  const latest = useQuery({
    queryKey: [...key, 'conflict', initial.meta.revision],
    queryFn: ({ signal }) => readCommunity(signal),
    enabled: false,
    retry: false,
  });
  const form = useForm<z.infer<typeof InteractionSettingsSchema>>({
    resolver: zodResolver(InteractionSettingsSchema),
    defaultValues: initial.data,
  });
  useSettingsDirty(form.formState.isDirty);
  const mutation = useMutation({
    mutationFn: (body: z.infer<typeof InteractionSettingsSchema>) =>
      authenticatedWrite(
        (header) =>
          updateCommunitySettings({
            ...sessionRequestOptions,
            signal: AbortSignal.timeout(10000),
            body,
            params: {
              header: { ...header, 'If-Match': '"community-' + revision + '"' },
            },
          }),
        InteractionSettingsResponseSchema,
      ),
    onSuccess: (result) => {
      form.reset(result.data);
      client.setQueryData(key, result);
      onSaved();
      void client.invalidateQueries({ queryKey: ['private', 'persona-interactions'] });
      void client.invalidateQueries({ queryKey: ['private', 'comments'] });
      void client.invalidateQueries({ queryKey: ['public', 'comments'] });
    },
    retry: false,
  });
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((value) => mutation.mutate(value))}
      className="flex flex-col gap-5"
    >
      <fieldset
        disabled={mutation.isPending}
        aria-label="社区互动设置表单"
        className="flex min-w-0 flex-col gap-5 border-0 p-0"
      >
        <EditorSection
          title="点赞与收藏"
          description="仅已验证邮箱的正常账号可操作，收藏列表保持私有"
        >
          <FieldGroup>
            {(
              [
                { name: 'likesEnabled', label: '开放新增点赞' },
                { name: 'favoritesEnabled', label: '开放新增收藏' },
              ] as const
            ).map((row) => (
              <Controller
                key={row.name}
                control={form.control}
                name={row.name}
                render={({ field }) => (
                  <Field>
                    <FieldLabel
                      htmlFor={row.name}
                      className="min-h-11 justify-between gap-4 rounded-xl border p-4"
                    >
                      <span>{row.label}</span>
                      <Switch
                        id={row.name}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FieldLabel>
                    <FieldDescription>
                      关闭后保留已有记录和真实计数，用户仍可取消自己的记录
                    </FieldDescription>
                  </Field>
                )}
              />
            ))}
          </FieldGroup>
        </EditorSection>
        <EditorSection
          title="评论与审核"
          description="评论支持两层回复，修改文本后按当前策略重新处理"
        >
          <FieldGroup>
            {(
              [
                {
                  name: 'commentsEnabled',
                  label: '开放新建和编辑评论',
                  description: '关闭后仍可删除自己的评论，已有待审内容仍可审核',
                },
                {
                  name: 'showExistingComments',
                  label: '展示已有公开评论',
                  description: '独立控制历史评论的公开展示，不删除评论或审核记录',
                },
              ] as const
            ).map((row) => (
              <Controller
                key={row.name}
                control={form.control}
                name={row.name}
                render={({ field }) => (
                  <Field>
                    <FieldLabel
                      htmlFor={row.name}
                      className="min-h-11 justify-between gap-4 rounded-xl border p-4"
                    >
                      <span>{row.label}</span>
                      <Switch
                        id={row.name}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FieldLabel>
                    <FieldDescription>{row.description}</FieldDescription>
                  </Field>
                )}
              />
            ))}
            <Controller
              control={form.control}
              name="commentReviewMode"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="commentReviewMode">评论审核策略</FieldLabel>
                  <Select
                    items={[
                      { value: 'all', label: '全部审核后公开' },
                      { value: 'off', label: '关闭预审，自动批准' },
                    ]}
                    value={field.value}
                    onValueChange={(value) => {
                      if (value) field.onChange(value);
                    }}
                  >
                    <SelectTrigger
                      id="commentReviewMode"
                      aria-invalid={fieldState.invalid}
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="all">全部审核后公开</SelectItem>
                        <SelectItem value="off">关闭预审，自动批准</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    自动批准会记录处理依据，切换策略不会自动处理已有待审文本
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              <Field data-invalid={Boolean(form.formState.errors.commentMaxLength)}>
                <FieldLabel htmlFor="commentMaxLength">单条评论字数上限</FieldLabel>
                <Input
                  id="commentMaxLength"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={2000}
                  aria-invalid={Boolean(form.formState.errors.commentMaxLength)}
                  {...form.register('commentMaxLength', { valueAsNumber: true })}
                />
                <FieldDescription>可设置为 1–2000 字，按 Unicode 字符计数</FieldDescription>
                <FieldError errors={[form.formState.errors.commentMaxLength]} />
              </Field>
              <Field data-invalid={Boolean(form.formState.errors.commentsPerMinute)}>
                <FieldLabel htmlFor="commentsPerMinute">每人每分钟提交上限</FieldLabel>
                <Input
                  id="commentsPerMinute"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={30}
                  aria-invalid={Boolean(form.formState.errors.commentsPerMinute)}
                  {...form.register('commentsPerMinute', { valueAsNumber: true })}
                />
                <FieldDescription>可设置为 1–30 次，新建和有效编辑共同计数</FieldDescription>
                <FieldError errors={[form.formState.errors.commentsPerMinute]} />
              </Field>
            </div>
          </FieldGroup>
        </EditorSection>
      </fieldset>
      <FormNotice error={mutation.error} />
      {mutation.error instanceof ApiError && mutation.error.code === 'REVISION_CONFLICT' && (
        <>
          <Button
            type="button"
            variant="outline"
            disabled={latest.isFetching}
            onClick={() => {
              void latest.refetch().then((result) => {
                if (result.isSuccess) setRevision(result.data.meta.revision);
              });
            }}
          >
            {latest.isFetching ? '正在读取最新设置…' : '读取最新社区设置'}
          </Button>
          <FormNotice error={latest.error} />
          {latest.data && (
            <div className="flex flex-col gap-2 text-sm text-muted-foreground" role="status">
              <p>
                最新设置：新增点赞{latest.data.data.likesEnabled ? '开放' : '关闭'}，新增收藏
                {latest.data.data.favoritesEnabled ? '开放' : '关闭'}
              </p>
              <p>当前选项已保留，确认后再次保存</p>
              <p>
                最新评论策略：{latest.data.data.commentsEnabled ? '允许提交' : '停止提交'}，
                {latest.data.data.showExistingComments ? '展示历史评论' : '隐藏历史评论'}，
                {latest.data.data.commentReviewMode === 'all' ? '全部审核' : '自动批准'}，最多{' '}
                {latest.data.data.commentMaxLength} 字，每分钟 {latest.data.data.commentsPerMinute}{' '}
                次
              </p>
            </div>
          )}
        </>
      )}
      <SubmitButton pending={mutation.isPending || latest.isFetching}>保存社区设置</SubmitButton>
    </form>
  );
}
export function InteractionSettingsForm() {
  const [saved, setSaved] = useState(false);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => readCommunity(signal),
    retry: false,
  });
  if (query.isPending) return <p role="status">正在读取社区设置…</p>;
  if (query.isError)
    return (
      <>
        <FormNotice error={query.error} />
        <Button onClick={() => void query.refetch()}>重新读取社区设置</Button>
      </>
    );
  return (
    <>
      <FormNotice message={saved ? '社区设置已保存' : undefined} />
      <InteractionFields
        key={query.data.meta.revision}
        initial={query.data}
        onSaved={() => setSaved(true)}
      />
    </>
  );
}
