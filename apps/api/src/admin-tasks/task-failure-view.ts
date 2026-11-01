import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AdminTaskFailureSchema } from '@personamarket/contracts';

export const taskFailureRecordSchema = z.strictObject({
  source: AdminTaskFailureSchema.shape.source,
  id: AdminTaskFailureSchema.shape.id,
  category: AdminTaskFailureSchema.shape.category,
  stage: AdminTaskFailureSchema.shape.stage,
  error_code: AdminTaskFailureSchema.shape.errorCode,
  execution_attempts: AdminTaskFailureSchema.shape.executionAttempts,
  dispatch_attempts: AdminTaskFailureSchema.shape.dispatchAttempts,
  created_at: z.coerce.date(),
  event_id: AdminTaskFailureSchema.shape.eventId,
  facts: z.record(z.string(), z.unknown()),
});
export function taskFailureVersion(row: z.infer<typeof taskFailureRecordSchema>) {
  return createHash('sha256')
    .update(JSON.stringify([row.source, row.id, row.facts]))
    .digest('hex');
}
