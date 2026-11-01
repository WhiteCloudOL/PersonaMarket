import { and, desc, eq } from 'drizzle-orm';
import { profileDrafts, profileSubmissions, userProfiles, users } from '@personamarket/database';
import {
  ProfileContentSchema,
  ProfileSubmissionSchema,
  OwnProfileResponseSchema,
  ModerationProfileResponseSchema,
} from '@personamarket/contracts';
import { BusinessError, contentHash } from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';

export type ProfileRow = typeof userProfiles.$inferSelect;
export type ProfileSubmissionRow = typeof profileSubmissions.$inferSelect;

export function profileContent(row: {
  displayName: string;
  bio: string;
  avatarAssetId: string | null;
  links: unknown;
}) {
  return ProfileContentSchema.parse({
    displayName: row.displayName,
    bio: row.bio,
    avatarAssetId: row.avatarAssetId,
    links: row.links,
  });
}
export function profileSubmissionView(row: ProfileSubmissionRow) {
  const snapshot = profileContent(row);
  if (contentHash(snapshot) !== row.contentHash)
    throw new BusinessError('INVALID_RESPONSE', '资料快照校验失败，请联系管理员');
  return ProfileSubmissionSchema.parse({
    id: row.id,
    userId: row.userId,
    snapshot,
    draftRevision: row.draftRevision,
    revision: row.revision,
    status: row.status,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  });
}
export async function requireProfile(tx: Transaction, userId: string, lock = false) {
  const query = tx.select().from(userProfiles).where(eq(userProfiles.userId, userId));
  const [row] = await (lock ? query.for('update') : query);
  if (!row) throw new BusinessError('NOT_FOUND', '资料不存在或不可访问');
  return row;
}
export async function requireProfileSubmission(
  tx: Transaction,
  id: string,
  userId?: string,
  lock = false,
) {
  const query = tx
    .select()
    .from(profileSubmissions)
    .where(
      and(
        eq(profileSubmissions.id, id),
        userId ? eq(profileSubmissions.userId, userId) : undefined,
      ),
    );
  const [row] = await (lock ? query.for('update') : query);
  if (!row) throw new BusinessError('NOT_FOUND', '资料快照不存在或不可访问');
  return row;
}
export async function ownProfileView(tx: Transaction, userId: string, username: string) {
  const [draft] = await tx.select().from(profileDrafts).where(eq(profileDrafts.userId, userId));
  const [profile] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, userId));
  const [latest] = await tx
    .select()
    .from(profileSubmissions)
    .where(eq(profileSubmissions.userId, userId))
    .orderBy(desc(profileSubmissions.createdAt), desc(profileSubmissions.id))
    .limit(1);
  const published = profile?.publishedSubmissionId
    ? await requireProfileSubmission(tx, profile.publishedSubmissionId, userId)
    : null;
  if (published && published.status !== 'APPROVED')
    throw new BusinessError('INVALID_RESPONSE', '公开资料状态异常');
  return OwnProfileResponseSchema.parse({
    data: {
      revision: draft?.revision ?? 0,
      content: draft
        ? profileContent(draft)
        : { displayName: username, bio: '', avatarAssetId: null, links: [] },
      updatedAt: draft?.updatedAt.toISOString() ?? null,
      visibility: profile?.visibility ?? 'normal',
      moderationRevision: profile?.revision ?? 1,
      published: published ? profileSubmissionView(published) : null,
      latestSubmission: latest ? profileSubmissionView(latest) : null,
    },
  });
}
export async function moderationProfileView(tx: Transaction, id: string) {
  const row = await requireProfileSubmission(tx, id),
    profile = await requireProfile(tx, row.userId);
  const [owner] = await tx
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, row.userId));
  if (!owner) throw new BusinessError('INVALID_RESPONSE', '资料账号暂不可读取');
  return profileModerationView(row, owner, profile);
}
export function profileModerationView(
  row: ProfileSubmissionRow,
  owner: { id: string; username: string },
  profile: ProfileRow,
) {
  return ModerationProfileResponseSchema.parse({
    data: {
      ...profileSubmissionView(row),
      owner,
      currentProfile: {
        visibility: profile.visibility,
        revision: profile.revision,
        publishedSubmissionId: profile.publishedSubmissionId,
      },
    },
  });
}
