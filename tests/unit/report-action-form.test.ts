import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  AdminReportActionSchema,
  AdminReportSchema,
  type ReportResolution,
} from '@personamarket/contracts';
import {
  reportActionFormSchema,
  rebaseReportResolution,
  reportActionRequest,
} from '../../apps/web/src/lib/report-action-form.js';

it('生成客户端的可选处置字段按统一契约省略，保留所有已选择的命令', () => {
  const base = {
    action: 'resolve',
    message: '举报人可见说明',
    privateNote: '内部说明',
    confirmed: true,
  };
  const input = AdminReportActionSchema.parse({
    ...base,
    resolution: {
      reason: '被处置者可见说明',
      content: undefined,
      account: { action: 'ban', scope: 'account_only', expectedSecurityVersion: 1 },
    },
  });
  const serialized = reportActionRequest(input);
  expect(serialized.resolution).not.toHaveProperty('content');
  expect(serialized.resolution?.account).toEqual(input.resolution?.account);
  expect(AdminReportActionSchema.parse(serialized)).toEqual(input);
  expect(
    reportActionRequest(AdminReportActionSchema.parse({ ...base, resolution: undefined })),
  ).not.toHaveProperty('resolution');
});

it('切换受理和结案时保留处置草稿，非结案仅提交其实际动作，隐藏空说明不阻断受理', () => {
  const draft = {
    action: 'accept',
    message: '已受理核查',
    privateNote: '内部草稿',
    confirmed: true,
    resolution: { reason: '', content: { action: 'block_release', expectedRevision: 2 } },
  };
  const copy = structuredClone(draft);
  expect(AdminReportActionSchema.safeParse(draft).success).toBe(false);
  const accepted = reportActionFormSchema.parse(draft);
  expect(accepted.action).toBe('accept');
  expect(accepted).not.toHaveProperty('resolution');
  expect(draft).toEqual(copy);
  expect(reportActionFormSchema.safeParse({ ...draft, action: 'resolve' }).success).toBe(false);
  expect(
    reportActionFormSchema.parse({
      ...draft,
      action: 'resolve',
      resolution: { ...draft.resolution, reason: '被处置者可见原因' },
    }).resolution?.content?.action,
  ).toBe('block_release');
});

it.each(['block_persona', 'block_release', 'hide_comment'] as const)(
  '本人采用最新修订时重绑%s命令的并发版本，保留输入、动作和账号范围',
  (action) => {
    const personaId = randomUUID(),
      releaseId = randomUUID(),
      author = { id: randomUUID(), username: 'fixture_owner' };
    const row = AdminReportSchema.parse({
      id: randomUUID(),
      type: 'persona',
      personaId,
      personaTitle: '核验公开作品',
      platform: 'maibot',
      version: '1.0.0',
      reason: 'copyright',
      status: 'processing',
      revision: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      details: '举报人的私有线索',
      publicPath: null,
      snapshot: {
        type: 'persona',
        personaId,
        releaseId,
        title: '核验公开作品',
        summary: '真实隔离资料',
        platform: 'maibot',
        version: '1.0.0',
        author,
      },
      reporter: { id: randomUUID(), username: 'fixture_reporter' },
      moderation: {
        persona: { revision: 7, state: 'normal' },
        release: { revision: 5, state: 'PUBLISHED' },
        comment: { revision: 9, visibility: 'normal' },
        account: { id: author.id, role: 'user', status: 'active', securityVersion: 4 },
      },
    });
    const draft: ReportResolution = {
      reason: '原先填写的被处置者说明',
      content: { action, expectedRevision: 1 },
      account: { action: 'ban', scope: 'account_and_personas', expectedSecurityVersion: 1 },
    };
    const revised = rebaseReportResolution(draft, row);
    expect(revised?.content).toEqual({
      action,
      expectedRevision: action === 'block_persona' ? 7 : action === 'block_release' ? 5 : 9,
    });
    expect(revised?.account).toEqual({ ...draft.account, expectedSecurityVersion: 4 });
    expect(revised?.reason).toBe(draft.reason);
    expect(draft.content?.expectedRevision).toBe(1);
    expect(rebaseReportResolution(undefined, row)).toBeUndefined();
  },
);
