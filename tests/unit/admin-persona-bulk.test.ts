import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  AdminPersonaBulkRequestSchema,
  AdminPersonaBulkResponseSchema,
  AdminPersonaRecordsResponseSchema,
} from '@personamarket/contracts';

const item = () => ({ id: randomUUID(), expectedRevision: 1, idempotencyKey: randomUUID() });

it('批量操作严格限制范围，识别大小写相同的目标和重复操作标识', () => {
  const first = item();
  const base = { action: 'block', reason: '核对作品状态', items: [first] };
  expect(AdminPersonaBulkRequestSchema.safeParse(base).success).toBe(true);
  for (const items of [
    [],
    [first, { ...first, id: first.id.toUpperCase(), idempotencyKey: randomUUID() }],
    [first, { ...item(), idempotencyKey: first.idempotencyKey }],
    Array.from({ length: 21 }, item),
  ])
    expect(AdminPersonaBulkRequestSchema.safeParse({ ...base, items }).success).toBe(false);
  for (const extra of [{ role: 'admin' }, { official: true }, { selfReviewConfirmed: true }])
    expect(AdminPersonaBulkRequestSchema.safeParse({ ...base, ...extra }).success).toBe(false);
  expect(
    AdminPersonaBulkRequestSchema.safeParse({
      ...base,
      action: 'curate',
      official: true,
      featured: false,
    }).success,
  ).toBe(true);
});

it('批量结果必须逐项区分成功失败，管理记录拒绝私有字段并保留完整理由', () => {
  const id = randomUUID();
  expect(
    AdminPersonaBulkResponseSchema.safeParse({ data: [{ id, ok: false, message: '伪造成功' }] })
      .success,
  ).toBe(false);
  expect(
    AdminPersonaBulkResponseSchema.safeParse({
      data: [
        { id, ok: true, message: '已处理' },
        {
          id: randomUUID(),
          ok: false,
          error: { code: 'REVISION_CONFLICT', message: '请重新核对' },
        },
      ],
    }).success,
  ).toBe(true);
  const record = {
    id,
    actor: 'actual_admin',
    action: 'persona_curated',
    reason: '🌟'.repeat(5000),
    selfReview: false,
    submissionId: null,
    createdAt: '2026-10-29T01:00:00Z',
  };
  const response = { data: [record], meta: { page: 1, pageSize: 20, total: 1 } };
  expect(AdminPersonaRecordsResponseSchema.parse(response).data[0]?.reason).toBe(record.reason);
  expect(
    AdminPersonaRecordsResponseSchema.safeParse({
      ...response,
      data: [{ ...record, requestId: id }],
    }).success,
  ).toBe(false);
});
