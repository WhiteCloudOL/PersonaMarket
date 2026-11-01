import { z } from 'zod';
import {
  AdminReportActionSchema,
  ReportResolutionSchema,
  type AdminReport,
  type AdminReportAction,
  type ReportResolution,
} from '@personamarket/contracts';

// 切换处理动作时保留处置草稿，只有结案才将它送入统一API契约
export const reportActionFormSchema = z
  .strictObject({
    ...AdminReportActionSchema.shape,
    resolution: z.strictObject({ ...ReportResolutionSchema.shape, reason: z.string() }).optional(),
  })
  .transform(({ resolution, ...value }): z.input<typeof AdminReportActionSchema> => ({
    ...value,
    ...(value.action === 'resolve' && resolution ? { resolution } : {}),
  }))
  .pipe(AdminReportActionSchema);

// OpenAPI可选字段省略而不发送显式undefined，和生成客户端的严格可选类型一致
export function reportActionRequest(input: AdminReportAction) {
  const { resolution, ...action } = input;
  return {
    ...action,
    ...(resolution
      ? {
          resolution: {
            reason: resolution.reason,
            ...(resolution.content ? { content: resolution.content } : {}),
            ...(resolution.account ? { account: resolution.account } : {}),
          },
        }
      : {}),
  };
}

export const reportContentActions = {
  block_persona: '下架整个人设',
  block_release: '封禁所举报版本',
  hide_comment: '隐藏所举报评论',
  hide_profile: '隐藏公开资料',
} as const;
export function rebaseReportResolution(
  resolution: ReportResolution | undefined,
  row: AdminReport,
): ReportResolution | undefined {
  if (!resolution) return undefined;
  return {
    ...resolution,
    ...(resolution.content
      ? {
          content: {
            ...resolution.content,
            expectedRevision:
              resolution.content.action === 'block_persona'
                ? (row.moderation.persona?.revision ?? resolution.content.expectedRevision)
                : resolution.content.action === 'block_release'
                  ? (row.moderation.release?.revision ?? resolution.content.expectedRevision)
                  : resolution.content.action === 'hide_profile'
                    ? (row.moderation.profile?.revision ?? resolution.content.expectedRevision)
                    : (row.moderation.comment?.revision ?? resolution.content.expectedRevision),
          },
        }
      : {}),
    ...(resolution.account
      ? {
          account: {
            ...resolution.account,
            expectedSecurityVersion: row.moderation.account.securityVersion,
          },
        }
      : {}),
  };
}
