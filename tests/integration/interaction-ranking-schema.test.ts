import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDatabase } from '@personamarket/database';
import { SubmissionResponseSchema } from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

it('新旧算法可共存，点赞收藏三种窗口入库，旧算法不能伪造互动榜', async () => {
  const legacy = randomUUID(),
    current = randomUUID();
  for (const [id, algorithm] of [
    [legacy, 'exports-v1'],
    [current, 'interactions-v1'],
  ])
    await stack.owner.pool.query(
      'INSERT INTO ranking_generations(id,request_key,algorithm) VALUES($1,$2,$3)',
      [id, 'schema:' + randomUUID(), algorithm],
    );
  for (const kind of ['likes', 'favorites']) {
    for (const window of ['7d', '30d', 'all'])
      await stack.owner.pool.query(
        'INSERT INTO ranking_boards(generation_id,kind,"window",platform,entry_count,capped) VALUES($1,$2,$3,\'all\',0,false)',
        [current, kind, window],
      );
    await expect(
      stack.owner.pool.query(
        "INSERT INTO ranking_boards(generation_id,kind,\"window\",platform,entry_count,capped) VALUES($1,$2,'7d','all',0,false)",
        [legacy, kind],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  }
  expect(
    (
      await stack.owner.pool.query(
        'SELECT count(*)::int AS total FROM ranking_boards WHERE generation_id=$1',
        [current],
      )
    ).rows,
  ).toEqual([{ total: 6 }]);
  await expect(
    stack.owner.pool.query(
      "UPDATE ranking_generations SET algorithm='interactions-v1' WHERE id=$1",
      [legacy],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query(
      "UPDATE ranking_boards SET kind='downloads' WHERE generation_id=$1 AND kind='likes' AND \"window\"='7d'",
      [current],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query(
      "INSERT INTO ranking_boards(generation_id,kind,\"window\",platform,entry_count,capped) VALUES($1,'likes','365d','all',0,false)",
      [current],
    ),
  ).rejects.toMatchObject({ code: '23514', constraint: 'ranking_board_shape' });
});

async function relationship(kind: 'like' | 'favorite') {
  const author = await verifiedCreator(stack),
    viewer = await verifiedCreator(stack),
    admin = await stack.admin();
  const persona = await completePersona(author.http);
  const submitted = await author.http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: persona.revision,
      changelog: '互动首次时间约束验收',
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
          reason: '核对真实互动来源',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const path = '/api/v1/personas/' + persona.id + '/' + kind;
  expect((await viewer.http.write(path, {}, 'PUT')).status).toBe(200);
  const actor = (await viewer.http.context()).data.account,
    owner = (await author.http.context()).data.account;
  if (!actor || !owner) throw Error('缺少受控互动主体');
  return { personaId: persona.id, userId: actor.id, ownerId: owner.id, path, http: viewer.http };
}

it.each([
  { table: 'persona_likes', kind: 'like' },
  { table: 'persona_favorites', kind: 'favorite' },
] as const)(
  '$table首次关系不可改写或删后重建，真实取消重加仍保持首次时间',
  async ({ table, kind }) => {
    const fixture = await relationship(kind);
    const read = () =>
      stack.owner.pool.query<{ first_added_at: Date; active: boolean }>(
        'SELECT first_added_at,active FROM ' + table + ' WHERE user_id=$1 AND persona_id=$2',
        [fixture.userId, fixture.personaId],
      );
    const before = (await read()).rows[0];
    if (!before) throw Error('真实API未建立互动关系');
    await expect(
      stack.owner.pool.query(
        'UPDATE ' +
          table +
          " SET first_added_at=first_added_at-interval '1 hour' WHERE user_id=$1 AND persona_id=$2",
        [fixture.userId, fixture.personaId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      stack.owner.pool.query(
        'UPDATE ' + table + ' SET user_id=$3 WHERE user_id=$1 AND persona_id=$2',
        [fixture.userId, fixture.personaId, fixture.ownerId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      stack.owner.pool.query('DELETE FROM ' + table + ' WHERE user_id=$1 AND persona_id=$2', [
        fixture.userId,
        fixture.personaId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    const application = createDatabase(stack.env.DATABASE_URL);
    try {
      await expect(
        application.pool.query('DELETE FROM ' + table + ' WHERE user_id=$1 AND persona_id=$2', [
          fixture.userId,
          fixture.personaId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await application.close();
    }
    expect((await fixture.http.write(fixture.path, undefined, 'DELETE')).status).toBe(200);
    expect((await read()).rows[0]).toEqual({
      first_added_at: before.first_added_at,
      active: false,
    });
    expect((await fixture.http.write(fixture.path, {}, 'PUT')).status).toBe(200);
    expect((await read()).rows[0]).toEqual({ first_added_at: before.first_added_at, active: true });
  },
);
