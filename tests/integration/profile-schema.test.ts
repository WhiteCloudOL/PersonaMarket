import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

const snapshotSql = `INSERT INTO profile_submissions
  (user_id,draft_revision,display_name,bio,avatar_asset_id,links,content_hash)
  SELECT user_id,revision,display_name,bio,avatar_asset_id,links,$2 FROM profile_drafts
  WHERE user_id=$1 RETURNING id`;
const digest = 'a'.repeat(64);

it('资料数据库保护头像归属、不可变快照、获批指针与下架恢复的单调修订', async () => {
  const creator = await verifiedCreator(stack),
    other = await verifiedCreator(stack);
  const ownerId = (await creator.http.context()).data.account?.id,
    otherId = (await other.http.context()).data.account?.id;
  const administrator = await createAdministrator(stack.owner, {
    username: 'reviewer_' + randomUUID().replaceAll('-', '').slice(0, 12),
    email: randomUUID() + '@fixture.invalid',
    password: 'Isolated SQL validation passphrase 2026',
  });
  const asset = async (userId: string | undefined, purpose: string) => {
    // 此用例只验证SQL归属约束；真实图片上传与公开读取另以HTTP流程验收
    const result = await stack.owner.pool.query<{ id: string }>(
      `INSERT INTO assets(owner_id,purpose,storage_key,mime,bytes,width,height,sha256)
       VALUES($1,$2,$3,'image/webp',1,1,1,$4) RETURNING id`,
      [userId, purpose, randomUUID().replaceAll('-', '') + '.webp', digest],
    );
    return result.rows[0]?.id;
  };
  const ownAvatar = await asset(ownerId, 'avatar'),
    otherAvatar = await asset(otherId, 'avatar'),
    privateEvidence = await asset(ownerId, 'evidence');
  await stack.owner.pool.query('INSERT INTO user_profiles(user_id) VALUES($1)', [ownerId]);
  await stack.owner.pool.query(
    "INSERT INTO profile_drafts(user_id,display_name,bio) VALUES($1,'资料作者','原始简介')",
    [ownerId],
  );
  for (const avatarId of [otherAvatar, privateEvidence])
    await expect(
      stack.owner.pool.query(
        'UPDATE profile_drafts SET avatar_asset_id=$2,revision=revision+1 WHERE user_id=$1',
        [ownerId, avatarId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query(
      'UPDATE profile_drafts SET user_id=$2,revision=revision+1 WHERE user_id=$1',
      [ownerId, otherId],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await stack.owner.pool.query(
    'UPDATE profile_drafts SET avatar_asset_id=$2,revision=revision+1 WHERE user_id=$1',
    [ownerId, ownAvatar],
  );
  const submitted = await stack.owner.pool.query<{ id: string }>(snapshotSql, [ownerId, digest]),
    id = submitted.rows[0]?.id;
  await expect(
    stack.owner.pool.query("UPDATE profile_submissions SET bio='伪造修改' WHERE id=$1", [id]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query(
      'UPDATE user_profiles SET published_submission_id=$2,revision=revision+1 WHERE user_id=$1',
      [ownerId, id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await stack.owner.pool.query(
    "UPDATE profile_submissions SET status='APPROVED',revision=revision+1,reason='',reviewed_by=$2,reviewed_at=clock_timestamp() WHERE id=$1",
    [id, administrator.id],
  );
  await stack.owner.pool.query(
    'UPDATE user_profiles SET published_submission_id=$2,revision=revision+1 WHERE user_id=$1',
    [ownerId, id],
  );
  await expect(
    stack.owner.pool.query(
      "UPDATE profile_submissions SET status='REJECTED',revision=revision+1,reason='改写已审结论' WHERE id=$1",
      [id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await stack.owner.pool.query(
    "UPDATE user_profiles SET visibility='hidden',revision=revision+1 WHERE user_id=$1",
    [ownerId],
  );
  await stack.owner.pool.query(
    "UPDATE user_profiles SET visibility='normal',revision=revision+1 WHERE user_id=$1",
    [ownerId],
  );
  const current = await stack.owner.pool.query<{
    revision: number;
    published_submission_id: string;
  }>('SELECT revision,published_submission_id FROM user_profiles WHERE user_id=$1', [ownerId]);
  expect(current.rows[0]).toEqual({ revision: 4, published_submission_id: id });
  await expect(
    stack.owner.pool.query(
      "UPDATE user_profiles SET visibility='hidden',revision=2 WHERE user_id=$1",
      [ownerId],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query('DELETE FROM profile_submissions WHERE id=$1', [id]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query('DELETE FROM profile_drafts WHERE user_id=$1', [ownerId]),
  ).rejects.toMatchObject({ code: '23514' });
});

it('资料CAS和单份待审数据库约束能承受并发，审核记录只追加且应用不能删除历史', async () => {
  const creator = await verifiedCreator(stack),
    ownerId = (await creator.http.context()).data.account?.id;
  await stack.owner.pool.query('INSERT INTO user_profiles(user_id) VALUES($1)', [ownerId]);
  await stack.owner.pool.query(
    "INSERT INTO profile_drafts(user_id,display_name) VALUES($1,'并发作者')",
    [ownerId],
  );
  const writes = await Promise.all(
    ['一', '二'].map((bio) =>
      stack.owner.pool.query(
        'UPDATE profile_drafts SET bio=$2,revision=revision+1 WHERE user_id=$1 AND revision=1 RETURNING revision',
        [ownerId, bio],
      ),
    ),
  );
  expect(writes.map((result) => result.rowCount).sort()).toEqual([0, 1]);
  const pending = await Promise.allSettled([
    stack.owner.pool.query<{ id: string }>(snapshotSql, [ownerId, digest]),
    stack.owner.pool.query<{ id: string }>(snapshotSql, [ownerId, digest]),
  ]);
  expect(pending.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const conflict = pending.find((result) => result.status === 'rejected');
  expect(conflict?.status === 'rejected' ? conflict.reason : undefined).toMatchObject({
    code: '23505',
    constraint: 'one_pending_profile_per_owner',
  });
  const success = pending.find((result) => result.status === 'fulfilled'),
    submissionId = success?.status === 'fulfilled' ? success.value.rows[0]?.id : undefined;
  const record = await stack.owner.pool.query<{ id: string }>(
    "INSERT INTO profile_records(user_id,submission_id,actor_id,action,from_profile_revision,to_profile_revision,request_id) VALUES($1,$2,$1,'submit',1,1,$3) RETURNING id",
    [ownerId, submissionId, randomUUID()],
  );
  const recordId = record.rows[0]?.id;
  await expect(
    stack.owner.pool.query("UPDATE profile_records SET reason='篡改记录' WHERE id=$1", [recordId]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query('DELETE FROM profile_records WHERE id=$1', [recordId]),
  ).rejects.toMatchObject({ code: '23514' });
  const application = createDatabase(stack.env.DATABASE_URL);
  try {
    for (const table of [
      'profile_drafts',
      'profile_submissions',
      'user_profiles',
      'profile_records',
    ]) {
      const permissions = await application.pool.query<{ allowed: boolean }>(
        "SELECT has_table_privilege(current_user,$1,'DELETE') AS allowed",
        [table],
      );
      expect(permissions.rows[0]?.allowed).toBe(false);
    }
    await expect(
      application.pool.query('UPDATE profile_records SET reason=$2 WHERE id=$1', [
        recordId,
        '应用越权',
      ]),
    ).rejects.toMatchObject({ code: '42501' });
  } finally {
    await application.close();
  }
});
