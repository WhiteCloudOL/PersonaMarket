export const reportStatuses = {
  pending: '待受理',
  processing: '处理中',
  resolved: '已处理',
  dismissed: '已驳回',
} as const;
export const reportReasons = {
  copyright: '侵权或来源问题',
  inappropriate: '不当内容',
  spam: '垃圾广告',
  other: '其他问题',
} as const;
export const reportTypes = {
  persona: '人设版本',
  comment: '公开评论',
  profile: '公开资料',
} as const;
export const reportActions = {
  accept: '受理举报',
  resolve: '完成处理',
  dismiss: '驳回举报',
  note: '补充说明',
} as const;
export const reportRecordActions = {
  submitted: '提交举报',
  accepted: '受理举报',
  resolved: '完成处理',
  dismissed: '驳回举报',
  noted: '补充说明',
} as const;
