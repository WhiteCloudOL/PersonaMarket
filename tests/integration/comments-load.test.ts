import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  AdminCommentResponseSchema,
  CommentResponseSchema,
  CommentModerationResponseSchema,
  OwnCommentsResponseSchema,
  PublicCommentsResponseSchema,
  SubmissionResponseSchema,
} from '@personamarket/contracts';
import {
  buildModerationCommentQueries,
  buildOwnCommentQueries,
  buildPublicCommentQueries,
} from '@personamarket/api/testing';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';
import { seedSearchLoad } from '../fixtures/search-load.js';
import { seedCommentLoad } from '../fixtures/comment-load.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import type { z } from 'zod';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
let writer: Awaited<ReturnType<typeof verifiedCreator>>;
let reviewer: Awaited<ReturnType<Awaited<ReturnType<typeof createAuthStack>>['admin']>>;
const works: string[] = [];
let root: z.infer<typeof CommentResponseSchema>['data'];
let reply: z.infer<typeof CommentResponseSchema>['data'];
let pending: z.infer<typeof CommentResponseSchema>['data'];
const samples: Array<{ operation: string; milliseconds: number; status: number }> = [];
const directory = 'data/tests/comments/load';

async function comment(body: string, parentId?: string) {
  const response = await writer.http.write(
    '/api/v1/personas/' + works[0] + '/comments',
    { body, ...(parentId ? { parentId, replyToId: parentId } : {}) },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status).toBe(200);
  return CommentResponseSchema.parse(await response.json()).data;
}
async function approve(row: typeof root) {
  const response = await reviewer.http.write(
    '/api/v1/admin/comments/' + row.id + '/review',
    { decision: 'approve', revisionId: row.latest.id, expectedRevision: row.revision },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status).toBe(200);
  return AdminCommentResponseSchema.parse(await response.json()).data;
}

