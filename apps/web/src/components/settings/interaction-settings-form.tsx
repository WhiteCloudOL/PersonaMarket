'use client';
import { Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  authQuery,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from '@/lib/auth-api';
import { EditorSection } from '../personas/editor-section';
import { FormNotice, SubmitButton } from '../auth/auth-fields';
import { useSettingsForm } from './use-settings-form';

const settingsKey = (accountId: string) => ['private', 'settings', 'community', accountId];
async function readCommunity(signal: AbortSignal) {
  return checkedResponse(
    await getCommunitySettings({
      ...sessionRequestOptions,
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    }),
    InteractionSettingsResponseSchema,
  );
}
type Response = z.infer<typeof InteractionSettingsResponseSchema>;
function InteractionFields({ accountId, initial }: { accountId: string; initial: Response }) {
  const client = useQueryClient();
  const { form, save, busy, canSave, message, error } = useSettingsForm<
    z.infer<typeof InteractionSettingsSchema>,
    Response
  >({
    accountId,
    queryKey: settingsKey(accountId),
    initial,
    resolver: zodResolver(InteractionSettingsSchema),
    valuesFor: (result) => result.data,
    read: readCommunity,
    write: (body, base) =>
      authenticatedWriteFor(
        accountId,
        (header) =>
          updateCommunitySettings({
            ...sessionRequestOptions,
            signal: AbortSignal.timeout(10000),
            body,
            params: { header: { ...header, 'If-Match': '"community-' + base.meta.revision + '"' } },
          }),
        InteractionSettingsResponseSchema,
        {
          accountChanged: '登录账号已变化，请重新打开社区设置',
          verificationRequired: '请先完成登录验证',
        },
      ),
    saved: '社区设置已保存',
    onSaved: () => {
      void client.invalidateQueries({ queryKey: ['private', 'persona-interactions'] });
      void client.invalidateQueries({ queryKey: ['private', 'comments'] });
      void client.invalidateQueries({ queryKey: ['public', 'comments'] });
    },
  });
  return (
    <form noValidate onSubmit={form.handleSubmit(save)} className="flex flex-col gap-5">
      <fieldset
        disabled={busy}
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
      <FormNotice message={message} error={error} />
      <SubmitButton pending={busy} disabled={!canSave}>
        保存社区设置
      </SubmitButton>
    </form>
  );
}
export function InteractionSettingsForm() {
  const accountId = useQuery(authQuery).data?.data.account?.id ?? '';
  const query = useQuery({
    queryKey: settingsKey(accountId),
    enabled: Boolean(accountId),
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
  return <InteractionFields key={accountId} accountId={accountId} initial={query.data} />;
}
