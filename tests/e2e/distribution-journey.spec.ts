import { selectExploreFilter } from '../fixtures/explore-filters.js';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DraftResponseSchema,
  PublicReleaseResponseSchema,
  PublicPersonaListResponseSchema,
  PublicSitemapEntriesResponseSchema,
} from '@personamarket/contracts';
import {
  parseMaiBot,
  parseAstrBot,
  parseMarketPersona,
  remapMarkdownImages,
} from '@personamarket/persona-adapters';
import { browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { marketPersona } from '../fixtures/market-personas.js';
import { refreshRanking } from '../fixtures/rankings.js';
import {
  registerJourneyCreator,
  importJourneyFile,
  reviewJourneyRelease,
  downloadJourneyFile,
  readJourneyArchive,
} from '../fixtures/distribution-journey.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });

async function capture(
  page: Page,
  info: TestInfo,
  platform: string,
  name: string,
  fullPage = true,
) {
  await page.evaluate(() => document.fonts.ready);
  for (const image of await page.locator('#main img').all()) {
    if (!(await image.isVisible())) continue;
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        image.evaluate(
          (element) =>
            element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
  const size = page.viewportSize();
  if (!size) throw new Error('缺少实际视口');
  const directory = join(
    'data/tests/distribution-journey',
    `${size.width}x${size.height}`,
    platform,
  );
  await mkdir(directory, { recursive: true });
  if (fullPage) await page.evaluate(() => scrollTo(0, 0));
  const path = join(directory, name);
  await page.screenshot({ path, fullPage });
  await info.attach(name, { path, contentType: 'image/png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function filter(page: Page, label: string, option: string) {
  await selectExploreFilter(page, label, option);
  await expect(page.locator('fieldset[aria-busy]')).toHaveAttribute('aria-busy', 'false');
}

for (const platform of ['maibot', 'astrbot'] as const) {
  test(
    platform + '从真实注册、通用导入到旧版归档和下架的11步完整旅程',
    async ({ page: author, browser }, info) => {
      // 两次UI发版/审核、三种真实文件下载与ZIP重新导入；单次动作仍限10秒
      test.setTimeout(120000);
      if (info.project.name === 'desktop')
        await author.setViewportSize({ width: 1440, height: 900 });
      const viewport = author.viewportSize();
      if (!viewport) throw new Error('缺少实际浏览器视口');
      const options = {
        baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
        viewport,
        reducedMotion: 'reduce' as const,
      };
      const guestContext = await browser.newContext(options);
      const reviewerContext = await browser.newContext(options);
      const guest = await guestContext.newPage();
      const reviewer = await reviewerContext.newPage();
      const title =
        (platform === 'maibot' ? 'MaiBot' : 'AstrBot') +
        ' 星海中文书房 ' +
        randomUUID().slice(0, 8);
      const imported = marketPersona(platform);
      try {
        await test.step('1 新账号真实注册、验证、登录并创建私有人设', async () => {
          await registerJourneyCreator(author);
          await author.goto('/dashboard/personas/new');
          await author
            .getByRole('button', {
              name: platform === 'maibot' ? 'MaiBot' : 'AstrBot',
              exact: true,
            })
            .click();
          await author.getByLabel('人设名称', { exact: true }).fill('旅程起步私有草稿');
          await author.getByRole('button', { name: '创建私有草稿', exact: true }).click();
          await expect(author).toHaveURL(/\/edit$/);
          const id = new URL(author.url()).pathname.split('/').at(-2);
          if (!id) throw new Error('缺少真实创建记录');
          expect((await guest.request.get('/api/v1/personas/' + id)).status()).toBe(404);
          expect((await guest.request.get('/api/v1/me/personas/' + id + '/draft')).status()).toBe(
            401,
          );
          await capture(author, info, platform, '01-created-private.png');
        });
        const draft = await test.step('2 通用JSON预览、来源确认并生成私有草稿', async () => {
          const saved = await importJourneyFile(
            author,
            Buffer.from(JSON.stringify(imported)),
            '星海原稿.persona.json',
            title,
          );
          expect(saved.data.draft.platform).toBe(platform);
          expect(saved.data.draft.content).toMatchObject(imported.content);
          expect(saved.data.draft.origin).toMatchObject({
            type: 'repost',
            originalAuthor: '原作者',
            sourceUrl: 'https://example.org/original',
          });
          await capture(author, info, platform, '02-imported-private.png');
          return saved;
        });
        const id = draft.data.id;
        const firstSaved =
          await test.step('3 编辑正文、README、来源及真实图片，检查草稿乐观锁', async () => {
            await author
              .getByLabel('一句话简介', { exact: true })
              .fill('中文星海书房中的温柔故事，保留作者原文与来源');
            await author.getByRole('combobox', { name: '主要分类', exact: true }).click();
            await author
              .getByRole('option', {
                name: platform === 'maibot' ? '陪伴聊天' : '角色扮演',
                exact: true,
              })
              .click();
            await author.getByLabel('作品标签', { exact: true }).fill('温柔治愈');
            await author
              .getByRole('group', { name: '推荐标签', exact: true })
              .getByRole('button', { name: '温柔治愈', exact: true })
              .click();
            await author
              .getByRole('textbox', { name: 'Markdown 介绍', exact: true })
              .fill('# 星海书房的中文说明\n\n完整旅程的图文说明，保留原作者来源');
            const illustration = {
              name: '书房插画.png',
              mimeType: 'image/png',
              buffer: await readFile('apps/web/public/images/anime-story-garden.png'),
            };
            await author.getByLabel('上传作品图片', { exact: true }).setInputFiles(illustration);
            await expect(
              author.getByRole('textbox', { name: 'Markdown 介绍', exact: true }),
            ).toContainText('asset://');
            await author.getByRole('button', { name: '选择已有图片', exact: true }).click();
            await author.getByRole('button', { name: '将图片 1 设为封面', exact: true }).click();
            await author.getByLabel('人设头像', { exact: true }).setInputFiles(illustration);
            await author.getByRole('button', { name: '使用裁切头像', exact: true }).click();
            await expect(author.getByAltText('当前人设头像')).toBeVisible();
            await author
              .getByLabel('作者使用说明', { exact: true })
              .fill('完整旅程第一版，保留原作者和转载许可');
            await author
              .getByRole('checkbox', {
                name: '我确认有权提交这些内容，并授权站点按本页声明展示和提供复制下载',
                exact: true,
              })
              .check();
            await author.getByRole('button', { name: '保存草稿', exact: true }).click();
            await expect(author.getByText('已保存到服务器', { exact: true })).toBeVisible();
            const saved = DraftResponseSchema.parse(
              await (await author.request.get('/api/v1/me/personas/' + id + '/draft')).json(),
            );
            expect(saved.data.draft.content).toMatchObject(imported.content);
            expect(saved.data.draft.readmeMarkdown).toContain('asset://');
            expect(saved.meta.revision).toBeGreaterThan(1);
            const stale = await browserWrite(
              author,
              '/api/v1/me/personas/' + id + '/draft',
              { ...saved.data.draft, authorNotes: '过期页面不允许覆盖的新值' },
              'PUT',
              { 'If-Match': '"draft-' + (saved.meta.revision - 1) + '"' },
            );
            expect(stale.status()).toBe(412);
            expect(await stale.json()).toMatchObject({ error: { code: 'REVISION_CONFLICT' } });
            const unchanged = DraftResponseSchema.parse(
              await (await author.request.get('/api/v1/me/personas/' + id + '/draft')).json(),
            );
            expect(unchanged.meta.revision).toBe(saved.meta.revision);
            expect(unchanged.data.draft.authorNotes).toBe(saved.data.draft.authorNotes);
            await capture(author, info, platform, '03-filled.png');
            return saved;
          });
        await loginBrowserAdmin(reviewer);
        const pending =
          await test.step('4 主动创建1.0.0 Release并提交审核，访客仍无权读取', async () => {
            const pending = await reviewJourneyRelease(author, reviewer, id, '1.0.0');
            expect((await guest.request.get('/api/v1/personas/' + id)).status()).toBe(404);
            expect(
              (
                await guest.request.get('/api/v1/personas/' + id + '/releases/' + pending.releaseId)
              ).status(),
            ).toBe(404);
            return pending;
          });
        const versions =
          await test.step('5 管理员真实审核发布，再发布不同正文的1.0.1以验证旧版不可变', async () => {
            await pending.approve();
            const first = PublicReleaseResponseSchema.parse(
              await (await guest.request.get('/api/v1/personas/' + id)).json(),
            ).data;
            expect(first.releaseId).toBe(pending.releaseId);
            expect(first.snapshot.content).toMatchObject(imported.content);
            expect(first.snapshot.readmeMarkdown).toBe(firstSaved.data.draft.readmeMarkdown);
            await author.goto('/dashboard/personas/' + id + '/edit');
            await author
              .getByLabel('人格设定', { exact: true })
              .fill('后续版本的新正文，不能出现在旧版原生文件中');
            const next = await reviewJourneyRelease(author, reviewer, id, '1.0.1');
            await next.approve();
            const current = PublicReleaseResponseSchema.parse(
              await (await guest.request.get('/api/v1/personas/' + id)).json(),
            ).data;
            expect(current.version).toBe('1.0.1');
            expect(current.releaseId).not.toBe(first.releaseId);
            expect(current.snapshot.content).not.toEqual(first.snapshot.content);
            return { first, current };
          });
        const sharedSearch =
          await test.step('6 访客通过中文搜索、平台、标签和来源组合筛选找到当前作品', async () => {
            await guest.goto('/explore?sort=hot');
            const search = guest.getByRole('search', { name: '搜索公开人设', exact: true });
            await search
              .getByRole('searchbox', { name: '搜索人设、标签或作者', exact: true })
              .fill(title);
            await search.getByRole('button', { name: '搜索人设', exact: true }).click();
            await guest
              .getByRole('group', { name: '人设平台', exact: true })
              .getByRole('button', {
                name: platform === 'maibot' ? 'MaiBot' : 'AstrBot',
                exact: true,
              })
              .click();
            await expect(guest.locator('fieldset[aria-busy]')).toHaveAttribute(
              'aria-busy',
              'false',
            );
            await filter(guest, '标签 / 风格', '温柔治愈');
            await filter(guest, '作品来源', '转载作品');
            const results = guest.getByRole('region', { name: '人设结果', exact: true });
            await expect(results.locator('a[href^="/personas/"]')).toHaveCount(1);
            await expect(results).toContainText(title);
            await expect(results).toContainText('v1.0.1');
            await capture(guest, info, platform, '06-search.png');
            const href = guest.url();
            await results.locator('a[href="/personas/' + id + '"]').click();
            return href;
          });
        await test.step('7 查看当前详情并从真实版本记录打开1.0.0历史详情', async () => {
          await expect(
            guest.getByRole('heading', { name: title, exact: true, level: 1 }),
          ).toBeVisible();
          await expect(guest.locator('#main')).toContainText('v1.0.1');
          await guest.getByRole('button', { name: '查看版本记录', exact: true }).click();
          await guest
            .getByRole('dialog', { name: '版本记录', exact: true })
            .locator('a[href="/personas/' + id + '/releases/' + versions.first.releaseId + '"]')
            .click();
          await expect(guest).toHaveURL(new RegExp('/releases/' + versions.first.releaseId + '$'));
          await expect(
            guest.getByRole('heading', { name: title, exact: true, level: 1 }),
          ).toBeVisible();
          await expect(guest.locator('link[rel="canonical"]')).toHaveAttribute(
            'href',
            new RegExp('/personas/' + id + '/releases/' + versions.first.releaseId + '$'),
          );
          await guest.getByRole('tab', { name: '人设内容', exact: true }).click();
          await expect(guest.locator('#main')).not.toContainText('后续版本的新正文');
          await capture(guest, info, platform, '07-history.png');
        });
        await test.step('8 访客复制历史原文，下载对应平台原生文件并核对首尾空白与完整对话', async () => {
          await guest.getByRole('button', { name: '复制人格设定', exact: true }).click();
          const fallback = guest.getByRole('dialog', { name: '选择并复制文本', exact: true });
          await expect(
            guest.getByRole('button', { name: '已复制', exact: true }).or(fallback),
          ).toBeVisible();
          if (await fallback.isVisible()) await guest.keyboard.press('Escape');
          await guest.getByRole('button', { name: '导出', exact: true }).click();
          const dialog = guest.getByRole('dialog', { name: '导出这个版本', exact: true });
          await expect(
            dialog.getByRole('textbox', { name: '导出内容预览', exact: true }),
          ).toBeVisible();
          await capture(guest, info, platform, '08-native-preview.png', false);
          const file = await downloadJourneyFile(
            guest,
            platform === 'maibot' ? 'maibot-toml' : 'astrbot-json',
          );
          expect(file.filename).toMatch(platform === 'maibot' ? /\.toml$/ : /\.json$/);
          const native =
            platform === 'maibot' ? parseMaiBot(file.bytes) : parseAstrBot(file.bytes, randomUUID);
          expect(native.persona.platform).toBe(platform);
          expect(native.persona.content).toMatchObject(imported.content);
        });
        const ranked =
          await test.step('9 下载本站JSON与完整ZIP，验证正文/README/来源/图片并真实重新导入', async () => {
            const dialog = guest.getByRole('dialog', { name: '导出这个版本', exact: true });
            await dialog.getByRole('button', { name: '通用 JSON', exact: true }).click();
            const jsonFile = await downloadJourneyFile(guest, 'market-json');
            const json = parseMarketPersona(jsonFile.bytes, 'json');
            expect(json.content).toMatchObject(imported.content);
            expect(json.source?.version).toBe('1.0.0');
            expect(json.source?.personaUrl).toContain('/releases/' + versions.first.releaseId);
            expect(json.metadata.origin).toEqual(versions.first.snapshot.origin);
            expect(json.metadata.recommendedModels).toEqual(imported.metadata.recommendedModels);
            await dialog.getByRole('button', { name: '完整 ZIP 包', exact: true }).click();
            await expect(
              dialog.getByRole('textbox', { name: '归档清单预览', exact: true }),
            ).toHaveValue(/assets\//);
            await capture(guest, info, platform, '09-zip-preview.png', false);
            const zipped = await downloadJourneyFile(guest, 'market-zip');
            const files = await readJourneyArchive(zipped.bytes);
            const manifest = files.get('persona.json');
            if (!manifest) throw new Error('完整归档缺少清单');
            const portable = parseMarketPersona(manifest, 'zip');
            expect(portable.content).toEqual(json.content);
            expect(portable.source).toEqual(json.source);
            const replacements = new Map<string, string>();
            for (const asset of portable.assets) {
              if (!('path' in asset) || !asset.path) throw new Error('完整归档缺少素材路径');
              const bytes = files.get(asset.path);
              if (!bytes) throw new Error('完整归档缺少图片字节');
              expect(bytes.byteLength).toBe(asset.bytes);
              expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
              replacements.set('asset://' + asset.key, asset.path);
            }
            expect(portable.metadata).toEqual({
              ...json.metadata,
              readmeMarkdown: remapMarkdownImages(json.metadata.readmeMarkdown, replacements),
            });
            expect(files.get('README.md')?.toString('utf8')).toBe(portable.metadata.readmeMarkdown);
            expect(files.has('LICENSE.txt')).toBe(true);
            expect(files.size).toBe(3 + portable.assets.length);
            expect(portable.assets).toHaveLength(2);
            expect(portable.metadata.avatarKey).not.toBe(portable.metadata.coverKey);
            expect(portable.assets.map((asset) => asset.key)).toEqual(
              expect.arrayContaining([portable.metadata.avatarKey, portable.metadata.coverKey]),
            );
            expect(portable.metadata.readmeMarkdown).toContain(
              replacements.get('asset://' + portable.metadata.coverKey),
            );
            await guest.keyboard.press('Escape');
            const restored = await importJourneyFile(
              author,
              zipped.bytes,
              '历史完整归档.persona.zip',
              title + ' 归档重入',
            );
            expect(restored.data.id).not.toBe(id);
            expect(restored.data.draft.content).toMatchObject(imported.content);
            expect(restored.data.draft.origin).toMatchObject({
              type: 'repost',
              originalAuthor: '原作者',
              sourceUrl: 'https://example.org/original',
            });
            expect(restored.data.draft.avatarAssetId).toBeTruthy();
            const snapshotId = await refreshRanking(guest);
            const sitemap = PublicSitemapEntriesResponseSchema.parse(
              await (await guest.request.get('/api/v1/public/sitemap/entries?page=1')).json(),
            );
            expect(sitemap.data.some((row) => row.personaId === id)).toBe(true);
            return { snapshotId };
          });
        await test.step('10 作者隐藏后搜索、历史、旧排行榜、图片和全部格式均不能绕过公开权限', async () => {
          await author.goto('/dashboard/personas/' + id + '/releases');
          await author.getByRole('button', { name: '隐藏作品', exact: true }).click();
          const hidden = author.getByRole('dialog', { name: '隐藏作品', exact: true });
          await expect(hidden.getByLabel('操作理由', { exact: true })).toHaveCount(0);
          await hidden.getByRole('button', { name: '确认隐藏作品', exact: true }).click();
          await expect(hidden).toBeHidden();
          await guest.goto(sharedSearch);
          await expect(guest.getByText('没有找到匹配的人设', { exact: true })).toBeVisible();
          const search = PublicPersonaListResponseSchema.parse(
            await (
              await guest.request.get(
                '/api/v1/personas?' + new URLSearchParams({ q: title, platform, sort: 'hot' }),
              )
            ).json(),
          );
          expect(search.meta.total).toBe(0);
          for (const path of [
            '/api/v1/personas/' + id,
            '/api/v1/personas/' + id + '/releases',
            '/api/v1/personas/' + id + '/releases/' + versions.first.releaseId,
          ])
            expect((await guest.request.get(path)).status()).toBe(404);
          for (const format of ['maibot-toml', 'astrbot-json', 'market-json', 'market-zip']) {
            for (const suffix of ['export', 'export-preview'])
              expect(
                (
                  await guest.request.get(
                    '/api/v1/personas/' +
                      id +
                      '/releases/' +
                      versions.first.releaseId +
                      '/' +
                      suffix +
                      '?format=' +
                      format,
                  )
                ).status(),
              ).toBe(404);
          }
          const imageId = versions.first.snapshot.coverAssetId;
          if (!imageId) throw new Error('缺少真实已发布图片');
          expect((await guest.request.get('/api/v1/public/assets/' + imageId)).status()).toBe(404);
          const sitemap = PublicSitemapEntriesResponseSchema.parse(
            await (await guest.request.get('/api/v1/public/sitemap/entries?page=1')).json(),
          );
          expect(sitemap.data.some((row) => row.personaId === id)).toBe(false);
          await capture(guest, info, platform, '10-hidden-search.png');
          await guest.goto('/rankings?kind=downloads&window=all&snapshotId=' + ranked.snapshotId);
          await expect(guest.locator('#main')).not.toContainText(title);
          await guest.goto('/personas/' + id + '/releases/' + versions.first.releaseId);
          await expect(
            guest.getByRole('heading', { name: '这个作品暂时无法访问', exact: true }),
          ).toBeVisible();
          await expect(guest.locator('#main')).not.toContainText(title);
        });
        await test.step('11 当前桌面/平板/手机视口完成同一旅程，页面不溢出并保存最终证据', async () => {
          expect(guest.viewportSize()).toEqual(viewport);
          await capture(guest, info, platform, '11-hidden-detail.png');
          expect((await author.request.get('/api/v1/me/personas/' + id + '/draft')).status()).toBe(
            200,
          );
          expect((await guest.request.get('/api/v1/me/personas/' + id + '/draft')).status()).toBe(
            401,
          );
        });
      } finally {
        await Promise.all([guestContext.close(), reviewerContext.close()]);
      }
    },
  );
}
