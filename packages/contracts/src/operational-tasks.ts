import { z } from 'zod';
import { IdSchema } from './common.js';
import { AdminTaskReasonSchema } from './admin-tasks.js';
export const OperationalTaskPathSchema = z.strictObject({
  kind: z.enum(['storage', 'mail']),
  id: IdSchema,
});
export const OperationalTaskCommandSchema = z.strictObject({
  action: z.enum(['retry', 'acknowledge']),
  expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
  reason: AdminTaskReasonSchema,
  confirmed: z.literal(true),
});
const ActionSchema = z.strictObject({
  id: IdSchema,
  action: z.enum(['retry', 'acknowledge']),
  eventId: IdSchema.nullable(),
  actorId: IdSchema,
  reason: z.string().max(500),
  recordedAt: z.iso.datetime(),
});
export const OperationalTaskDetailResponseSchema = z.strictObject({
  data: z.strictObject({
    kind: z.enum(['storage', 'mail']),
    id: IdSchema,
    eventId: IdSchema,
    status: z.enum([
      'pending',
      'deleted',
      'missing',
      'protected',
      'failed',
      'unrecorded',
      'sent',
      'sending',
      'uncertain',
    ]),
    targetFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    checkedAt: z.iso.datetime().nullable(),
    executionAttempts: z.number().int().nonnegative().nullable(),
    context: z
      .strictObject({
        purpose: z.enum([
          'email_verify',
          'password_reset',
          'email_change',
          'security_notice',
          'review_notice',
        ]),
        userId: IdSchema.nullable(),
        tokenLinked: z.boolean(),
        sourceId: IdSchema.nullable(),
        sourceType: z.enum(['account', 'persona', 'profile_submission', 'auth_audit']),
        state: z.enum([
          'valid',
          'account_unavailable',
          'recipient_changed',
          'token_missing',
          'token_expired',
          'token_consumed',
          'token_mismatch',
        ]),
        expiresAt: z.iso.datetime().nullable(),
      })
      .nullable(),
    canRetry: z.boolean(),
    blockedReason: z.string().max(200),
    nextAllowedAt: z.iso.datetime().nullable(),
    manualAttempts: z.number().int().min(0).max(3),
    disposition: ActionSchema.nullable(),
    history: z.array(ActionSchema).max(20),
    version: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  meta: z.strictObject({ observedAt: z.iso.datetime() }),
});
export const OperationalTaskActionResponseSchema = z.strictObject({ data: ActionSchema });
export const OperationalTaskReceiptResponseSchema = z.strictObject({
  data: z.strictObject({ recorded: z.boolean(), record: ActionSchema.nullable() }),
});
export type OperationalTaskPath = z.infer<typeof OperationalTaskPathSchema>;
export type OperationalTaskCommand = z.infer<typeof OperationalTaskCommandSchema>;
export type OperationalTaskDetail = z.infer<typeof OperationalTaskDetailResponseSchema>['data'];
