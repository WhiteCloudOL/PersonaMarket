import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  ModelSuggestionsSchema,
  ModelSuggestionsWriteSchema,
  PublicModelSuggestionsResponseSchema,
  modelSuggestionsEtag,
} from '@personamarket/contracts';

it('模型建议允许真实空列表和有序禁用项，限制重复、控制字符和列表大小', () => {
  expect(ModelSuggestionsSchema.parse({ entries: [] })).toEqual({ entries: [] });
  const row = {
    id: randomUUID(),
    modelId: 'custom/provider-model',
    note: '作者自行核对',
    enabled: false,
  };
  expect(ModelSuggestionsSchema.parse({ entries: [row] }).entries).toEqual([row]);
  for (const entries of [
    [row, { ...row, id: randomUUID(), modelId: 'CUSTOM/provider-model' }],
    [row, { ...row, modelId: 'another' }],
    [{ ...row, modelId: ' model ' }],
    [{ ...row, note: '\u0000' }],
    Array.from({ length: 101 }, (_, index) => ({
      ...row,
      id: randomUUID(),
      modelId: 'test/' + index,
    })),
  ])
    expect(ModelSuggestionsSchema.safeParse({ entries }).success).toBe(false);
  expect(
    ModelSuggestionsSchema.safeParse({ entries: [{ ...row, modelId: '🌟'.repeat(200) }] }).success,
  ).toBe(true);
  expect(
    ModelSuggestionsSchema.safeParse({ entries: [{ ...row, modelId: '🌟'.repeat(201) }] }).success,
  ).toBe(false);
});

it('建议管理使用单一写契约和修订标签，公共响应没有启用状态与管理信息', () => {
  expect(
    ModelSuggestionsWriteSchema.safeParse({ data: { entries: [] }, reason: '核对\n建议' }).success,
  ).toBe(true);
  expect(ModelSuggestionsWriteSchema.safeParse({ data: { entries: [] }, reason: '' }).success).toBe(
    false,
  );
  expect(modelSuggestionsEtag(12)).toBe('"models-12"');
  expect(
    PublicModelSuggestionsResponseSchema.safeParse({
      data: [],
      meta: { revision: 1, updatedBy: 'admin' },
    }).success,
  ).toBe(false);
});
