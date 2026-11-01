import { randomUUID } from 'node:crypto';
import { test as base, expect, type Page } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import {
  AdminPolicyResponseSchema,
  AuthContextResponseSchema,
  PublicPolicyResponseSchema,
  PolicySlugSchema,
  policyEtag,
  type PolicyFields,
  type PolicySlug,
  type PublicPolicy,
} from '@personamarket/contracts';
import { browserWrite } from '../fixtures/browser-account.js';

type Writers = { author: Page; reviewer: Page; suffix: string };
const origin = () => process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100';
const endpoint = (slug: PolicySlug) => '/api/v1/admin/settings/policies/' + slug;

async function read(page: Page, slug: PolicySlug) {
  const response = await page.request.get(endpoint(slug));
  expect(response.status()).toBe(200);
  return AdminPolicyResponseSchema.parse(await response.json()).data;
}

async function command(
  page: Page,
  slug: PolicySlug,
  suffix: string,
  input: unknown,
  method = 'POST',
) {
  const current = await read(page, slug);
  const response = await browserWrite(page, endpoint(slug) + suffix, input, method, {
    'If-Match': policyEtag(slug, current.revision),
    'Idempotency-Key': randomUUID(),
  });
  expect(response.status()).toBe(200);
  return AdminPolicyResponseSchema.parse(await response.json()).data;
}

async function settlePending(page: Page, slug: PolicySlug) {
  const current = await read(page, slug);
  if (current.latestSubmission?.status === 'pending')
    await command(page, slug, '/submissions/' + current.latestSubmission.id + '/withdraw', {
      confirmed: true,
      reason: '结束上一独立浏览器用例遗留的待审状态',
    });
}

const test = base.extend<{ writers: Writers }>({
  writers: async ({ browser }, use) => {
    const source = process.env['TEST_DATABASE_URL'];
    if (!source || !/^\/pm_e2e_[a-f0-9]{32}_test$/.test(new URL(source).pathname))
      throw new Error('公开规则浏览器回归仅允许本轮受控测试库');
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const password = 'Policy browser fixture passphrase 2026';
    const authorContext = await browser.newContext({ baseURL: origin() });
    const reviewerContext = await browser.newContext({ baseURL: origin() });
    try {
      const author = await authorContext.newPage();
      const reviewer = await reviewerContext.newPage();
      const database = createDatabase(source);
      try {
        for (const role of ['author', 'reviewer']) {
          const username = 'policy_' + role + '_' + suffix;
          await createAdministrator(database, {
            username,
            email: username + '@fixture.invalid',
            password,
          });
        }
      } finally {
        await database.close();
      }
      for (const [page, role] of [
        [author, 'author'],
        [reviewer, 'reviewer'],
      ] as const) {
        expect(
          (
            await browserWrite(page, '/api/v1/auth/login', {
              identifier: 'policy_' + role + '_' + suffix,
              password,
            })
          ).status(),
        ).toBe(200);
        const context = AuthContextResponseSchema.parse(
          await (await page.request.get('/api/v1/auth/context')).json(),
        ).data;
        expect(context.account?.role).toBe('admin');
        expect(context.assurance).toBe('authenticated');
      }
      for (const slug of PolicySlugSchema.options) await settlePending(author, slug);
      await use({ author, reviewer, suffix });
    } finally {
      await Promise.allSettled([authorContext.close(), reviewerContext.close()]);
    }
  },
});
test.use({ trace: 'off', screenshot: 'off' });
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
});

function fields(slug: PolicySlug, suffix: string, tag: string): PolicyFields {
  const identity = tag + '_' + suffix;
  return {
    title: '隔离验收文稿 ' + slug + ' ' + identity,
    summary: '仅用于独立浏览器验收的公开摘要 ' + identity,
    bodyMarkdown: [
      '# 阅读这份规则',
      'POLICY_PUBLIC_' + identity,
      '## 适用说明',
      '这段隔离验收内容用于检查长文阅读、公开版本及实际章节定位。'.repeat(12),
      '## 适用说明',
      '重复标题仍须对应不同且稳定的正文位置',
      '补充说明\n--------',
      'Setext 标题应进入实际目录',
      '```markdown\n# 代码里的标题不进入目录\n```',
      '## 复核入口',
      '这一段验收说明供读者定位正文末尾，不代表真实运营条款或联系方式',
    ].join('\n\n'),
  };
}

