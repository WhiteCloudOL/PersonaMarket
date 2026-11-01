import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNotNull } from 'drizzle-orm';
import {
  assets,
  profileRecords,
  profileSubmissions,
  userProfiles,
  users,
  type Database,
} from '@personamarket/database';
import {
  ProfileHistoryResponseSchema,
  ProfileRecordsResponseSchema,
  ProfileSubmissionResponseSchema,
  ModerationProfilesResponseSchema,
  PublicCreatorResponseSchema,
  type ProfileHistoryQuery,
  type ProfileModerationQuery,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { lockIdentity } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import {
  moderationProfileView,
  profileModerationView,
  ownProfileView,
  profileSubmissionView,
  requireProfileSubmission,
} from './profile-views.js';
import { requireProfileModerator } from './profile-transactions.js';

@Injectable()
export class ProfilesReadRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  async publicOwner(username: string) {
    const [owner] = await this.database.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(and(eq(users.username, username), eq(users.status, 'active')))
      .limit(1);
    if (!owner) throw new BusinessError('NOT_FOUND', '创作者不存在或暂不可访问');
    return owner;
  }
  records(actor: Identity, input: ProfileHistoryQuery, userId?: string) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const identity = await lockIdentity(tx, actor, false, false);
        if (userId) requireProfileModerator(identity.account.role);
        const subject = userId ?? identity.account.id;
        const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, subject));
        if (!owner) throw new BusinessError('NOT_FOUND', '资料账号不存在或不可访问');
        const condition = eq(profileRecords.userId, subject);
        const rows = await tx
          .select({
            id: profileRecords.id,
            submissionId: profileRecords.submissionId,
            actor: { id: users.id, username: users.username },
            action: profileRecords.action,
            reason: profileRecords.reason,
            selfReview: profileRecords.selfReview,
            fromProfileRevision: profileRecords.fromProfileRevision,
            toProfileRevision: profileRecords.toProfileRevision,
            createdAt: profileRecords.createdAt,
          })
          .from(profileRecords)
          .innerJoin(users, eq(users.id, profileRecords.actorId))
          .where(condition)
          .orderBy(desc(profileRecords.createdAt), desc(profileRecords.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize);
        const [total] = await tx.select({ value: count() }).from(profileRecords).where(condition);
        return ProfileRecordsResponseSchema.parse({
          data: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
          meta: { ...input, total: total?.value ?? 0 },
        });
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
  own(actor: Identity) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const identity = await lockIdentity(tx, actor, false, false);
        return ownProfileView(tx, identity.account.id, identity.account.username);
      },
      { area: 'content' },
    );
  }
  submission(actor: Identity, id: string) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const identity = await lockIdentity(tx, actor, false, false);
        return ProfileSubmissionResponseSchema.parse({
          data: profileSubmissionView(await requireProfileSubmission(tx, id, identity.account.id)),
        });
      },
      { area: 'content' },
    );
  }
  history(actor: Identity, input: ProfileHistoryQuery) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const identity = await lockIdentity(tx, actor, false, false),
          condition = eq(profileSubmissions.userId, identity.account.id);
        const rows = await tx
          .select()
          .from(profileSubmissions)
          .where(condition)
          .orderBy(desc(profileSubmissions.createdAt), desc(profileSubmissions.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize);
        const [total] = await tx
          .select({ value: count() })
          .from(profileSubmissions)
          .where(condition);
        return ProfileHistoryResponseSchema.parse({
          data: rows.map(profileSubmissionView),
          meta: { ...input, total: total?.value ?? 0 },
        });
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
  admin(actor: Identity, id: string) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const identity = await lockIdentity(tx, actor, false, false);
        requireProfileModerator(identity.account.role);
        return moderationProfileView(tx, id);
      },
      { area: 'content' },
    );
  }
  adminList(actor: Identity, input: ProfileModerationQuery) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const identity = await lockIdentity(tx, actor, false, false);
        requireProfileModerator(identity.account.role);
        const condition = and(
          input.status === 'all' ? undefined : eq(profileSubmissions.status, input.status),
          input.username ? eq(users.username, input.username) : undefined,
        );
        const rows = await tx
          .select({
            submission: profileSubmissions,
            owner: { id: users.id, username: users.username },
            profile: userProfiles,
          })
          .from(profileSubmissions)
          .innerJoin(users, eq(users.id, profileSubmissions.userId))
          .innerJoin(userProfiles, eq(userProfiles.userId, profileSubmissions.userId))
          .where(condition)
          .orderBy(desc(profileSubmissions.createdAt), desc(profileSubmissions.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize);
        const [total] = await tx
          .select({ value: count() })
          .from(profileSubmissions)
          .innerJoin(users, eq(users.id, profileSubmissions.userId))
          .where(condition);
        const data = rows.map(
          (row) => profileModerationView(row.submission, row.owner, row.profile).data,
        );
        return ModerationProfilesResponseSchema.parse({
          data,
          meta: { page: input.page, pageSize: input.pageSize, total: total?.value ?? 0 },
        });
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
  async creator(username: string) {
    const [row] = await this.database.db
      .select({
        id: users.id,
        username: users.username,
        verified: users.emailVerifiedAt,
        visibility: userProfiles.visibility,
        updatedAt: userProfiles.updatedAt,
        submission: profileSubmissions,
      })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .leftJoin(
        profileSubmissions,
        and(
          eq(profileSubmissions.id, userProfiles.publishedSubmissionId),
          eq(profileSubmissions.userId, users.id),
          eq(profileSubmissions.status, 'APPROVED'),
        ),
      )
      .where(and(eq(users.username, username), eq(users.status, 'active')))
      .limit(1);
    if (!row) throw new BusinessError('NOT_FOUND', '创作者不存在或暂不可访问');
    const published = row.verified && row.visibility === 'normal' ? row.submission : null;
    const snapshot = published ? profileSubmissionView(published).snapshot : null;
    return PublicCreatorResponseSchema.parse({
      data: {
        id: row.id,
        username: row.username,
        displayName: snapshot?.displayName ?? row.username,
        bio: snapshot?.bio ?? '',
        links: snapshot?.links ?? [],
        avatarUrl:
          snapshot?.avatarAssetId && published
            ? '/api/v1/users/' + row.username + '/avatar/' + published.id
            : null,
        approvedRevisionId: published?.id ?? null,
        updatedAt: published ? (row.updatedAt?.toISOString() ?? null) : null,
      },
    });
  }
  async publicAvatar(username: string, submissionId: string) {
    const [row] = await this.database.db
      .select({ storageKey: assets.storageKey })
      .from(users)
      .innerJoin(
        userProfiles,
        and(eq(userProfiles.userId, users.id), eq(userProfiles.visibility, 'normal')),
      )
      .innerJoin(
        profileSubmissions,
        and(
          eq(profileSubmissions.id, userProfiles.publishedSubmissionId),
          eq(profileSubmissions.id, submissionId),
          eq(profileSubmissions.userId, users.id),
          eq(profileSubmissions.status, 'APPROVED'),
        ),
      )
      .innerJoin(
        assets,
        and(
          eq(assets.id, profileSubmissions.avatarAssetId),
          eq(assets.ownerId, users.id),
          eq(assets.purpose, 'avatar'),
        ),
      )
      .where(
        and(
          eq(users.username, username),
          eq(users.status, 'active'),
          isNotNull(users.emailVerifiedAt),
        ),
      )
      .limit(1);
    if (!row) throw new BusinessError('NOT_FOUND', '头像不存在或暂不可访问');
    return row.storageKey;
  }
  adminAvatar(actor: Identity, id: string) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const identity = await lockIdentity(tx, actor, false, false);
        requireProfileModerator(identity.account.role);
        const row = await requireProfileSubmission(tx, id);
        if (!row.avatarAssetId) throw new BusinessError('NOT_FOUND', '这份资料没有头像');
        const [asset] = await tx
          .select({ storageKey: assets.storageKey })
          .from(assets)
          .where(
            and(
              eq(assets.id, row.avatarAssetId),
              eq(assets.ownerId, row.userId),
              eq(assets.purpose, 'avatar'),
            ),
          );
        if (!asset) throw new BusinessError('NOT_FOUND', '头像不存在或不可访问');
        return asset.storageKey;
      },
      { area: 'content' },
    );
  }
}
