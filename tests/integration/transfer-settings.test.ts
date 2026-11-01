import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, expect, it } from 'vitest';
import {
  defaultTransferSettings,
  TransferSettingsResponseSchema,
  TransferSettingsRecordsResponseSchema,
  PublicTransferSettingsResponseSchema,
  transferSettingsEtag,
  ImportPreviewResponseSchema,
  SubmissionResponseSchema,
  type TransferSettings,
} from '@personamarket/contracts';
import { serializeMaiBot } from '@personamarket/persona-adapters';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator, completePersona } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { marketPersona } from '../fixtures/market-personas.js';
import { MarketImportPreviewResponseSchema } from '@personamarket/contracts';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
const path = '/api/v1/admin/settings/transfer';
const write = (http: AuthHttp, revision: number, data: TransferSettings, key = randomUUID()) =>
  http.write(path, { data, reason: '核对正常导入导出策略' }, 'PATCH', {
    'If-Match': transferSettingsEtag(revision),
    'Idempotency-Key': key,
  });

it('管理员设置即时生效，幂等记录与并发修订正确', async () => {
  const admin = await stack.admin();
  const initial = await admin.http.raw(path);
  expect(initial.status).toBe(200);
  expect(initial.headers.get('etag')).toBe('"transfer-1"');
  expect(TransferSettingsResponseSchema.parse(await initial.json()).data).toEqual(
    defaultTransferSettings,
  );
  const data = { ...defaultTransferSettings, guestExportsEnabled: false, maxImportFileKiB: 512 };
  const key = randomUUID();
  expect((await write(admin.http, 1, data, key)).status).toBe(200);
  expect((await write(admin.http, 1, data, key)).status).toBe(200);
  expect((await write(admin.http, 1, data)).status).toBe(412);
  const publicResponse = await stack.browser().raw('/api/v1/settings/transfer');
  expect(publicResponse.headers.get('cache-control')).toContain('no-store');
  expect(PublicTransferSettingsResponseSchema.parse(await publicResponse.json())).toEqual({
    data,
    meta: { revision: 2 },
  });
  const responses = await Promise.all([
    write(admin.http, 2, { ...data, maxImportFileKiB: 256 }),
    write(admin.http, 2, { ...data, maxImportFileKiB: 128 }),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 412]);
  const records = TransferSettingsRecordsResponseSchema.parse(
    await (await admin.http.raw(path + '/records')).json(),
  );
  expect(records.meta.total).toBe(2);
  expect(records.data[1]).toMatchObject({
    before: defaultTransferSettings,
    after: data,
    fromRevision: 1,
    toRevision: 2,
  });
});
it('普通账号不能管理配置，管理员业务设置不附加近期验证', async () => {
  expect((await stack.browser().raw(path)).status).toBe(401);
  const creator = await verifiedCreator(stack);
  expect((await creator.http.raw(path)).status).toBe(403);
  expect((await write(creator.http, 1, defaultTransferSettings)).status).toBe(403);
  const admin = await stack.admin();
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '20 minutes'",
  );
  expect(
    (await write(admin.http, 1, { ...defaultTransferSettings, guestExportsEnabled: false })).status,
  ).toBe(200);
});
it('原生预览保留原始字节，策略变化在确认事务内生效且不改已有草稿', async () => {
  const creator = await verifiedCreator(stack),
    admin = await stack.admin();
  const source = serializeMaiBot({
    platform: 'maibot',
    content: { personality: '分享自然的故事', replyStyle: '亲切', behaviorStyle: '认真倾听' },
  });
  const input = { format: 'maibot-toml', filename: '作者.toml', source };
  const preview = ImportPreviewResponseSchema.parse(
    await (await creator.http.write('/api/v1/me/persona-imports/preview', input)).json(),
  ).data;
  expect(
    (
      await stack.owner.pool.query('SELECT input_bytes FROM persona_imports WHERE id=$1', [
        preview.id,
      ])
    ).rows[0]?.input_bytes,
  ).toBe(Buffer.byteLength(source));
  const command = {
    previewId: preview.id,
    contentHash: preview.contentHash,
    title: '导入私有草稿',
    sourceDescription: '来自作者文件，待补充许可',
    target: { mode: 'new' },
    confirmed: true,
  };
  expect(
    (await write(admin.http, 1, { ...defaultTransferSettings, importFormats: ['market-json'] }))
      .status,
  ).toBe(200);
  expect((await creator.http.write('/api/v1/me/persona-imports/confirm', command)).status).toBe(
    422,
  );
  expect((await creator.http.write('/api/v1/me/persona-imports/preview', input)).status).toBe(422);
  expect(
    (await stack.owner.pool.query('SELECT count(*)::int AS total FROM personas')).rows[0]?.total,
  ).toBe(0);
  expect((await write(admin.http, 2, defaultTransferSettings)).status).toBe(200);
  expect((await creator.http.write('/api/v1/me/persona-imports/confirm', command)).status).toBe(
    200,
  );
  expect(
    (await write(admin.http, 3, { ...defaultTransferSettings, importFormats: [] })).status,
  ).toBe(200);
  expect((await creator.http.write('/api/v1/me/persona-imports/confirm', command)).status).toBe(
    200,
  );
  expect(
    (await stack.owner.pool.query('SELECT count(*)::int AS total FROM personas')).rows[0]?.total,
  ).toBe(1);
});
it('访客策略覆盖公开预览和旧下载链接，登录读取与格式开关分别生效', async () => {
  const author = await verifiedCreator(stack),
    admin = await stack.admin(),
    visitor = stack.browser();
  const work = await completePersona(author.http);
  const submission = SubmissionResponseSchema.parse(
    await (
      await author.http.write(
        '/api/v1/me/personas/' + work.id + '/releases',
        {
          version: '1.0.0',
          expectedDraftRevision: work.revision,
          changelog: '首次发布',
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
          reason: '检查格式策略',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const base = '/api/v1/personas/' + work.id + '/releases/' + submission.releaseId;
  const preview = base + '/export-preview?format=maibot-toml',
    download = base + '/export?format=maibot-toml';
  expect((await visitor.raw(download)).status).toBe(200);
  expect(
    (await write(admin.http, 1, { ...defaultTransferSettings, guestExportsEnabled: false })).status,
  ).toBe(200);
  expect((await visitor.raw(preview)).status).toBe(401);
  expect((await visitor.raw(download)).status).toBe(401);
  expect((await author.http.raw(preview)).status).toBe(200);
  expect((await author.http.raw(download)).status).toBe(200);
  expect(
    (await write(admin.http, 2, { ...defaultTransferSettings, exportFormats: ['text'] })).status,
  ).toBe(200);
  expect((await author.http.raw(preview)).status).toBe(422);
  expect((await author.http.raw(download)).status).toBe(422);
  expect((await visitor.raw(base + '/export?format=text')).status).toBe(200);
});
it('通用JSON按原始文件大小复查，限制收紧后旧预览仍可读取和取消', async () => {
  const author = await verifiedCreator(stack),
    admin = await stack.admin();
  const document = marketPersona();
  const bytes = Buffer.from(' '.repeat(70 * 1024) + JSON.stringify(document));
  const upload = async () => {
    const auth = await author.http.context(),
      body = new FormData();
    body.set('file', new Blob([Buffer.from(bytes)]), '原始大小.persona.json');
    return fetch(author.http.base + '/api/v1/me/market-imports/preview', {
      method: 'POST',
      body,
      headers: {
        Origin: author.http.origin,
        'X-CSRF-Token': auth.data.csrfToken,
        Cookie: [...author.http.cookies].map(([name, value]) => name + '=' + value).join('; '),
      },
      signal: AbortSignal.timeout(15000),
    });
  };
  const response = await upload();
  expect(response.status).toBe(200);
  const preview = MarketImportPreviewResponseSchema.parse(await response.json()).data;
  expect(
    (
      await stack.owner.pool.query('SELECT input_bytes FROM market_imports WHERE id=$1', [
        preview.id,
      ])
    ).rows[0]?.input_bytes,
  ).toBe(bytes.length);
  expect(
    (await write(admin.http, 1, { ...defaultTransferSettings, maxImportFileKiB: 64 })).status,
  ).toBe(200);
  expect(
    (
      await author.http.write('/api/v1/me/market-imports/confirm', {
        previewId: preview.id,
        contentHash: preview.contentHash,
        title: document.metadata.title,
        sourceDescription: '按原作者文件导入',
        authorizationStatement: '作者授权本次导入',
        target: { mode: 'new' },
        confirmed: true,
      })
    ).status,
  ).toBe(400);
  expect((await upload()).status).toBe(400);
  expect((await author.http.raw('/api/v1/me/market-imports/' + preview.id)).status).toBe(200);
  expect(
    (await write(admin.http, 2, { ...defaultTransferSettings, importFormats: [] })).status,
  ).toBe(200);
  expect((await author.http.raw('/api/v1/me/market-imports/' + preview.id)).status).toBe(200);
  expect(
    (await author.http.write('/api/v1/me/market-imports/' + preview.id, undefined, 'DELETE'))
      .status,
  ).toBe(200);
  expect(
    (await stack.owner.pool.query('SELECT count(*)::int AS total FROM personas')).rows[0]?.total,
  ).toBe(0);
});