beforeAll(async () => {
  stack = await createAuthStack();
  writer = await verifiedCreator(stack);
  reviewer = await stack.admin();
  for (const platform of ['maibot', 'astrbot'] as const) {
    const persona = await completePersona(writer.http, platform);
    const response = await writer.http.write(
      '/api/v1/me/personas/' + persona.id + '/releases',
      {
        version: '1.0.0',
        expectedDraftRevision: persona.revision,
        changelog: '评论容量基准',
        confirmed: true,
      },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(response.status).toBe(200);
    const submission = SubmissionResponseSchema.parse(await response.json()).data;
    expect(
      (
        await reviewer.http.write(
          '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
          {
            action: 'approve',
            expectedRevision: submission.revision,
            reason: '核验隔离容量样本',
            selfReviewConfirmed: false,
          },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
    ).toBe(200);
    works.push(persona.id);
  }
  root = await comment('公开长文本与无空格URL容量样本 '.repeat(60));
  await approve(root);
  reply = await comment('热点楼层回复容量样本 '.repeat(50), root.id);
  await approve(reply);
  pending = await comment('审核队列私有长文本容量样本 '.repeat(60));
});

// 准备步骤分成固定1000条批次，每批独立事务并受现有SQL与hook预算限制
for (let platform = 0; platform < 2; platform++)
  for (let batch = 0; batch < 5; batch++)
    beforeAll(async () => {
      const template = works[platform];
      if (!template) throw new Error('缺少容量作品基准');
      const client = await stack.owner.pool.connect();
      try {
        await seedSearchLoad(client, template, 1000);
      } finally {
        client.release();
      }
    });

for (let batch = 0; batch < 50; batch++)
  beforeAll(async () => {
    const template = batch < 5 ? root : batch < 10 ? reply : batch < 20 ? pending : root;
    const client = await stack.owner.pool.connect();
    try {
      await seedCommentLoad(client, template.id, 1000, batch >= 20, Math.max(0, batch - 20) * 1000);
    } finally {
      client.release();
    }
  });

beforeAll(async () => {
  for (const table of [
    'comments',
    'comment_revisions',
    'comment_moderation_records',
    'personas',
    'users',
  ])
    await stack.owner.pool.query('ANALYZE ' + table);
});
afterAll(async () => {
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(directory + '/samples.json', JSON.stringify({ samples }, null, 2));
    const operations = [...new Set(samples.map((sample) => sample.operation))];
    const summary = operations.map((operation) => {
      const current = samples.filter((sample) => sample.operation === operation);
      const sorted = current.map((sample) => sample.milliseconds).sort((a, b) => a - b);
      return {
        operation,
        requests: current.length,
        failures: current.filter((sample) => sample.status !== 200).length,
        p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
      };
    });
    if (stack)
      await writeFile(
        directory + '/summary.json',
        JSON.stringify(
          {
            environment: {
              node: process.version,
              logicalCpus: cpus().length,
              memoryBytes: totalmem(),
              database: (await stack.owner.pool.query('SELECT version() AS version')).rows[0]
                ?.version,
            },
            concurrency: 2,
            samples: summary,
          },
          null,
          2,
        ),
      );
  } finally {
    await stack?.close();
  }
});

it('一万作品和五万评论同库保持真实约束，公开与待审分页互不泄露', async () => {
  const counts = await stack.owner.pool.query(
    `SELECT (SELECT count(*)::integer FROM personas) AS personas,
      (SELECT count(*)::integer FROM comments) AS comments,
      (SELECT count(*)::integer FROM comment_revisions WHERE status='PENDING') AS pending,
      (SELECT count(*)::integer FROM comment_moderation_records WHERE action='approve') AS approved`,
  );
  expect(counts.rows).toEqual([
    { personas: 10002, comments: 50003, pending: 10001, approved: 40002 },
  ]);
  const path = '/api/v1/personas/' + works[0] + '/comments';
  const first = PublicCommentsResponseSchema.parse(await (await stack.browser().raw(path)).json());
  const second = PublicCommentsResponseSchema.parse(
    await (await stack.browser().raw(path + '?page=2')).json(),
  );
  expect(first.meta).toMatchObject({ total: 5001, publishedCount: 10002 });
  expect(first.data).toHaveLength(20);
  expect(second.data).toHaveLength(20);
  expect(new Set([...first.data, ...second.data].map((row) => row.id)).size).toBe(40);
  expect(JSON.stringify(first)).not.toContain(pending.latest.body);
  const replies = PublicCommentsResponseSchema.parse(
    await (await stack.browser().raw('/api/v1/comments/' + root.id + '/replies')).json(),
  );
  expect(replies.meta.total).toBe(5001);
  expect(replies.data.every((row) => row.parentId === root.id)).toBe(true);
  const queued = CommentModerationResponseSchema.parse(
    await (await reviewer.http.raw('/api/v1/admin/comments?status=PENDING')).json(),
  );
  expect(queued.meta.total).toBe(10001);
  expect(queued.data.every((row) => row.latest.status === 'PENDING')).toBe(true);
});

function loadOperations() {
  const personaId = works[0];
  if (!personaId) throw new Error('缺少热点作品');
  return [
    {
      name: 'public:first',
      client: stack.browser(),
      path: '/api/v1/personas/' + personaId + '/comments',
      schema: PublicCommentsResponseSchema,
    },
    {
      name: 'public:deep',
      client: stack.browser(),
      path: '/api/v1/personas/' + personaId + '/comments?page=251',
      schema: PublicCommentsResponseSchema,
    },
    {
      name: 'replies:deep',
      client: stack.browser(),
      path: '/api/v1/comments/' + root.id + '/replies?page=251',
      schema: PublicCommentsResponseSchema,
    },
    {
      name: 'own:deep',
      client: writer.http,
      path: '/api/v1/me/comments?personaId=' + personaId + '&page=1001',
      schema: OwnCommentsResponseSchema,
    },
    {
      name: 'moderation:first',
      client: reviewer.http,
      path: '/api/v1/admin/comments?status=PENDING',
      schema: CommentModerationResponseSchema,
    },
    {
      name: 'moderation:deep',
      client: reviewer.http,
      path: '/api/v1/admin/comments?status=PENDING&page=501',
      schema: CommentModerationResponseSchema,
    },
  ];
}
for (const name of [
  'public:first',
  'public:deep',
  'replies:deep',
  'own:deep',
  'moderation:first',
  'moderation:deep',
])
  it('容量接口并发2的p95与失败率：' + name, async () => {
    const operation = loadOperations().find((item) => item.name === name);
    if (!operation) throw new Error('缺少容量接口');
    async function read(name: string, client: AuthHttp, path: string) {
      const start = performance.now();
      let response: Response;
      let body: unknown;
      try {
        response = await client.raw(path);
        body = await response.json();
      } catch (cause) {
        samples.push({ operation: name, milliseconds: performance.now() - start, status: 0 });
        throw cause;
      }
      samples.push({
        operation: name,
        milliseconds: performance.now() - start,
        status: response.status,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      return body;
    }
    for (let pair = 0; pair < 6; pair++) {
      const bodies = await Promise.all([
        read(operation.name, operation.client, operation.path),
        read(operation.name, operation.client, operation.path),
      ]);
      for (const body of bodies) operation.schema.parse(body);
    }
    const current = samples.filter((sample) => sample.operation === name);
    const sorted = current.map((sample) => sample.milliseconds).sort((a, b) => a - b);
    expect(current).toHaveLength(12);
    expect(current.filter((sample) => sample.status !== 200)).toHaveLength(0);
    expect(
      sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Infinity,
      name + ' 本机指定并发下p95应小于500ms',
    ).toBeLessThan(500);
  });

it('保存API实际执行的查询计划，包含热点计数、深分页与待审队列', async () => {
  const personaId = works[0];
  const accountId = (await writer.http.context()).data.account?.id;
  if (!personaId || !accountId) throw new Error('缺少容量查询身份');
  const publicQueries = buildPublicCommentQueries(personaId, {
    page: 251,
    pageSize: 20,
    sort: 'oldest',
  });
  const replies = buildPublicCommentQueries(
    personaId,
    { page: 251, pageSize: 20, sort: 'oldest' },
    root.id,
  );
  const own = buildOwnCommentQueries(personaId, accountId, {
    page: 1001,
    pageSize: 20,
    sort: 'oldest',
  });
  const queue = buildModerationCommentQueries({
    status: 'PENDING',
    page: 501,
    pageSize: 20,
    sort: 'oldest',
  });
  const plans: Record<string, unknown> = {};
  try {
    for (const [name, query] of Object.entries({
      publicRows: publicQueries.rows,
      publicTotal: publicQueries.total,
      publicPublished: publicQueries.published,
      replyRows: replies.rows,
      ownRows: own.rows,
      ownTotal: own.total,
      moderationRows: queue.rows,
      moderationTotal: queue.total,
    }))
      plans[name] = (
        await stack.owner.db.execute(sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query}`)
      ).rows;
  } finally {
    await mkdir(directory, { recursive: true });
    await writeFile(directory + '/query-plans.json', JSON.stringify(plans, null, 2));
  }
  expect(Object.keys(plans)).toHaveLength(8);
});
