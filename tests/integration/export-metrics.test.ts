import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { z } from 'zod';
import { SubmissionResponseSchema } from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { pruneExportSubjects } from '@personamarket/server';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
let author: Awaited<ReturnType<typeof verifiedCreator>>;
let reader: Awaited<ReturnType<typeof verifiedCreator>>;
let personaId: string;
const releases: string[] = [];
beforeAll(async () => {
  stack = await createAuthStack();
  author = await verifiedCreator(stack);
  reader = await verifiedCreator(stack);
  const admin = await stack.admin();
  const persona = await completePersona(author.http);
  personaId = persona.id;
  for (const version of ['1.0.0', '1.0.1']) {
    const response = await author.http.write(
      '/api/v1/me/personas/' + personaId + '/releases',
      {
        version,
        expectedDraftRevision: persona.revision,
        changelog: '真实统计版本',
        confirmed: true,
      },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(response.status).toBe(200);
    const submission = SubmissionResponseSchema.parse(await response.json()).data;
    expect(
      (
        await admin.http.write(
          '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
          {
            action: 'approve',
            expectedRevision: 1,
            reason: '审核统计样例',
            selfReviewConfirmed: false,
          },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
    ).toBe(200);
    releases.push(submission.releaseId);
  }
});
afterAll(async () => {
  await stack?.close();
});

const Metrics = z.strictObject({
  data: z.strictObject({ exports: z.number().int().nonnegative() }),
});
async function metrics() {
  const response = await stack.browser().raw('/api/v1/personas/' + personaId + '/metrics');
  expect(response.status).toBe(200);
  return Metrics.parse(await response.json()).data;
}
function downloadPath(releaseId: string, format = 'text') {
  return '/api/v1/personas/' + personaId + '/releases/' + releaseId + '/export?format=' + format;
}
it('真实公开统计来自可见作品；预览不计数，登录主体同日跨格式和历史版本只计一次', async () => {
  const response = await stack.browser().raw('/api/v1/public/statistics');
  expect(response.status).toBe(200);
  expect(
    z
      .object({
        data: z.object({ personas: z.number(), creators: z.number(), exports: z.number() }),
      })
      .parse(await response.json()).data,
  ).toEqual({ personas: 1, creators: 1, exports: 0 });
  const first = releases[0];
  const second = releases[1];
  if (!first || !second) throw new Error('缺少真实已审版本');
  expect(
    (await reader.http.raw(downloadPath(first).replace('/export?', '/export-preview?'))).status,
  ).toBe(200);
  expect(await metrics()).toEqual({ exports: 0 });
  // 爬虫或下载器查询文件头不表示实际请求导出内容
  const headVisitor = stack.browser();
  for (const format of ['text', 'market-zip']) {
    const head = await headVisitor.raw(downloadPath(second, format), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-disposition')).toContain('attachment');
    expect(await head.text()).toBe('');
  }
  expect(await metrics()).toEqual({ exports: 0 });
  expect([...headVisitor.cookies.keys()].some((key) => key.includes('export-subject'))).toBe(false);
  const responses = await Promise.all([
    reader.http.raw(downloadPath(first)),
    reader.http.raw(downloadPath(second, 'markdown')),
    reader.http.raw(downloadPath(second, 'market-json')),
    reader.http.raw(downloadPath(second, 'market-zip')),
  ]);
  for (const result of responses) {
    expect(result.status).toBe(200);
    await result.arrayBuffer();
  }
  expect(await metrics()).toEqual({ exports: 1 });
  const rows = await stack.owner.pool.query(
    'SELECT sum(total_count)::integer AS total, sum(ranking_count)::integer AS ranked FROM export_daily_metrics WHERE persona_id=$1',
    [personaId],
  );
  expect(rows.rows).toEqual([{ total: 1, ranked: 1 }]);
  const detail = await stack.owner.pool.query(
    'SELECT sum(total_count)::integer AS total FROM export_version_daily_metrics WHERE persona_id=$1',
    [personaId],
  );
  expect(detail.rows).toEqual([{ total: 4 }]);
});
it('本人导出保留显示计数但排除榜单，匿名签名主体不重复且不公开主体信息', async () => {
  const release = releases[1];
  if (!release) throw new Error('缺少公开版本');
  expect((await author.http.raw(downloadPath(release))).status).toBe(200);
  const visitor = stack.browser();
  expect((await visitor.raw(downloadPath(release))).status).toBe(200);
  expect((await visitor.raw(downloadPath(release, 'markdown'))).status).toBe(200);
  expect(await metrics()).toEqual({ exports: 3 });
  const rows = await stack.owner.pool.query(
    'SELECT sum(total_count)::integer AS total, sum(ranking_count)::integer AS ranked FROM export_daily_metrics WHERE persona_id=$1',
    [personaId],
  );
  expect(rows.rows).toEqual([{ total: 3, ranked: 2 }]);
  const eligible = await stack.owner.pool.query(
    'SELECT count(*) FILTER (WHERE ranking_eligible)::integer AS ranked FROM export_subject_days WHERE persona_id=$1',
    [personaId],
  );
  expect(eligible.rows).toEqual([{ ranked: 2 }]);
  const cookie = [...visitor.cookies.keys()].find((key) => key.includes('export-subject'));
  expect(cookie).toBeTruthy();
  const publicResult = await stack.browser().raw('/api/v1/public/statistics');
  expect(await publicResult.text()).not.toMatch(/subject|hash|cookie|actor|ownerId/i);
});
it('导出格式失败与隐藏作品不能增加统计，隐藏后统计端点和全站计数即时排除', async () => {
  const release = releases[1];
  if (!release) throw new Error('缺少公开版本');
  const visitor = stack.browser();
  expect((await visitor.raw(downloadPath(release, 'astrbot-json'))).status).toBe(422);
  expect(await metrics()).toEqual({ exports: 3 });
  expect(
    (
      await author.http.write('/api/v1/me/personas/' + personaId + '/visibility', {
        visibility: 'hidden',
        reason: '核验公开统计边界',
      })
    ).status,
  ).toBe(200);
  expect((await visitor.raw(downloadPath(release))).status).toBe(404);
  expect((await visitor.raw('/api/v1/personas/' + personaId + '/metrics')).status).toBe(404);
  const response = await visitor.raw('/api/v1/public/statistics');
  expect(response.status).toBe(200);
  expect(
    z
      .object({
        data: z.object({ personas: z.number(), creators: z.number(), exports: z.number() }),
      })
      .parse(await response.json()).data,
  ).toEqual({ personas: 0, creators: 0, exports: 0 });
});
it('过期去重摘要分批清除，不修改长期汇总且不保留IP、UA或账号标识', async () => {
  await stack.owner.pool.query('UPDATE export_subject_days SET day=day-40 WHERE persona_id=$1', [
    personaId,
  ]);
  await stack.owner.pool.query(
    'UPDATE export_version_subject_days SET day=day-40 WHERE persona_id=$1',
    [personaId],
  );
  expect(await pruneExportSubjects(stack.owner)).toBeGreaterThan(0);
  const remaining = await stack.owner.pool.query(
    'SELECT count(*)::integer AS total FROM export_subject_days WHERE persona_id=$1',
    [personaId],
  );
  expect(remaining.rows).toEqual([{ total: 0 }]);
  const count = await stack.owner.pool.query(
    'SELECT sum(total_count)::integer AS total FROM export_daily_metrics WHERE persona_id=$1',
    [personaId],
  );
  expect(count.rows).toEqual([{ total: 3 }]);
  const columns = await stack.owner.pool.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name IN ('export_subject_days','export_version_subject_days')",
  );
  expect(columns.rows.map((row) => row.column_name).join(' ')).not.toMatch(
    /user_id|account_id|ip|agent|email/,
  );
});
