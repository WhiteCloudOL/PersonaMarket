import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import {
  AuthContextResponseSchema,
  AssetResponseSchema,
  DraftResponseSchema,
  PersonaDraftSchema,
  SubmissionResponseSchema,
  TaxonomyResponseSchema,
} from '@personamarket/contracts';
import { browserWrite } from './browser-account.js';

type VisualPersonaOptions = {
  titles?: Partial<Record<'maibot' | 'astrbot', string>>;
  summary?: string;
  readmeAppendix?: string;
};

/** 只走隔离测试站点的真实上传/保存/发版/审核接口，不向生产库注入演示数据 */
export async function publishedVisualPersonas(
  author: Page,
  admin: Page,
  options: VisualPersonaOptions = {},
) {
  const taxonomy = TaxonomyResponseSchema.parse(
    await (await author.request.get('/api/v1/site/taxonomy')).json(),
  ).data;
  const category = taxonomy.categories[0];
  if (!category) throw new Error('缺少真实分类配置');
  const context = AuthContextResponseSchema.parse(
    await (await author.request.get('/api/v1/auth/context')).json(),
  );
  const uploaded = await author.request.post('/api/v1/me/assets/upload/content', {
    headers: {
      Origin: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
      'X-CSRF-Token': context.data.csrfToken,
    },
    multipart: {
      file: {
        name: 'original-story-garden.png',
        mimeType: 'image/png',
        buffer: await readFile('apps/web/public/images/anime-story-garden.png'),
      },
    },
  });
  expect(uploaded.status()).toBe(200);
  const asset = AssetResponseSchema.parse(await uploaded.json()).data.id;
  const records = [];
  for (const platform of ['maibot', 'astrbot'] as const) {
    const title =
      options.titles?.[platform] ??
      (platform === 'maibot' ? '晴野诗织 · 记录春日的来信' : '星见凛 · 与你一起收集星光');
    const response = await browserWrite(author, '/api/v1/me/personas', { platform, title });
    expect(response.status()).toBe(200);
    const created = DraftResponseSchema.parse(await response.json());
    const draft = PersonaDraftSchema.parse({
      ...created.data.draft,
      platform,
      title,
      summary: options.summary ?? '在午后的书房里交换故事，让每一次普通的对话都有温柔的回响',
      categoryId: category.id,
      tagIds: taxonomy.tags.slice(0, 3).map((tag) => tag.id),
      avatarAssetId: asset,
      coverAssetId: asset,
      content:
        platform === 'maibot'
          ? {
              personality:
                '你是晴野诗织，一位喜欢植物与文学的书店主人\n善于倾听，珍惜生活里的小小灵感',
              replyStyle:
                '语气自然亲切，偶尔用春天、信件和书页作比喻\n根据对方的感受组织回复，不堆砌空泛安慰',
              behaviorStyle:
                '尊重边界，耐心回应疑问\n遇到不确定的事会诚实说明，鼓励对方保留自己的判断',
            }
          : {
              systemPrompt:
                '你是星见凛，一个收集星空故事的旅行者\n温柔而坚定，喜欢与朋友分享沿途的风景',
              dialoguePairs: Array.from({ length: 3 }, (_, index) => ({
                id: randomUUID(),
                user: ['今天有点累', '可以讲一个故事吗', '明天会怎样呢'][index],
                assistant: [
                  '那就先休息一下，我在这里陪你',
                  '当然，要从一封春天的来信开始吗',
                  '我们可以先为明天留下一点期待',
                ][index],
              })),
            },
      readmeMarkdown:
        '# 角色的故事\n\n这是一位在春日书房与你相遇的朋友\n\n## 相处方式\n\n- 一起分享日常与灵感\n- 保留彼此的表达与边界\n- 慢慢认识每一个故事\n\n![书房里的灵感](asset://' +
        asset +
        ')\n\n## 使用建议\n\n按目标平台导入人设，先检查正文和可用能力，再开始对话' +
        (options.readmeAppendix ?? ''),
      recommendedModels: [{ modelId: '作者自选模型', note: '适合自然、细腻的日常对话' }],
      authorNotes: '从一个鲜明的性格开始，让故事慢慢生长',
      rightsAccepted: true,
    });
    const savedResponse = await browserWrite(
      author,
      '/api/v1/me/personas/' + created.data.id + '/draft',
      draft,
      'PUT',
      { 'If-Match': '"draft-1"' },
    );
    expect(savedResponse.status()).toBe(200);
    const saved = DraftResponseSchema.parse(await savedResponse.json());
    const submission = await submit(author, created.data.id, saved.meta.revision, '1.0.0');
    await review(admin, submission.data.id, submission.data.revision, 'approve');
    records.push({ id: created.data.id, title, releaseId: submission.data.releaseId });
  }
  const maibot = records[0];
  const astrbot = records[1];
  if (!maibot || !astrbot) throw new Error('缺少两平台真实作品');
  return { maibot, astrbot };
}

/** 原视觉场景继续保留已驳回和待审版本，检查公开版本不会被这些状态替换 */
export async function visualPersonas(
  author: Page,
  admin: Page,
  options: VisualPersonaOptions = {},
) {
  const { maibot, astrbot } = await publishedVisualPersonas(author, admin, options);
  const current = DraftResponseSchema.parse(
    await (await author.request.get('/api/v1/me/personas/' + maibot.id + '/draft')).json(),
  );
  const rejected = await submit(author, maibot.id, current.meta.revision, '1.1.0');
  await review(admin, rejected.data.id, rejected.data.revision, 'reject');
  const pending = await submit(author, maibot.id, current.meta.revision, '1.1.0');
  expect((await author.request.get('/api/v1/personas/' + maibot.id)).status()).toBe(200);
  return { maibot, astrbot, pendingId: pending.data.id };
}

async function submit(page: Page, id: string, revision: number, version: string) {
  const response = await browserWrite(
    page,
    '/api/v1/me/personas/' + id + '/releases',
    {
      version,
      changelog: version === '1.0.0' ? '首次分享角色与使用建议' : '补充角色的日常表达与使用说明',
      expectedDraftRevision: revision,
      confirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status()).toBe(200);
  return SubmissionResponseSchema.parse(await response.json());
}
async function review(page: Page, id: string, revision: number, action: 'approve' | 'reject') {
  const response = await browserWrite(
    page,
    '/api/v1/admin/moderation/submissions/' + id + '/review',
    {
      action,
      expectedRevision: revision,
      reason: action === 'approve' ? '已核对正文、图片与原创声明' : '请补充更清晰的角色使用建议',
      selfReviewConfirmed: false,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status()).toBe(200);
}
