import type { AdminTaskFailure, AdminTaskQuery } from '@personamarket/contracts';

export const taskCategories = [
  { value: 'all', label: '全部类别' },
  { value: 'mail', label: '邮件' },
  { value: 'images', label: '图片导入' },
  { value: 'rankings', label: '榜单生成' },
  { value: 'notifications', label: '站内通知' },
  { value: 'storage', label: '文件清理' },
  { value: 'system', label: '系统任务' },
  { value: 'unknown', label: '未知类别' },
] satisfies Array<{ value: AdminTaskQuery['category']; label: string }>;
export const taskStages = [
  { value: 'all', label: '全部阶段' },
  { value: 'dispatch', label: '分发失败' },
  { value: 'execution', label: '执行失败' },
  { value: 'uncertain', label: '结果待确认' },
] satisfies Array<{ value: AdminTaskQuery['stage']; label: string }>;
const sources = {
  image: '在线图片导入',
  market_image: '导入包图片',
  ranking: '排行榜生成',
  notification: '站内通知',
  mail: '邮件投递',
};
export function taskName(task: AdminTaskFailure) {
  return task.source === 'dispatch' || task.source === 'queue'
    ? (taskCategories.find((item) => item.value === task.category)?.label ?? '未知任务') +
        (task.source === 'dispatch' ? '分发' : '执行')
    : sources[task.source];
}
export const taskReasons = {
  DISPATCH_FAILED: '任务分发已耗尽自动重试',
  IMAGE_IMPORT_FAILED: '图片未能导入，请核对来源和站点限制',
  RANKING_BUILD_FAILED: '本批榜单未能完成生成',
  NOTIFICATION_DELIVERY_FAILED: '通知尚未送达，请核对投递状态',
  MAIL_SEND_FAILED: '邮件未能发送，请核对邮件服务和原业务状态',
  MAIL_NOT_CONFIGURED: '邮件配置暂不可用，请先核对邮件服务',
  MAIL_PAYLOAD_INVALID: '邮件内容无法安全处理，请从原业务重新发起',
  MAIL_RECIPIENT_REJECTED: '邮件服务拒绝了收件地址，请核对地址后重新申请',
  MAIL_VERIFICATION_EXPIRED: '验证码已失效，请重新申请',
  MAIL_RESULT_UNCERTAIN: '发送结果尚待确认，请先核对邮件记录，避免重复发送',
  MAIL_RECEIPT_UNCERTAIN: '邮件已由服务接收，但投递回执尚待确认',
  QUEUE_EXECUTION_FAILED: '队列执行失败，请核对对应业务状态',
};
export const taskStageName = (stage: AdminTaskFailure['stage']) =>
  taskStages.find((item) => item.value === stage)?.label ?? '结果待确认';
export const taskDate = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
