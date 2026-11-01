import type { SystemSettings } from '@personamarket/contracts';

export function SystemSettingsSummary({ value }: { value: SystemSettings }) {
  return (
    <dl className="flex min-w-0 flex-col gap-4 text-sm leading-7">
      <div>
        <dt className="text-muted-foreground">维护状态</dt>
        <dd>
          {value.maintenanceEnabled
            ? '开启维护，拒绝新普通业务提交'
            : '关闭维护，按原规则处理业务提交'}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">公共维护提示</dt>
        <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">
          {value.maintenanceMessage || '未填写，开启维护后使用默认提示'}
        </dd>
      </div>
    </dl>
  );
}
export function SystemSettingsChanges({
  before,
  after,
}: {
  before: SystemSettings;
  after: SystemSettings;
}) {
  const statusChanged = before.maintenanceEnabled !== after.maintenanceEnabled;
  const messageChanged = before.maintenanceMessage !== after.maintenanceMessage;
  if (!statusChanged && !messageChanged)
    return <p className="text-sm leading-7">当前表单与部署默认值没有差异</p>;
  return (
    <dl className="flex min-w-0 flex-col gap-4 text-sm leading-7">
      {statusChanged && (
        <div>
          <dt className="font-medium">维护模式</dt>
          <dd>当前：{before.maintenanceEnabled ? '开启' : '关闭'}</dd>
          <dd>默认：{after.maintenanceEnabled ? '开启' : '关闭'}</dd>
        </div>
      )}
      {messageChanged && (
        <div>
          <dt className="font-medium">公共维护提示</dt>
          <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">
            当前：{before.maintenanceMessage || '未填写'}
          </dd>
          <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">
            默认：{after.maintenanceMessage || '未填写，开启后使用默认提示'}
          </dd>
        </div>
      )}
    </dl>
  );
}
