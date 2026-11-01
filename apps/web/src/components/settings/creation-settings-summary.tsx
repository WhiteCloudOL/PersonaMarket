import type {
  CreationSettingsResponse,
  SubmissionSettingsRecordValueSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { canonicalJson } from '@personamarket/contracts';

export function SubmissionSettingsSummary({
  value,
}: {
  value: z.infer<typeof SubmissionSettingsRecordValueSchema>;
}) {
  return (
    <dl className="grid min-w-0 gap-3 text-sm leading-7">
      <div>
        <dt className="text-muted-foreground">投稿与平台</dt>
        <dd>
          {value.enabled ? '开放投稿' : '暂停新增投稿'} ·{' '}
          {value.platforms
            .map((platform) => (platform === 'maibot' ? 'MaiBot' : 'AstrBot'))
            .join('、')}{' '}
          · 每日 {value.dailyQuota} 次
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">待审提示</dt>
        <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">
          {value.pendingHint === null
            ? '当时未配置此字段'
            : value.pendingHint === ''
              ? '不显示额外待审提示'
              : value.pendingHint}
        </dd>
      </div>
    </dl>
  );
}
export function CreationSettingsSummary({ value }: { value: CreationSettingsResponse['data'] }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SubmissionSettingsSummary value={value.submissions} />
      <p className="text-sm leading-7 text-muted-foreground">
        正文上限：MaiBot 每段 {value.contentLimits.maibotField}，AstrBot 人格{' '}
        {value.contentLimits.astrbotPrompt}，{value.contentLimits.dialoguePairs} 对预设对话，每条{' '}
        {value.contentLimits.dialogueMessage} 字符
      </p>
    </div>
  );
}
export function CreationSettingsChanges({
  before,
  after,
}: {
  before: CreationSettingsResponse['data'];
  after: CreationSettingsResponse['data'];
}) {
  const rows = [
    {
      label: '开放人设投稿',
      before: before.submissions.enabled,
      after: after.submissions.enabled,
      displayBefore: before.submissions.enabled ? '开放' : '关闭',
      displayAfter: after.submissions.enabled ? '开放' : '关闭',
    },
    {
      label: '开放平台',
      before: before.submissions.platforms,
      after: after.submissions.platforms,
      displayBefore: before.submissions.platforms.join('、'),
      displayAfter: after.submissions.platforms.join('、'),
    },
    {
      label: '每人每日投稿次数',
      before: before.submissions.dailyQuota,
      after: after.submissions.dailyQuota,
      displayBefore: String(before.submissions.dailyQuota),
      displayAfter: String(after.submissions.dailyQuota),
    },
    {
      label: '待审提示',
      before: before.submissions.pendingHint,
      after: after.submissions.pendingHint,
      displayBefore: before.submissions.pendingHint || '不显示额外待审提示',
      displayAfter: after.submissions.pendingHint || '不显示额外待审提示',
    },
    ...(['maibotField', 'astrbotPrompt', 'dialoguePairs', 'dialogueMessage'] as const).map(
      (name, index) => ({
        label:
          [
            'MaiBot 每段正文上限',
            'AstrBot 人格设定上限',
            'AstrBot 预设对话对数',
            '每条预设对话上限',
          ][index] ?? name,
        before: before.contentLimits[name],
        after: after.contentLimits[name],
        displayBefore: String(before.contentLimits[name]),
        displayAfter: String(after.contentLimits[name]),
      }),
    ),
  ].filter((row) => canonicalJson(row.before) !== canonicalJson(row.after));
  if (!rows.length)
    return <p className="text-sm text-muted-foreground">当前输入已是默认值，没有需要替换的设置</p>;
  return (
    <dl className="flex min-w-0 flex-col gap-4 text-sm leading-7">
      {rows.map((row) => (
        <div key={row.label} className="min-w-0">
          <dt className="font-medium">{row.label}</dt>
          <dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
            当前：{row.displayBefore}
            <br />
            默认：{row.displayAfter}
          </dd>
        </div>
      ))}
    </dl>
  );
}
