import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import { ProfileSubmissionResponseSchema, type ProfileContent } from '@personamarket/contracts';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';

test.use({ trace: 'off', screenshot: 'off' });
test('长资料与五个链接可读，手机真实触控及审核筛选返回保持一致', async ({
  page,
  browser,
}, info) => {
  const touch = info.project.name === 'mobile';
  const options = {
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: info.project.name === 'desktop' ? { width: 1440, height: 900 } : page.viewportSize(),
    hasTouch: touch,
  };
  const authorContext = await browser.newContext(options),
    adminContext = await browser.newContext(options),
    publicContext = await browser.newContext(options);
  const author = await authorContext.newPage(),
    admin = await adminContext.newPage(),
    visitor = await publicContext.newPage();
  const act = (element: Locator) => (touch ? element.tap() : element.click());
  const directory = join('data/tests/profiles/long-content', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    const creator = await loginCreator(author);
    await loginBrowserAdmin(admin);
    const content: ProfileContent = {
      displayName: '星'.repeat(30) + 'LongCreatorName'.repeat(2),
      bio: Array.from('长篇创作简介与LongUnbrokenEnglishText以及公开说明\n'.repeat(50))
        .slice(0, 1000)
        .join(''),
      avatarAssetId: null,
      links: Array.from({ length: 5 }, (_, index) => ({
        label: ('创作链接' + index + '长标题').repeat(6).slice(0, 40),
        url: 'https://example.com/' + index + '/' + 'long-path-'.repeat(80),
      })),
    };
    expect(Array.from(content.displayName)).toHaveLength(60);
    expect(
      (
        await browserWrite(author, '/api/v1/me/profile', { content, expectedRevision: 0 }, 'PUT')
      ).status(),
    ).toBe(200);
    const submitted = await browserWrite(
      author,
      '/api/v1/me/profile/submissions',
      { expectedDraftRevision: 1, confirmed: true },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(submitted.status()).toBe(200);
    const id = ProfileSubmissionResponseSchema.parse(await submitted.json()).data.id;
    expect(
      (
        await browserWrite(
          admin,
          '/api/v1/admin/profiles/submissions/' + id + '/review',
          {
            decision: 'approve',
            expectedRevision: 1,
            reason: '核验长资料可阅读性',
            selfReviewConfirmed: false,
          },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status(),
    ).toBe(200);
    await author.goto('/dashboard/profile');
    await expect(author.getByLabel('公开昵称', { exact: true })).toHaveValue(content.displayName);
    const lastLink = author.getByLabel('链接地址 5', { exact: true });
    await lastLink.scrollIntoViewIfNeeded();
    await lastLink.focus();
    await expect(lastLink).toBeInViewport();
    const fifth = content.links[4];
    if (!fifth) throw Error('缺少实际第五个链接');
    await expect(lastLink).toHaveValue(fifth.url);
    await act(author.getByRole('tab', { name: '处理记录', exact: true }));
    await expect(author.getByRole('heading', { name: '审核通过', exact: true })).toBeVisible();
    await act(author.getByRole('tab', { name: '编辑资料', exact: true }));
    await expect(author.getByLabel('公开简介', { exact: true })).toHaveValue(content.bio);
    expect(await author.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await author.screenshot({ path: join(directory, 'long-editor.png'), fullPage: true });
    await visitor.goto('/users/' + creator.username);
    await expect(
      visitor.getByRole('heading', { level: 1, name: content.displayName, exact: true }),
    ).toBeVisible();
    for (const link of content.links)
      await expect(visitor.getByRole('link', { name: link.label, exact: true })).toBeVisible();
    expect(await visitor.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await visitor.screenshot({ path: join(directory, 'long-creator.png'), fullPage: true });
    await act(visitor.getByRole('button', { name: /^主题偏好：/ }));
    await act(visitor.getByRole('menuitemradio', { name: '深色', exact: true }));
    await expect(visitor.locator('html')).toHaveClass('dark');
    await visitor.screenshot({ path: join(directory, 'long-creator-dark.png'), fullPage: true });
    await admin.goto('/admin/profiles?status=all&submission=' + id);
    const panel = admin.getByRole('dialog', { name: '审核公开资料', exact: true });
    await expect(panel).toBeVisible();
    const close = panel.getByRole('button', { name: '关闭资料审核', exact: true });
    await close.scrollIntoViewIfNeeded();
    await expect(close).toBeInViewport();
    await act(close);
    await expect(panel).not.toBeVisible();
    await admin.getByLabel('完整用户名', { exact: true }).fill(creator.username);
    await act(admin.getByRole('button', { name: '查找资料', exact: true }));
    await expect(admin).toHaveURL(new RegExp('username=' + creator.username));
    await admin.getByLabel('完整用户名', { exact: true }).fill('missing_profile_account');
    await act(admin.getByRole('button', { name: '查找资料', exact: true }));
    await expect(
      admin.getByRole('heading', { name: '当前没有待处理资料', exact: true }),
    ).toBeVisible();
    await admin.goBack();
    await expect(admin.getByLabel('完整用户名', { exact: true })).toHaveValue(creator.username);
    await expect(admin).toHaveURL(new RegExp('username=' + creator.username));
    await expect(
      admin.getByRole('heading', { name: content.displayName, exact: true }),
    ).toBeVisible();
    await admin.getByLabel('完整用户名', { exact: true }).fill('尚未提交的筛选文字');
    await act(admin.getByRole('button', { name: '审核资料：' + content.displayName, exact: true }));
    await expect(panel).toBeVisible();
    await act(panel.getByRole('button', { name: '关闭资料审核', exact: true }));
    await expect(admin.getByLabel('完整用户名', { exact: true })).toHaveValue('尚未提交的筛选文字');
  } finally {
    await authorContext.close();
    await adminContext.close();
    await publicContext.close();
  }
});
