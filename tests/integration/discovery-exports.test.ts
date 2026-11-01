import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import {
  DraftResponseSchema,
  SubmissionResponseSchema,
  PublicPersonaListResponseSchema,
  PublicFacetsResponseSchema,
  ExportPreviewResponseSchema,
  type PersonaDraft,
} from '@personamarket/contracts';
import { parseMaiBot, parseAstrBot } from '@personamarket/persona-adapters';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator, completePersona } from '../fixtures/creator.js';
let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});
it('组合筛选、真实公开 facets、准确历史原生导出与下架授权', async () => {
  const author = await verifiedCreator(stack);
  const admin = await stack.admin();
  const visitor = stack.browser();
  const category = '10000000-0000-4000-8000-000000000001';
  const tag = '20000000-0000-4000-8000-000000000001';
  const publish = async (platform: 'maibot' | 'astrbot') => {
    const created = await completePersona(author.http, platform);
    const draft: PersonaDraft = {
      ...created.draft,
      title: platform === 'maibot' ? 'AAA 林间向导' : 'ZZZ 林间旅人',
      categoryId: category,
      tagIds: [tag],
      recommendedModels: [
        { modelId: platform === 'maibot' ? '林间-模型%_1' : '星海-模型', note: '真实模型建议' },
      ],
      origin:
        platform === 'maibot'
          ? {
              type: 'original',
              redistribution: 'attribution_required',
              policyText: '',
            }
          : {
              type: 'repost',
              redistribution: 'contact_required',
              policyText: '',
              originalAuthor: '测试原作者',
              sourceUrl: 'https://example.com/source',
              sourceDescription: '来源说明',
              authorizationStatement: '允许测试转载',
            },
    };
    expect(
      (
        await author.http.write('/api/v1/me/personas/' + created.id + '/draft', draft, 'PUT', {
          'If-Match': '"draft-2"',
        })
      ).status,
    ).toBe(200);
    const submission = SubmissionResponseSchema.parse(
      await (
        await author.http.write(
          '/api/v1/me/personas/' + created.id + '/releases',
          {
            version: '1.0.0',
            expectedDraftRevision: 3,
            changelog: '首个审核版本',
            confirmed: true,
          },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).json(),
    ).data;
    expect(
      (
        await admin.http.write(
          '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
          {
            action: 'approve',
            expectedRevision: 1,
            reason: '核验来源',
            selfReviewConfirmed: false,
          },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
    ).toBe(200);
    return { ...created, draft, submission };
  };
  const mai = await publish('maibot');
  const astr = await publish('astrbot');
  const list = async (query: Record<string, string>) =>
    PublicPersonaListResponseSchema.parse(
      await (await visitor.raw('/api/v1/personas?' + new URLSearchParams(query))).json(),
    );
  const combined = {
    platform: 'maibot',
    categoryId: category,
    tagId: tag,
    model: '林间-模型%_1',
    origin: 'original',
    redistribution: 'attribution_required',
    q: '林',
    sort: 'newest',
  };
  expect((await list(combined)).data.map((item) => item.personaId)).toEqual([mai.id]);
  expect((await list({ ...combined, origin: 'repost' })).meta.total).toBe(0);
  expect((await list({ model: '%' })).meta.total).toBe(0);
  expect((await list({ categoryId: randomUUID() })).meta.total).toBe(0);
  expect((await visitor.raw('/api/v1/personas?sort=sql')).status).toBe(400);
  expect((await list({ sort: 'oldest', pageSize: '1' })).data[0]?.personaId).toBe(mai.id);
  expect((await list({ sort: 'oldest', pageSize: '1', page: '2' })).data[0]?.personaId).toBe(
    astr.id,
  );
  expect((await list({ sort: 'title' })).data.map((item) => item.personaId)).toEqual([
    mai.id,
    astr.id,
  ]);
  const facets = async () =>
    PublicFacetsResponseSchema.parse(
      await (await visitor.raw('/api/v1/site/persona-filters')).json(),
    ).data;
  expect((await facets()).platforms).toEqual({ maibot: 1, astrbot: 1 });
  expect((await facets()).tags.find((item) => item.id === tag)?.count).toBe(2);
  expect((await facets()).models.map((item) => item.value).sort()).toEqual(
    ['星海-模型', '林间-模型%_1'].sort(),
  );
  const pendingDraft = DraftResponseSchema.parse(
    await (await author.http.raw('/api/v1/me/personas/' + mai.id + '/draft')).json(),
  );
  expect(
    (
      await author.http.write(
        '/api/v1/me/personas/' + mai.id + '/draft',
        { ...pendingDraft.data.draft, recommendedModels: [{ modelId: '私密待审模型', note: '' }] },
        'PUT',
        { 'If-Match': '"draft-3"' },
      )
    ).status,
  ).toBe(200);
  expect((await facets()).models.some((item) => item.value === '私密待审模型')).toBe(false);
  for (const item of [mai, astr]) {
    const format = item.draft.platform === 'maibot' ? 'maibot-toml' : 'astrbot-json';
    const base = '/api/v1/personas/' + item.id + '/releases/' + item.submission.releaseId;
    const preview = ExportPreviewResponseSchema.parse(
      await (await visitor.raw(base + '/export-preview?format=' + format)).json(),
    ).data;
    const parsed =
      format === 'maibot-toml'
        ? parseMaiBot(Buffer.from(preview.text))
        : parseAstrBot(Buffer.from(preview.text), randomUUID);
    expect(parsed.persona.content).toEqual(item.draft.content);
    const download = await visitor.raw(base + '/export?format=' + format);
    expect(download.status).toBe(200);
    expect(download.headers.get('cache-control')).toBe('private, no-store');
    expect(await download.text()).toBe(preview.text);
    expect(
      (
        await visitor.raw(
          base +
            '/export-preview?format=' +
            (format === 'maibot-toml' ? 'astrbot-json' : 'maibot-toml'),
        )
      ).status,
    ).toBe(422);
  }
  expect(
    (
      await author.http.write('/api/v1/me/personas/' + astr.id + '/visibility', {
        visibility: 'hidden',
        reason: '测试作者隐藏',
      })
    ).status,
  ).toBe(200);
  expect((await facets()).platforms).toEqual({ maibot: 1, astrbot: 0 });
  expect((await facets()).models.map((item) => item.value)).toEqual(['林间-模型%_1']);
  expect(
    (
      await visitor.raw(
        '/api/v1/personas/' +
          astr.id +
          '/releases/' +
          astr.submission.releaseId +
          '/export?format=astrbot-json',
      )
    ).status,
  ).toBe(404);
});
