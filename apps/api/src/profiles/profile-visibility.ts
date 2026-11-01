import { eq } from 'drizzle-orm';
import { userProfiles } from '@personamarket/database';
import type { SetProfileVisibility } from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import type { ProfileRow } from './profile-views.js';
import { recordProfileAction } from './profile-transactions.js';

/** 调用者已锁定身份、目标账号和资料；举报处置复用同一事务能力 */
export async function persistProfileVisibility(
  tx: Transaction,
  actor: Identity,
  row: ProfileRow,
  input: Pick<SetProfileVisibility, 'hidden' | 'expectedRevision' | 'reason'>,
  requestId: string,
  selfReview: boolean,
) {
  if (row.revision !== input.expectedRevision)
    throw new BusinessError('REVISION_CONFLICT', '资料公开状态已变化，请核对最新修订');
  const visibility = input.hidden ? 'hidden' : 'normal';
  if (row.visibility === visibility) throw new BusinessError('CONFLICT', '资料已经处于所选状态');
  await tx
    .update(userProfiles)
    .set({ visibility, revision: row.revision + 1 })
    .where(eq(userProfiles.userId, row.userId));
  const recordId = await recordProfileAction(tx, {
    userId: row.userId,
    submissionId: row.publishedSubmissionId,
    actorId: actor.account.id,
    action: input.hidden ? 'hide' : 'restore',
    reason: input.reason,
    selfReview,
    fromProfileRevision: row.revision,
    toProfileRevision: row.revision + 1,
    requestId,
  });
  return {
    userId: row.userId,
    visibility,
    revision: row.revision + 1,
    recordId,
    resourceId: row.userId,
    beforeRevision: row.revision,
    afterRevision: row.revision + 1,
  };
}
