import { z } from 'zod';
import {
  IdSchema,
  ReviewDeactivationRequestSchema,
  SetAdminUserRoleSchema,
  UserRoleSchema,
} from '@personamarket/contracts';

export const ActionSchema = z.enum(['role', 'ban', 'restore', 'sessions', 'deactivation']);
export const FormSchema = z
  .strictObject({
    action: ActionSchema,
    role: UserRoleSchema,
    scope: z.enum(['account_only', 'account_and_personas']),
    applicationId: z.union([IdSchema, z.literal('')]),
    decision: ReviewDeactivationRequestSchema.shape.decision,
    reason: SetAdminUserRoleSchema.shape.reason,
    confirmed: z.boolean().refine((value) => value, '请先核对账号与影响范围'),
  })
  .superRefine((value, context) => {
    if (value.action === 'deactivation' && !value.applicationId)
      context.addIssue({
        code: 'custom',
        path: ['applicationId'],
        message: '请选择待处理的停用申请',
      });
  });
export type UserManagementValues = z.infer<typeof FormSchema>;