async function publish(writers: Writers, slug: PolicySlug, tag: string) {
  const content = fields(slug, writers.suffix, tag);
  await command(
    writers.author,
    slug,
    '',
    { ...content, reason: '保存隔离浏览器公开文稿' },
    'PATCH',
  );
  const submitted = await command(writers.author, slug, '/submissions', {
    confirmed: true,
    reason: '冻结并送审隔离浏览器文稿',
  });
  const id = submitted.latestSubmission?.id;
  if (!id) throw new Error('送审操作未产生真实快照');
  const review = await read(writers.reviewer, slug);
  expect(review.latestSubmission?.selfReviewRequired).toBe(false);
  const approved = await command(writers.reviewer, slug, '/submissions/' + id + '/review', {
    decision: 'approve',
    confirmed: true,
    selfReviewConfirmed: false,
    reason: '由另一管理员核对后批准',
  });
  if (!approved.published) throw new Error('批准操作未产生公开指针');
  expect(approved.published.publicationId).toBe(id);
  expect(approved.published.bodyMarkdown).toBe(content.bodyMarkdown);
  return { slug, content, publication: approved.published };
}

async function metadata(page: Page, route: string, agent: string) {
  const response = await page.request.get(route, { headers: { 'User-Agent': agent } });
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const source = await response.text();
  const values = await page.evaluate((html) => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    return {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
      ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content'),
      ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute('content'),
      canonical: [...document.querySelectorAll('link[rel="canonical"]')].map((item) =>
        item.getAttribute('href'),
      ),
      headCanonical: document.head.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    };
  }, source);
  return { source, ...values };
}

async function unavailable(page: Page, route: string, excluded: readonly string[] = []) {
  // 流式页面可能已发送200；同时检查noindex、缺失正文和实际API404，避免误判。
  const response = await page.request.get(route, { headers: { 'User-Agent': 'Twitterbot/1.0' } });
  expect([200, 404]).toContain(response.status());
  const source = await response.text();
  const result = await page.evaluate((html) => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    return {
      bodies: document.querySelectorAll('[data-policy-body]').length,
      robots: [...document.querySelectorAll('meta[name="robots"]')].flatMap(
        (item) =>
          item
            .getAttribute('content')
            ?.split(',')
            .map((value) => value.trim()) ?? [],
      ),
    };
  }, source);
  expect(result.bodies).toBe(0);
  expect(result.robots).toContain('noindex');
  expect(result.robots).not.toContain('index');
  for (const text of excluded) expect(source).not.toContain(text);
  await page.goto(route);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/暂时无法访问/);
  await expect(page.locator('[data-policy-body]')).toHaveCount(0);
}

test('三类规则经另一管理员真实批准后公开，metadata及版本链接仅取批准正文，目录来自实际Markdown', async ({
  page,
  writers,
}) => {
  for (const slug of PolicySlugSchema.options) {
    const { content, publication } = await publish(writers, slug, 'published');
    await page.goto('/' + slug);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(content.title);
    await expect(
      page.locator('[data-policy-body="' + publication.publicationId + '"]'),
    ).toContainText('POLICY_PUBLIC_published_' + writers.suffix);
    await expect(page.getByRole('link', { name: '此版本链接', exact: true })).toHaveAttribute(
      'href',
      '/' + slug + '?publicationId=' + publication.publicationId,
    );
    const trigger = page.getByRole('button', { name: '规则目录', exact: true });
    if ((page.viewportSize()?.width ?? 1440) < 1024) await trigger.click();
    const contents = page.getByRole('navigation', { name: '规则目录', exact: true });
    await expect(contents.getByRole('link')).toHaveCount(5);
    await expect(contents.getByRole('link', { name: '适用说明', exact: true })).toHaveCount(2);
    await expect(contents.getByRole('link', { name: '补充说明', exact: true })).toHaveCount(1);
    await expect(
      contents.getByRole('link', { name: '代码里的标题不进入目录', exact: true }),
    ).toHaveCount(0);
    const hrefs = await contents
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(new Set(hrefs).size).toBe(5);
    for (const href of hrefs)
      expect(href).toMatch(
        new RegExp(
          '^/' +
            slug +
            '\\?publicationId=' +
            publication.publicationId +
            '#pm-readme-' +
            publication.publicationId +
            '-\\d+$',
        ),
      );
    if (await trigger.isVisible()) await page.keyboard.press('Escape');
    const canonical = new URL('/' + slug, process.env['PUBLIC_ORIGIN']).href;
    for (const agent of ['Mozilla/5.0', 'Twitterbot/1.0']) {
      const result = await metadata(page, '/' + slug, agent);
      expect(result.title).toContain(content.title);
      expect(result.ogTitle).toContain(content.title);
      expect(result.description).toBe(content.summary);
      expect(result.canonical).toEqual([canonical]);
      expect(result.ogUrl).toBe(canonical);
      if (agent.startsWith('Twitter')) expect(result.headCanonical).toBe(canonical);
    }
  }
});

