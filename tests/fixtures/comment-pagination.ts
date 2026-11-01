import { randomUUID } from 'node:crypto';
import { expect, type Browser, type TestInfo } from '@playwright/test';
import {
  BulkReviewCommentsResponseSchema,
  CommentResponseSchema,
  InteractionSettingsResponseSchema,
} from '@personamarket/contracts';
import { browserWrite, loginCreator } from './browser-account.js';
import { loginBrowserAdmin } from './browser-admin.js';
import { visualPersonas } from './visual-personas.js';

/** 只使用隔离测试站点的业务接口，不改变全局写入与读取限流 */
export async function commentPaginationFixture(browser: Browser, info: TestInfo, replies: boolean) {
  const options = {
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    ...(info.project.name === 'desktop'
      ? { viewport: { width: 1440, height: 900 } }
      : info.project.use.viewport
        ? { viewport: info.project.use.viewport }
        : {}),
    hasTouch: info.project.use.hasTouch ?? false,
    isMobile: info.project.use.isMobile ?? false,
    deviceScaleFactor: info.project.use.deviceScaleFactor ?? 1,
  };
  const ownerContext = await browser.newContext(options);
  const adminContext = await browser.newContext(options);
  const owner = await ownerContext.newPage();
  const admin = await adminContext.newPage();
  const settingsPath = '/api/v1/admin/settings/community';
  try {
    await loginCreator(owner);
    await loginBrowserAdmin(admin);
    const works = await visualPersonas(owner, admin);
    const current = await admin.request.get(settingsPath);
    const original = InteractionSettingsResponseSchema.parse(await current.json()).data;
    // 使用管理员可设置的合法业务上限准备一页以上样本，所有实际生产限流仍生效
    expect(
      (
        await browserWrite(admin, settingsPath, { ...original, commentsPerMinute: 30 }, 'PATCH', {
          'If-Match': current.headers()['etag'] ?? '',
        })
      ).status(),
    ).toBe(200);
    const path = '/api/v1/personas/' + works.maibot.id + '/comments';
    async function create(body: string, parentId?: string) {
      const response = await browserWrite(
        owner,
        path,
        {
          body,
          releaseId: works.maibot.releaseId,
          ...(parentId ? { parentId, replyToId: parentId } : {}),
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      );
      expect(response.status()).toBe(200);
      return CommentResponseSchema.parse(await response.json()).data;
    }
    type Row = Awaited<ReturnType<typeof create>>;
    async function approve(rows: Row[]) {
      for (let index = 0; index < rows.length; index += 20) {
        const chunk = rows.slice(index, index + 20);
        const response = await browserWrite(
          admin,
          '/api/v1/admin/comments/bulk-review',
          {
            items: chunk.map((row) => ({
              id: row.id,
              review: {
                decision: 'approve',
                revisionId: row.latest.id,
                expectedRevision: row.revision,
                reason: '核验真实分页与版本引用',
              },
            })),
          },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        );
        expect(response.status()).toBe(200);
        const data = BulkReviewCommentsResponseSchema.parse(await response.json()).data;
        expect(data.map((row) => ({ id: row.id, ok: row.ok }))).toEqual(
          chunk.map((row) => ({ id: row.id, ok: true })),
        );
      }
    }
    const root = replies ? await create('分页楼层的根评论') : undefined;
    if (root) await approve([root]);
    const rows: Row[] = [];
    for (let index = 1; index <= 21; index++)
      rows.push(
        await create(
          (replies ? '分页回复 ' : '分页评论 ') + String(index).padStart(2, '0'),
          root?.id,
        ),
      );
    await approve(rows);
    return {
      owner,
      admin,
      rows,
      root,
      personaId: works.maibot.id,
      async close() {
        try {
          const current = await admin.request.get(settingsPath);
          expect(
            (
              await browserWrite(admin, settingsPath, original, 'PATCH', {
                'If-Match': current.headers()['etag'] ?? '',
              })
            ).status(),
          ).toBe(200);
          for (const work of [works.maibot, works.astrbot])
            expect(
              (
                await browserWrite(owner, '/api/v1/me/personas/' + work.id + '/visibility', {
                  visibility: 'hidden',
                  reason: '结束真实评论分页验收',
                })
              ).status(),
            ).toBe(200);
        } finally {
          await Promise.all([ownerContext.close(), adminContext.close()]);
        }
      },
    };
  } catch (cause) {
    await Promise.all([ownerContext.close(), adminContext.close()]);
    throw cause;
  }
}
