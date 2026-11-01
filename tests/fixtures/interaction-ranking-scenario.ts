import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { personaLikes, personaFavorites, rankingGenerations } from '@personamarket/database';
import { SubmissionResponseSchema, type RankingAlgorithm } from '@personamarket/contracts';
import { calculateRankingEntries } from '@personamarket/server';
import type { createAuthStack } from './auth-stack.js';
import { completePersona, verifiedCreator } from './creator.js';
import { seedRankingHistory } from './ranking-history.js';

type Stack = Awaited<ReturnType<typeof createAuthStack>>;
const day = 86_400_000;
async function publish(
  author: Awaited<ReturnType<typeof verifiedCreator>>,
  admin: Awaited<ReturnType<Stack['admin']>>,
  platform: 'maibot' | 'astrbot',
) {
  const persona = await completePersona(author.http, platform);
  const submitted = await author.http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: persona.revision,
      changelog: '真实排行事实模板',
      confirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(submitted.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await submitted.json()).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          expectedRevision: 1,
          reason: '核对两平台排行模板',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  return persona;
}

/** 发布/审核/导出走真实API，历史用户及关系是隔离库SQL夹具，不用于运营截图 */
export async function interactionRankingScenario(stack: Stack) {
  const author = await verifiedCreator(stack),
    reader = await verifiedCreator(stack),
    admin = await stack.admin();
  const ownerId = (await author.http.context()).data.account?.id,
    readerId = (await reader.http.context()).data.account?.id;
  if (!ownerId || !readerId) throw Error('缺少实际受控用户');
  const maiTemplate = await publish(author, admin, 'maibot'),
    astrTemplate = await publish(author, admin, 'astrbot');
  const historyAt = Date.now();
  const client = await stack.owner.pool.connect();
  let mai: Awaited<ReturnType<typeof seedRankingHistory>>,
    astr: Awaited<ReturnType<typeof seedRankingHistory>>;
  try {
    mai = await seedRankingHistory(
      client,
      maiTemplate.id,
      new Date(historyAt - 100 * day),
      new Date(historyAt - day),
    );
    astr = await seedRankingHistory(
      client,
      astrTemplate.id,
      new Date(historyAt - 100 * day),
      new Date(historyAt - day),
    );
  } finally {
    client.release();
  }
  const download = await reader.http.raw(
    '/api/v1/personas/' + mai.id + '/releases/' + mai.releaseId + '/export?format=text',
  );
  expect(download.status).toBe(200);
  await download.arrayBuffer();
  const at = (await stack.owner.pool.query<{ at: Date }>('SELECT clock_timestamp() AS at')).rows[0]
    ?.at;
  if (!at) throw Error('缺少数据库计算时刻');
  const prefix = 'history_' + randomUUID().replaceAll('-', '').slice(0, 12) + '_';
  const actors = (
    await stack.owner.pool.query<{ id: string; username: string }>(
      `INSERT INTO users(username,email,password_hash,email_verified_at,created_at,updated_at)
    SELECT $1||lpad(n::text,2,'0'),$1||lpad(n::text,2,'0')||'@fixture.invalid',u.password_hash,$3::timestamptz-interval '120 days',$3::timestamptz-interval '120 days',$3::timestamptz-interval '120 days'
    FROM users u CROSS JOIN generate_series(0,11) n WHERE u.id=$2 RETURNING id,username`,
      [prefix, readerId, at],
    )
  ).rows.sort((a, b) => a.username.localeCompare(b.username));
  expect(actors).toHaveLength(12);
  const actor = (index: number) => {
    const value = actors[index];
    if (!value) throw Error('缺少历史关系主体');
    return value;
  };
  const relation = (userId: string, personaId: string, days: number, offset = 0, active = true) => {
    const firstAddedAt = new Date(at.getTime() - days * day + offset);
    return { userId, personaId, active, firstAddedAt, updatedAt: firstAddedAt };
  };
  await stack.owner.db
    .insert(personaLikes)
    .values([
      relation(ownerId, mai.id, 1),
      relation(actor(0).id, mai.id, 1),
      relation(actor(1).id, mai.id, 8),
      relation(actor(2).id, mai.id, 40),
      relation(actor(3).id, mai.id, 0, -3_600_000, false),
      relation(actor(4).id, mai.id, 0, 3_600_000),
      relation(ownerId, astr.id, 1),
      relation(actor(5).id, astr.id, 3.5),
      relation(actor(7).id, astr.id, 7, -1),
      relation(actor(10).id, astr.id, 0),
      relation(actor(11).id, astr.id, 0, 1),
    ]);
  await stack.owner.db
    .insert(personaFavorites)
    .values([
      relation(ownerId, mai.id, 1),
      relation(actor(0).id, mai.id, 2),
      relation(actor(1).id, mai.id, 10),
      relation(actor(2).id, mai.id, 40),
      relation(actor(3).id, mai.id, 0, -3_600_000, false),
      relation(actor(4).id, mai.id, 0, 3_600_000),
      relation(ownerId, astr.id, 1),
      relation(actor(6).id, astr.id, 7),
      relation(actor(8).id, astr.id, 30),
      relation(actor(9).id, astr.id, 30, -1),
    ]);
  const exportAt = (
    await stack.owner.pool.query<{ created_at: Date }>(
      'SELECT created_at FROM export_subject_days WHERE persona_id=$1 AND ranking_eligible',
      [mai.id],
    )
  ).rows[0]?.created_at;
  if (!exportAt) throw Error('缺少实际有效导出');
  return { author, reader, admin, mai, astr, at, actor, actors, exportAt };
}

/** 使用Worker相同的计算服务和真实事务，固定时刻验证毫秒边界而不篡改数据库时钟 */
export async function rankingSnapshotAt(
  stack: Stack,
  at: Date,
  algorithm: RankingAlgorithm = 'interactions-v1',
) {
  const id = randomUUID();
  await stack.owner.db.transaction(async (tx) => {
    await tx
      .insert(rankingGenerations)
      .values({ id, requestKey: 'fixture:' + randomUUID(), algorithm, requestedAt: at });
    await calculateRankingEntries(tx, id, at, algorithm);
    await tx
      .update(rankingGenerations)
      .set({ status: 'completed', generatedAt: at })
      .where(eq(rankingGenerations.id, id));
  });
  return id;
}
