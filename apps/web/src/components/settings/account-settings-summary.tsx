import {
  canonicalJson,
  type AccountSettings,
  type AccountSettingsRecordValue,
} from '@personamarket/contracts';

export const verificationTimingLabel = (value: AccountSettings['verificationEmailTiming']) =>
  value === 'on_registration' ? '注册时自动发送' : '登录后主动申请';
export function AccountSettingsSummary({ value }: { value: AccountSettings }) {
  return (
    <dl className="grid min-w-0 gap-3 text-sm leading-7">
      <div>
        <dt className="text-muted-foreground">注册与邮箱验证</dt>
        <dd>
          {value.registrationEnabled ? '开放新用户注册' : '暂停新用户注册'} · 注册时校验邮箱验证码
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">每个 IP 的业务注册频率</dt>
        <dd>
          {value.registrationRateLimit.windowSeconds} 秒内最多{' '}
          {value.registrationRateLimit.maxAttempts} 次尝试，另受固定每小时 10 次保护
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">新会话有效期</dt>
        <dd>{value.sessionTtlSeconds} 秒，仅影响之后创建的完整会话</dd>
      </div>
    </dl>
  );
}
export function AccountSettingsChanges({
  before,
  after,
}: {
  before: AccountSettings;
  after: AccountSettings;
}) {
  const rows = [
    {
      label: '开放新用户注册',
      before: before.registrationEnabled,
      after: after.registrationEnabled,
      current: before.registrationEnabled ? '开放' : '关闭',
      next: after.registrationEnabled ? '开放' : '关闭',
    },
    {
      label: '注册尝试次数',
      before: before.registrationRateLimit.maxAttempts,
      after: after.registrationRateLimit.maxAttempts,
      current: before.registrationRateLimit.maxAttempts + ' 次',
      next: after.registrationRateLimit.maxAttempts + ' 次',
    },
    {
      label: '注册业务窗口',
      before: before.registrationRateLimit.windowSeconds,
      after: after.registrationRateLimit.windowSeconds,
      current: before.registrationRateLimit.windowSeconds + ' 秒',
      next: after.registrationRateLimit.windowSeconds + ' 秒',
    },
    {
      label: '新会话有效期',
      before: before.sessionTtlSeconds,
      after: after.sessionTtlSeconds,
      current: before.sessionTtlSeconds + ' 秒',
      next: after.sessionTtlSeconds + ' 秒',
    },
  ].filter((row) => canonicalJson(row.before) !== canonicalJson(row.after));
  if (!rows.length)
    return (
      <p className="text-sm text-muted-foreground">当前输入已是部署默认值，没有需要替换的设置</p>
    );
  return (
    <dl className="flex min-w-0 flex-col gap-4 text-sm leading-7">
      {rows.map((row) => (
        <div key={row.label} className="min-w-0">
          <dt className="font-medium">{row.label}</dt>
          <dd className="[overflow-wrap:anywhere]">
            当前：{row.current}
            <br />
            默认：{row.next}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function AccountSettingsRecordSummary({ value }: { value: AccountSettingsRecordValue }) {
  const stored = value.stored,
    fallback = '沿用当时部署默认或字段未记录';
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {value.effective ? (
        <AccountSettingsSummary value={value.effective} />
      ) : (
        <p className="text-sm text-muted-foreground">当时有效值未记录，不能使用当前默认值代替</p>
      )}
      <details className="min-w-0 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center">查看存储与默认来源</summary>
        <dl className="flex min-w-0 flex-col gap-2 leading-7 [overflow-wrap:anywhere]">
          <div>
            <dt className="text-muted-foreground">注册开关</dt>
            <dd>
              {stored.registrationEnabled === null
                ? fallback
                : stored.registrationEnabled
                  ? '固定为开放'
                  : '固定为关闭'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">历史邮件发送时机</dt>
            <dd>
              {stored.verificationEmailTiming === null
                ? fallback
                : verificationTimingLabel(stored.verificationEmailTiming)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">注册尝试次数</dt>
            <dd>{stored.registrationRateLimit?.maxAttempts ?? fallback}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">业务窗口（秒）</dt>
            <dd>{stored.registrationRateLimit?.windowSeconds ?? fallback}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">新会话有效期（秒）</dt>
            <dd>{stored.sessionTtlSeconds ?? fallback}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