test('目录取消恢复入口焦点，选章进入正文且刷新保持版本位置，跨断点收回手机Sheet', async ({
  page,
  writers,
}) => {
  const { publication } = await publish(writers, 'terms', 'contents');
  await page.goto('/terms');
  const mobile = (page.viewportSize()?.width ?? 1440) < 1024;
  const initialViewport = page.viewportSize();
  const trigger = page.getByRole('button', { name: '规则目录', exact: true });
  const panel = page.getByRole('dialog', { name: '规则目录', exact: true });
  if (mobile) {
    await expect(trigger).toBeEnabled();
    await trigger.click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
  }
  const contents = page.getByRole('navigation', { name: '规则目录', exact: true });
  for (const link of await contents.getByRole('link').all()) {
    const box = await link.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  const chapter = contents.getByRole('link', { name: '复核入口', exact: true });
  const href = await chapter.getAttribute('href');
  if (!href) throw new Error('规则章节缺少版本绑定地址');
  await chapter.focus();
  await chapter.press('Enter');
  await expect(panel).toBeHidden();
  const target = page
    .locator('[data-policy-body]')
    .getByRole('heading', { name: '复核入口', exact: true });
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
  expect((await target.boundingBox())?.y).toBeGreaterThanOrEqual(64);
  expect(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash).toBe(
    href,
  );
  await page.reload();
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
  await expect(page.locator('[data-policy-body]')).toHaveAttribute(
    'data-policy-body',
    publication.publicationId,
  );
  if (mobile) {
    await trigger.click();
    await expect(panel).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(panel).toBeHidden();
    await expect(page.getByRole('navigation', { name: '规则目录', exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.wheel(0, 350);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    if (initialViewport) await page.setViewportSize(initialViewport);
    await trigger.click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('三类待审稿及送审后的编辑不改变旧公开metadata和sitemap，回退下线后显式旧地址不能读取正文', async ({
  page,
  writers,
}) => {
  const versions: Array<{
    slug: PolicySlug;
    content: PolicyFields;
    publication: PublicPolicy;
    pendingId: string;
    privateMarker: string;
    afterMarker: string;
  }> = [];
  for (const slug of PolicySlugSchema.options) {
    const published = await publish(writers, slug, 'stable');
    versions.push({
      ...published,
      pendingId: '',
      privateMarker: 'POLICY_PENDING_' + slug + '_' + writers.suffix,
      afterMarker: 'POLICY_AFTER_PENDING_' + slug + '_' + writers.suffix,
    });
  }
  const sitemapResponse = await page.request.get('/sitemaps/static.xml');
  expect(sitemapResponse.status()).toBe(200);
  const sitemap = await sitemapResponse.text();
  for (const version of versions) {
    const { slug, privateMarker, afterMarker, publication, content } = version;
    const draft = {
      title: '未批准标题 ' + privateMarker,
      summary: privateMarker,
      bodyMarkdown: '## 未批准章节\n\n' + privateMarker,
    };
    await command(writers.author, slug, '', { ...draft, reason: '准备独立待审规则文稿' }, 'PATCH');
    const pending = await command(writers.author, slug, '/submissions', {
      confirmed: true,
      reason: '核对待审快照隔离',
    });
    if (!pending.latestSubmission) throw new Error('未产生待审快照');
    version.pendingId = pending.latestSubmission.id;
    await command(
      writers.author,
      slug,
      '',
      {
        ...draft,
        bodyMarkdown: draft.bodyMarkdown + '\n\n' + afterMarker,
        reason: '在冻结送审后继续编辑草稿',
      },
      'PATCH',
    );
    const response = await page.request.get('/api/v1/policies/' + slug);
    expect(response.status()).toBe(200);
    expect(PublicPolicyResponseSchema.parse(await response.json()).data).toEqual(publication);
    expect(
      (
        await page.request.get('/api/v1/policies/' + slug + '?publicationId=' + version.pendingId)
      ).status(),
    ).toBe(404);
    for (const agent of ['Mozilla/5.0', 'Twitterbot/1.0']) {
      const result = await metadata(page, '/' + slug, agent);
      expect(result.title).toContain(content.title);
      expect(result.description).toBe(content.summary);
      expect(result.source).not.toContain(privateMarker);
      expect(result.source).not.toContain(afterMarker);
    }
    expect(sitemap).toContain(new URL('/' + slug, process.env['PUBLIC_ORIGIN']).href);
  }
  expect(await (await page.request.get('/sitemaps/static.xml')).text()).toBe(sitemap);
  const terms = versions.find((version) => version.slug === 'terms');
  if (!terms) throw new Error('缺少条款版本夹具');
  const approved = await command(
    writers.reviewer,
    'terms',
    '/submissions/' + terms.pendingId + '/review',
    {
      decision: 'approve',
      confirmed: true,
      selfReviewConfirmed: false,
      reason: '批准冻结快照而非后续草稿',
    },
  );
  expect(approved.published?.bodyMarkdown).toContain(terms.privateMarker);
  expect(approved.published?.bodyMarkdown).not.toContain(terms.afterMarker);
  expect(approved.bodyMarkdown).toContain(terms.afterMarker);
  expect(
    (
      await page.request.get(
        '/api/v1/policies/terms?publicationId=' + terms.publication.publicationId,
      )
    ).status(),
  ).toBe(404);
  await unavailable(page, '/terms?publicationId=' + terms.publication.publicationId, [
    terms.content.title,
    terms.privateMarker,
    terms.afterMarker,
  ]);
  const restored = await command(writers.author, 'terms', '/actions/activate', {
    publicationId: terms.publication.publicationId,
    confirmed: true,
    reason: '激活已批准旧快照核对回退',
  });
  expect(restored.bodyMarkdown).toBe(approved.bodyMarkdown);
  expect(restored.published?.publicationId).toBe(terms.publication.publicationId);
  expect(
    (await page.request.get('/api/v1/policies/terms?publicationId=' + terms.pendingId)).status(),
  ).toBe(404);
  await unavailable(page, '/terms?publicationId=' + terms.pendingId, [
    terms.content.title,
    terms.privateMarker,
    terms.afterMarker,
  ]);
  await page.goto('/terms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(terms.content.title);
  await command(writers.author, 'terms', '/actions/unpublish', {
    confirmed: true,
    reason: '核对下线后的所有版本地址',
  });
  for (const id of [terms.publication.publicationId, terms.pendingId]) {
    expect((await page.request.get('/api/v1/policies/terms?publicationId=' + id)).status()).toBe(
      404,
    );
    await unavailable(page, '/terms?publicationId=' + id, [
      terms.content.title,
      terms.privateMarker,
      terms.afterMarker,
    ]);
  }
  await unavailable(page, '/terms', [terms.content.title, terms.privateMarker, terms.afterMarker]);
  const finalSitemap = await page.request.get('/sitemaps/static.xml');
  expect(finalSitemap.status()).toBe(200);
  expect(await finalSitemap.text()).not.toContain(
    new URL('/terms', process.env['PUBLIC_ORIGIN']).href,
  );
});

test('真实未公开空态保留恢复入口，公开后重新读取成功，无效或未知版本不回退到新正文', async ({
  page,
  writers,
}) => {
  const initial = await read(writers.author, 'privacy');
  if (initial.published)
    await command(writers.author, 'privacy', '/actions/unpublish', {
      confirmed: true,
      reason: '准备真实未公开状态',
    });
  const previousId = initial.published?.publicationId ?? randomUUID();
  expect((await page.request.get('/api/v1/policies/privacy')).status()).toBe(404);
  await unavailable(page, '/privacy?publicationId=' + previousId);
  const { content, publication } = await publish(writers, 'privacy', 'recovered');
  await page.getByRole('link', { name: '查看当前公开版', exact: true }).click();
  await expect(page).toHaveURL(origin() + '/privacy');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(content.title);
  await expect(page.locator('[data-policy-body]')).toHaveAttribute(
    'data-policy-body',
    publication.publicationId,
  );
  const unknown = randomUUID();
  expect(
    (await page.request.get('/api/v1/policies/privacy?publicationId=' + unknown)).status(),
  ).toBe(404);
  for (const query of [unknown, 'not-a-version'])
    await unavailable(page, '/privacy?publicationId=' + query, [
      content.title,
      'POLICY_PUBLIC_recovered_' + writers.suffix,
    ]);
  await unavailable(
    page,
    '/privacy?publicationId=' + publication.publicationId + '&publicationId=' + unknown,
    [content.title],
  );
  await page.getByRole('link', { name: '查看当前公开版', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(content.title);
});
