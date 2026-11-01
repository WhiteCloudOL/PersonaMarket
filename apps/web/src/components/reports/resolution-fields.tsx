'use client';
import { useRef } from 'react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import type { AdminReport, AdminReportAction, ReportResolution } from '@personamarket/contracts';
import {
  Field,
  FieldSet,
  FieldLegend,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import { Textarea } from '@personamarket/ui/components/textarea';
import { type reportActionFormSchema, reportContentActions } from '@/lib/report-action-form';
import { ReportSelect } from './select';

export function ReportResolutionFields({
  form,
  snapshot,
  busy,
}: {
  form: UseFormReturn<z.input<typeof reportActionFormSchema>, unknown, AdminReportAction>;
  snapshot: AdminReport;
  busy: boolean;
}) {
  const resolution = useWatch({ control: form.control, name: 'resolution' });
  const reasonDraft = useRef(resolution?.reason ?? '');
  function update(content: string, account: string) {
    if (content === 'none' && account === 'none') {
      reasonDraft.current = resolution?.reason ?? reasonDraft.current;
      form.setValue('resolution', undefined, { shouldDirty: true, shouldValidate: true });
      return;
    }
    let selected: ReportResolution['content'];
    if (content === 'block_persona' && snapshot.moderation.persona)
      selected = { action: content, expectedRevision: snapshot.moderation.persona.revision };
    else if (content === 'block_release' && snapshot.moderation.release)
      selected = { action: content, expectedRevision: snapshot.moderation.release.revision };
    else if (content === 'hide_comment' && snapshot.moderation.comment)
      selected = { action: content, expectedRevision: snapshot.moderation.comment.revision };
    else if (content === 'hide_profile' && snapshot.moderation.profile)
      selected = { action: content, expectedRevision: snapshot.moderation.profile.revision };
    form.setValue(
      'resolution',
      {
        reason: resolution?.reason ?? reasonDraft.current,
        ...(selected ? { content: selected } : {}),
        ...(account === 'account_only' || account === 'account_and_personas'
          ? {
              account: {
                action: 'ban',
                scope: account,
                expectedSecurityVersion: snapshot.moderation.account.securityVersion,
              },
            }
          : {}),
      },
      { shouldDirty: true, shouldValidate: false },
    );
  }
  // 未选择处置时不能注册嵌套字段，否则RHF会创建空resolution并阻塞仅记录结果
  const reason = resolution ? form.register('resolution.reason') : undefined;
  return (
    <FieldSet>
      <FieldLegend>结案处置</FieldLegend>
      <FieldDescription>按核实结果选择，处置说明会提供给被处置者</FieldDescription>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="report-content-action">内容处置</FieldLabel>
          <ReportSelect
            id="report-content-action"
            disabled={busy}
            value={resolution?.content?.action ?? 'none'}
            onChange={(next) => update(next, resolution?.account?.scope ?? 'none')}
            options={[
              { value: 'none', label: '保留当前内容' },
              ...(snapshot.type === 'persona'
                ? [
                    { value: 'block_release', label: reportContentActions.block_release },
                    { value: 'block_persona', label: reportContentActions.block_persona },
                  ]
                : snapshot.type === 'profile'
                  ? [{ value: 'hide_profile', label: reportContentActions.hide_profile }]
                  : [{ value: 'hide_comment', label: reportContentActions.hide_comment }]),
            ]}
          />
          <FieldDescription>
            {snapshot.type === 'persona'
              ? '封禁版本仅影响所举报版本，下架整个人设会限制其全部版本'
              : snapshot.type === 'profile'
                ? '隐藏昵称、头像、简介与链接，已发布作品仍按各自状态展示'
                : '隐藏后，公开正文和回复入口同步受限'}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="report-account-action">账号处置</FieldLabel>
          <ReportSelect
            id="report-account-action"
            disabled={busy}
            value={resolution?.account?.scope ?? 'none'}
            onChange={(next) => update(resolution?.content?.action ?? 'none', next)}
            options={[
              { value: 'none', label: '保留当前账号' },
              { value: 'account_only', label: '封禁账号' },
              { value: 'account_and_personas', label: '封禁账号及全部作品' },
            ]}
          />
          <FieldDescription>封禁会撤销该账号全部登录会话，相关公开内容将受限</FieldDescription>
        </Field>
      </div>
      {resolution && (
        <Field data-invalid={Boolean(form.formState.errors.resolution?.reason)}>
          <FieldLabel htmlFor="report-resolution-reason">被处置者可见说明</FieldLabel>
          <Textarea
            id="report-resolution-reason"
            className="max-h-[40dvh]"
            rows={3}
            disabled={busy}
            autoComplete="off"
            aria-invalid={Boolean(form.formState.errors.resolution?.reason)}
            {...reason}
            onChange={(event) => {
              reasonDraft.current = event.target.value;
              void reason?.onChange(event);
            }}
          />
          <FieldDescription>请独立说明处置原因，避免包含举报人的身份或私有线索</FieldDescription>
          <FieldError errors={[form.formState.errors.resolution?.reason]} />
        </Field>
      )}
      <FieldError
        errors={[
          form.formState.errors.resolution?.content,
          form.formState.errors.resolution?.account,
        ]}
      />
    </FieldSet>
  );
}
