'use client';
import { Controller, useFormContext } from 'react-hook-form';
import type { CreationSettingsWrite } from '@personamarket/contracts';
import { Switch } from '@personamarket/ui/components/switch';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import { Textarea } from '@personamarket/ui/components/textarea';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldSet,
  FieldLegend,
} from '@personamarket/ui/components/field';
import { EditorSection } from '../personas/editor-section';
import { AuthField } from '../auth/auth-fields';

export function CreationSettingsInputs() {
  const form = useFormContext<CreationSettingsWrite>();
  const errors = form.formState.errors;
  const limits = [
    ['maibotField', 'MaiBot 每段正文上限', 20000],
    ['astrbotPrompt', 'AstrBot 人格设定上限', 100000],
    ['dialoguePairs', 'AstrBot 预设对话对数', 100],
    ['dialogueMessage', '每条预设对话上限', 20000],
  ] as const;
  return (
    <>
      <EditorSection
        title="投稿策略"
        description="关闭或移除平台会阻止新建作品和新送审，已有公开版本继续可用"
      >
        <FieldGroup>
          <Controller
            name="data.submissions.enabled"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="submissions-enabled">开放人设投稿</FieldLabel>
                <Switch
                  id="submissions-enabled"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </Field>
            )}
          />
          <Controller
            name="data.submissions.platforms"
            control={form.control}
            render={({ field }) => (
              <FieldSet data-invalid={Boolean(errors.data?.submissions?.platforms)}>
                <FieldLegend>开放平台</FieldLegend>
                <div className="flex flex-wrap gap-5">
                  {(['maibot', 'astrbot'] as const).map((platform) => (
                    <Field
                      key={platform}
                      orientation="horizontal"
                      className="w-auto min-w-0 max-w-full"
                    >
                      <Checkbox
                        id={'allow-' + platform}
                        ref={platform === 'maibot' ? field.ref : undefined}
                        aria-invalid={Boolean(errors.data?.submissions?.platforms)}
                        aria-describedby={
                          errors.data?.submissions?.platforms
                            ? 'submission-platforms-error'
                            : undefined
                        }
                        checked={field.value.includes(platform)}
                        onCheckedChange={(checked) =>
                          field.onChange(
                            checked
                              ? [...field.value, platform]
                              : field.value.filter((value) => value !== platform),
                          )
                        }
                      />
                      <FieldLabel
                        htmlFor={'allow-' + platform}
                        className="min-h-11 min-w-11 items-center whitespace-normal [overflow-wrap:anywhere]"
                      >
                        {platform === 'maibot' ? 'MaiBot' : 'AstrBot'}
                      </FieldLabel>
                    </Field>
                  ))}
                </div>
                <FieldError id="submission-platforms-error">
                  {errors.data?.submissions?.platforms?.message}
                </FieldError>
              </FieldSet>
            )}
          />
          <AuthField
            id="daily-quota"
            label="每人每日投稿次数"
            type="number"
            min={1}
            max={100}
            description="按 UTC 自然日统计，每次重提都计入配额，幂等重试不重复计数"
            {...form.register('data.submissions.dailyQuota', { valueAsNumber: true })}
            error={errors.data?.submissions?.dailyQuota?.message}
          />
          <Field data-invalid={Boolean(errors.data?.submissions?.pendingHint)}>
            <FieldLabel htmlFor="submission-pending-hint">待审提示</FieldLabel>
            <Textarea
              id="submission-pending-hint"
              className="min-h-28 text-base"
              autoComplete="off"
              {...form.register('data.submissions.pendingHint')}
              aria-invalid={Boolean(errors.data?.submissions?.pendingHint)}
              aria-describedby="submission-pending-hint-help submission-pending-hint-error"
            />
            <FieldDescription id="submission-pending-hint-help">
              最多 500 个字符，按纯文本显示；留空隐藏额外说明，当前待审版本在重新读取时使用新提示
            </FieldDescription>
            <FieldError id="submission-pending-hint-error">
              {errors.data?.submissions?.pendingHint?.message}
            </FieldError>
          </Field>
        </FieldGroup>
      </EditorSection>
      <EditorSection
        title="正文与预设对话"
        description="按 Unicode 字符计数，业务上限始终受部署级绝对边界约束"
      >
        <FieldGroup>
          {limits.map(([name, label, max]) => (
            <AuthField
              key={name}
              id={'limit-' + name}
              label={label}
              type="number"
              min={1}
              max={max}
              {...form.register(`data.contentLimits.${name}`, { valueAsNumber: true })}
              error={errors.data?.contentLimits?.[name]?.message}
            />
          ))}
          <FieldDescription>
            降低上限不会截断历史版本或草稿，重新送审需要符合当前上限
          </FieldDescription>
        </FieldGroup>
      </EditorSection>
      <Field data-invalid={Boolean(errors.reason)}>
        <FieldLabel htmlFor="creation-settings-reason">处理理由</FieldLabel>
        <Textarea
          id="creation-settings-reason"
          autoComplete="off"
          {...form.register('reason')}
          aria-invalid={Boolean(errors.reason)}
          aria-describedby="creation-settings-reason-error"
        />
        <FieldError id="creation-settings-reason-error">{errors.reason?.message}</FieldError>
      </Field>
    </>
  );
}
