import { z } from 'zod';

export const CommentSettingsSchema = z.strictObject({
  commentsEnabled: z.boolean(),
  showExistingComments: z.boolean(),
  commentReviewMode: z.enum(['all', 'off']),
  commentMaxLength: z.number().int().min(1).max(2000),
  commentsPerMinute: z.number().int().min(1).max(30),
});
export const defaultCommentSettings = {
  commentsEnabled: true,
  showExistingComments: true,
  commentReviewMode: 'all',
  commentMaxLength: 2000,
  commentsPerMinute: 5,
} as const;
export type CommentSettings = z.infer<typeof CommentSettingsSchema>;
