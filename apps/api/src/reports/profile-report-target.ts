import { and, eq, isNotNull } from 'drizzle-orm';
import { profileSubmissions, users } from '@personamarket/database';
import { ProfileReportSnapshotSchema } from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';
import { requireProfile, profileSubmissionView } from '../profiles/profile-views.js';

/** 精确绑定举报人见到的获批版本，不能把私有待审版本或更新后的资料自动代入 */
export async function publicProfileReportSnapshot(
  tx: Transaction,
  userId: string,
  submissionId: string,
  lock = false,
) {
  const profile = await requireProfile(tx, userId, lock);
  if (profile.visibility !== 'normal' || profile.publishedSubmissionId !== submissionId)
    throw new BusinessError('NOT_FOUND', '举报资料不存在或暂不可公开');
  const [row] = await tx
    .select({ submission: profileSubmissions, username: users.username })
    .from(profileSubmissions)
    .innerJoin(users, eq(users.id, profileSubmissions.userId))
    .where(
      and(
        eq(profileSubmissions.id, submissionId),
        eq(profileSubmissions.userId, userId),
        eq(profileSubmissions.status, 'APPROVED'),
        eq(users.status, 'active'),
        isNotNull(users.emailVerifiedAt),
      ),
    );
  if (!row) throw new BusinessError('NOT_FOUND', '举报资料不存在或暂不可公开');
  const content = profileSubmissionView(row.submission).snapshot;
  return ProfileReportSnapshotSchema.parse({
    type: 'profile',
    title: content.displayName,
    author: { id: userId, username: row.username },
    profile: { userId, submissionId, content },
  });
}
