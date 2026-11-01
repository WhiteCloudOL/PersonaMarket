import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { z } from 'zod';
import { AdminPersonaResponseSchema, type PersonaModerationSchema } from '@personamarket/contracts';
import type { AuthHttp } from './auth-http.js';

/** 正常操作先通过真实API读取修订号；并发/越权用例自行冻结请求，不能用此助手绕过测试边界 */
export async function moderatePersona(
  http: AuthHttp,
  id: string,
  input: Omit<z.infer<typeof PersonaModerationSchema>, 'expectedRevision'>,
) {
  const response = await http.raw('/api/v1/admin/personas/' + id);
  expect(response.status).toBe(200);
  const persona = AdminPersonaResponseSchema.parse(await response.json()).data;
  return http.write(
    '/api/v1/admin/personas/' + id + '/moderation',
    {
      ...input,
      expectedRevision: persona.revision,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
}
