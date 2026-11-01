import { expect, it } from 'vitest';
import { PersonaModerationSchema } from '@personamarket/contracts';

it('人设处置要求有限整数修订号和具体理由，拒绝伪造身份字段', () => {
  const input = { state: 'blocked', reason: '核对当前作品后处理', expectedRevision: 2 };
  expect(PersonaModerationSchema.parse(input)).toEqual(input);
  for (const value of [undefined, 0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1])
    expect(PersonaModerationSchema.safeParse({ ...input, expectedRevision: value }).success).toBe(
      false,
    );
  for (const reason of ['', '   ', '\n\t', '字'.repeat(5001)])
    expect(PersonaModerationSchema.safeParse({ ...input, reason }).success).toBe(false);
  for (const field of ['actorId', 'ownerId', 'role', 'publiclyVisible'])
    expect(PersonaModerationSchema.safeParse({ ...input, [field]: 'forged' }).success).toBe(false);
});

it('处理理由保留原始空白，不代替管理员改写审计内容', () => {
  const reason = '  核对来源后恢复\n保留完整理由  ';
  expect(
    PersonaModerationSchema.parse({ state: 'normal', expectedRevision: 3, reason }).reason,
  ).toBe(reason);
});
