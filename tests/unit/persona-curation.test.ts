import { expect, it } from 'vitest';
import { PersonaCurationSchema, SetPersonaCurationSchema } from '@personamarket/contracts';

const command = { official: true, featured: false, expectedRevision: 1, reason: '核对作品来源' };

it('策展必须明确两个标记和修订号，不接受客户端伪造身份或只写半份状态', () => {
  expect(SetPersonaCurationSchema.parse(command)).toEqual({
    ...command,
    selfReviewConfirmed: false,
  });
  for (const value of [
    { ...command, expectedRevision: 0 },
    { ...command, expectedRevision: '1' },
    { ...command, ownerId: 'untrusted' },
    { ...command, official: 'true' },
    { official: true, reason: command.reason, expectedRevision: 1 },
  ])
    expect(SetPersonaCurationSchema.safeParse(value).success).toBe(false);
  expect(
    PersonaCurationSchema.safeParse({ official: true, featured: false, reason: '私有理由' })
      .success,
  ).toBe(false);
});

it('策展理由按Unicode字符限制，保留空白且拒绝数据库不接受的控制字符', () => {
  const reason = ' 🌟'.repeat(500);
  expect(SetPersonaCurationSchema.parse({ ...command, reason }).reason).toBe(reason);
  for (const invalid of ['', ' \n ', '🌟'.repeat(2001), '理由\u0000', '理由\u007f'])
    expect(SetPersonaCurationSchema.safeParse({ ...command, reason: invalid }).success).toBe(false);
  expect(SetPersonaCurationSchema.parse({ ...command, reason: '第一行\n第二行' }).reason).toBe(
    '第一行\n第二行',
  );
});
