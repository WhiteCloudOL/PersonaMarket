import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  CreateReportSchema,
  CommentBodySchema,
  AdminReportActionSchema,
  OwnReportRecordSchema,
  ReportSnapshotSchema,
  reportEtag,
  reportNextStatus,
} from '@personamarket/contracts';
it('举报目标严格区分作品和评论，补充文字保持原样并按Unicode计数', () => {
  const target = { type: 'persona', personaId: randomUUID(), releaseId: randomUUID() };
  const value = { target, reason: 'copyright', details: ' \n保留证据原文🌟\n ' };
  expect(CreateReportSchema.parse(value)).toEqual(value);
  expect(
    CreateReportSchema.safeParse({ ...value, target: { ...target, commentId: randomUUID() } })
      .success,
  ).toBe(false);
  expect(CreateReportSchema.safeParse({ ...value, reporterId: randomUUID() }).success).toBe(false);
  expect(CreateReportSchema.safeParse({ ...value, details: '🌟'.repeat(5000) }).success).toBe(true);
  expect(CreateReportSchema.safeParse({ ...value, details: '🌟'.repeat(5001) }).success).toBe(
    false,
  );
  expect(CreateReportSchema.safeParse({ ...value, details: '\0' }).success).toBe(false);
  expect(
    CreateReportSchema.safeParse({
      target: { type: 'comment', commentId: randomUUID(), revisionId: randomUUID() },
      reason: 'spam',
      details: '',
    }).success,
  ).toBe(false);
});
it('处理操作需要明确确认和说明，内部备注不会混入举报人记录契约', () => {
  const input = {
    action: 'resolve',
    message: '已核对公开版本',
    privateNote: '内部核对记录',
    confirmed: true,
  };
  expect(AdminReportActionSchema.parse(input).selfReviewConfirmed).toBe(false);
  expect(AdminReportActionSchema.safeParse({ ...input, message: ' ' }).success).toBe(false);
  expect(AdminReportActionSchema.safeParse({ ...input, confirmed: false }).success).toBe(false);
  expect(AdminReportActionSchema.safeParse({ ...input, action: 'note', message: '' }).success).toBe(
    true,
  );
  expect(
    AdminReportActionSchema.safeParse({ ...input, action: 'note', message: '', privateNote: '' })
      .success,
  ).toBe(false);
  const record = {
    id: randomUUID(),
    action: 'noted',
    message: '可见说明',
    actor: 'administrator',
    beforeStatus: 'processing',
    afterStatus: 'processing',
    fromRevision: 1,
    toRevision: 2,
    createdAt: new Date().toISOString(),
  };
  expect(OwnReportRecordSchema.safeParse(record).success).toBe(true);
  expect(OwnReportRecordSchema.safeParse({ ...record, privateNote: '不得暴露' }).success).toBe(
    false,
  );
  expect(reportEtag(record.id.toUpperCase(), 2)).toBe('"report-' + record.id + '-2"');
});
it('冻结信息只接受公开目标字段，不能夹带待审评论或授权证据', () => {
  const context = {
    personaId: randomUUID(),
    releaseId: randomUUID(),
    version: '1.0.0',
    title: '公开作品',
    summary: '公开简介',
    platform: 'maibot',
    author: { id: randomUUID(), username: 'fixture_reporter' },
  };
  expect(ReportSnapshotSchema.safeParse({ type: 'persona', ...context }).success).toBe(true);
  expect(
    ReportSnapshotSchema.safeParse({
      type: 'persona',
      ...context,
      evidenceAssetIds: [randomUUID()],
    }).success,
  ).toBe(false);
  expect(
    ReportSnapshotSchema.safeParse({
      type: 'comment',
      ...context,
      comment: { id: randomUUID(), revisionId: randomUUID(), body: '公开评论' },
    }).success,
  ).toBe(true);
  expect(
    ReportSnapshotSchema.safeParse({
      type: 'comment',
      ...context,
      comment: {
        id: randomUUID(),
        revisionId: randomUUID(),
        body: '公开评论',
        pendingBody: '私有待审评论',
      },
    }).success,
  ).toBe(false);
});
it('受理和结案状态单向推进，结案后只允许补充说明', () => {
  expect(reportNextStatus('pending', 'accept')).toBe('processing');
  expect(reportNextStatus('pending', 'resolve')).toBe('resolved');
  expect(reportNextStatus('processing', 'dismiss')).toBe('dismissed');
  expect(reportNextStatus('processing', 'accept')).toBeNull();
  expect(reportNextStatus('resolved', 'accept')).toBeNull();
  expect(reportNextStatus('dismissed', 'resolve')).toBeNull();
  expect(reportNextStatus('resolved', 'note')).toBe('resolved');
});

it('结案处置拒绝客户端指定其他资源、空处置、无版本及错误可见范围', () => {
  const base = {
    action: 'resolve',
    message: '举报人可见说明',
    privateNote: '内部说明',
    confirmed: true,
  };
  const resolution = {
    reason: '被处置者可见说明',
    content: { action: 'block_release', expectedRevision: 2 },
  };
  expect(AdminReportActionSchema.safeParse({ ...base, resolution }).success).toBe(true);
  for (const invalid of [
    { reason: '无处置目标' },
    { ...resolution, reason: ' \n ' },
    { ...resolution, reason: '\0' },
    { ...resolution, content: { action: 'block_release' } },
    { ...resolution, content: { action: 'block_release', expectedRevision: 0 } },
    { ...resolution, content: { ...resolution.content, releaseId: randomUUID() } },
    {
      ...resolution,
      account: {
        action: 'ban',
        expectedSecurityVersion: 1,
        scope: 'account_only',
        userId: randomUUID(),
      },
    },
    { ...resolution, privateNote: '不得通过处置对象混入内部备注' },
  ])
    expect(AdminReportActionSchema.safeParse({ ...base, resolution: invalid }).success).toBe(false);
  expect(
    AdminReportActionSchema.safeParse({ ...base, action: 'dismiss', resolution }).success,
  ).toBe(false);
  const publicRecord = {
    id: randomUUID(),
    action: 'resolved',
    message: '结果说明',
    actor: 'administrator',
    beforeStatus: 'pending',
    afterStatus: 'resolved',
    fromRevision: 1,
    toRevision: 2,
    createdAt: new Date().toISOString(),
    resolution: { content: 'block_release', account: null },
  };
  expect(OwnReportRecordSchema.safeParse(publicRecord).success).toBe(true);
  expect(
    OwnReportRecordSchema.safeParse({
      ...publicRecord,
      resolutionDetail: { command: resolution, result: {} },
    }).success,
  ).toBe(false);
});

it('举报快照完整保留评论契约已允许的获批正文，不额外收紧原文字符范围', () => {
  const body = '公开评论原文' + String.fromCharCode(133) + '保留原字符';
  expect(CommentBodySchema.parse(body)).toBe(body);
  const snapshot = {
    type: 'comment',
    personaId: randomUUID(),
    releaseId: randomUUID(),
    version: '1.0.0',
    title: '公开作品',
    summary: '公开简介',
    platform: 'maibot',
    author: { id: randomUUID(), username: 'fixture_reporter' },
    comment: { id: randomUUID(), revisionId: randomUUID(), body },
  };
  expect(ReportSnapshotSchema.safeParse(snapshot).success).toBe(true);
});
