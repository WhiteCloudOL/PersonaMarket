import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { fromBufferPromise } from 'yauzl';
import { expect, type Page } from '@playwright/test';
import { DraftResponseSchema, SubmissionListResponseSchema } from '@personamarket/contracts';
import { mailCode } from './mailpit.js';

/** 隔离浏览器站点的真实注册、收信、验证与登录；认证期间不采集图片或trace */
export async function registerJourneyCreator(page: Page) {
  const username = 'journey_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const email = username + '@fixture.invalid';
  const password = 'Distribution journey passphrase 2026';
  await page.goto('/register');
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '发送验证码', exact: true }).click();
  await page.getByLabel('邮箱验证码', { exact: true }).fill(await mailCode(email, '注册'));
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await expect(page.getByText('邮箱验证通过，可以登录了')).toBeVisible();
  await page.getByRole('link', { name: '前往登录', exact: true }).click();
  await page.getByLabel('用户名或邮箱', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  expect((await page.request.get('/api/v1/admin/settings/brand')).status()).toBe(403);
}

export async function importJourneyFile(
  page: Page,
  bytes: Buffer,
  filename: string,
  title: string,
) {
  await page.goto('/dashboard/personas/import');
  await page.getByLabel('通用人设文件', { exact: true }).setInputFiles({
    name: filename,
    mimeType: filename.endsWith('.zip') ? 'application/zip' : 'application/json',
    buffer: bytes,
  });
  await page.getByRole('button', { name: '预览导入内容', exact: true }).click();
  await expect(page.getByRole('heading', { name: '核对导入内容', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认内容，下一步', exact: true }).click();
  await page.getByLabel('导入后的人设名称', { exact: true }).fill(title);
  await page.getByLabel('来源说明', { exact: true }).fill('核实原作者提供的公开文件并保留来源');
  await page
    .getByLabel('本次转载依据', { exact: true })
    .fill('原作者同意署名转载，保留原作者和来源链接');
  await page
    .getByRole('checkbox', {
      name: '我已核对正文、图片和来源，确认按上述范围导入私有草稿',
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: '确认导入草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/personas\/[a-f0-9-]+\/edit$/);
  const id = new URL(page.url()).pathname.split('/').at(-2);
  if (!id) throw new Error('缺少导入后的真实私有草稿');
  const saved = DraftResponseSchema.parse(
    await (await page.request.get('/api/v1/me/personas/' + id + '/draft')).json(),
  );
  expect(saved.data.draft.rightsAccepted).toBe(false);
  expect((await page.request.get('/api/v1/personas/' + id)).status()).toBe(404);
  return saved;
}

export async function reviewJourneyRelease(
  author: Page,
  reviewer: Page,
  id: string,
  version: string,
) {
  await author.getByRole('button', { name: '创建 Release', exact: true }).click();
  const confirmation = author.getByRole('dialog', { name: '确认本次发版', exact: true });
  await confirmation.getByLabel('版本号', { exact: true }).fill(version);
  await confirmation.getByLabel('更新日志', { exact: true }).fill('完整旅程审核版本 ' + version);
  await confirmation
    .getByRole('checkbox', {
      name: '我已核对公开内容、版本号及来源许可，确认提交审核',
      exact: true,
    })
    .check();
  await confirmation.getByRole('button', { name: '确认提交审核', exact: true }).click();
  await expect(confirmation).toBeHidden();
  const submitted = SubmissionListResponseSchema.parse(
    await (await author.request.get('/api/v1/me/personas/' + id + '/releases')).json(),
  ).data[0];
  if (!submitted) throw new Error('缺少真实审核提交');
  expect(submitted.version).toBe(version);
  expect(submitted.status).toBe('PENDING');
  return {
    releaseId: submitted.releaseId,
    async approve() {
      await reviewer.goto('/admin/moderation?submission=' + submitted.id);
      await reviewer
        .getByLabel('审核意见', { exact: true })
        .fill('核实原文、图片、原作者和转载依据');
      await reviewer.getByRole('button', { name: '通过并发布', exact: true }).last().click();
      await expect(reviewer.getByRole('heading', { name: '审核决定', exact: true })).toHaveCount(0);
    },
  };
}

export async function downloadJourneyFile(page: Page, format: string) {
  const response = page.waitForResponse((reply) => {
    const url = new URL(reply.url());
    return url.pathname.endsWith('/export') && url.searchParams.get('format') === format;
  });
  const downloaded = page.waitForEvent('download');
  await page
    .getByRole('dialog', { name: '导出这个版本', exact: true })
    .getByRole('button', { name: '下载文件', exact: true })
    .click();
  const [reply, file] = await Promise.all([response, downloaded]);
  expect(reply.status()).toBe(200);
  const path = await file.path();
  if (!path) throw new Error('缺少实际下载文件');
  return { bytes: await readFile(path), filename: file.suggestedFilename() };
}

export async function readJourneyArchive(bytes: Buffer) {
  const archive = await fromBufferPromise(bytes, {
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  const files = new Map<string, Buffer>();
  try {
    for await (const entry of archive.eachEntry()) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of await archive.openReadStreamPromise(entry)) {
        if (!(chunk instanceof Uint8Array)) throw new Error('归档产生非字节内容');
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);
      expect(crc32(data)).toBe(entry.crc32);
      expect(files.has(entry.fileName)).toBe(false);
      files.set(entry.fileName, data);
    }
  } finally {
    archive.close();
  }
  return files;
}
