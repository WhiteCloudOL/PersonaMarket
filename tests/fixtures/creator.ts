import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { DraftResponseSchema, type PersonaDraft } from '@personamarket/contracts';
import type { createAuthStack } from './auth-stack.js';

export async function verifiedCreator(stack: Awaited<ReturnType<typeof createAuthStack>>) {
  const username = 'writer_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const email = username + '@fixture.invalid';
  const password = 'Creative fixture passphrase 2026';
  const http = stack.browser();
  expect((await http.register({ username, email, password }, stack.tick)).status).toBe(200);
  expect((await http.write('/api/v1/auth/login', { identifier: username, password })).status).toBe(
    200,
  );
  return { http, username, email, password };
}
export async function completePersona(
  http: Awaited<ReturnType<typeof verifiedCreator>>['http'],
  platform: 'maibot' | 'astrbot' = 'maibot',
) {
  const result = await http.write('/api/v1/me/personas', { platform, title: '真实发布作品' });
  expect(result.status).toBe(200);
  const initial = DraftResponseSchema.parse(await result.json());
  const draft: PersonaDraft = {
    ...initial.data.draft,
    summary: '真实发布说明',
    rightsAccepted: true,
    ...(platform === 'maibot'
      ? ({
          platform: 'maibot',
          content: {
            personality: '喜欢自然与文学',
            replyStyle: '亲切自然',
            behaviorStyle: '认真倾听',
          },
        } as const)
      : ({
          platform: 'astrbot',
          content: { systemPrompt: '记录旅途的故事', dialoguePairs: [] },
        } as const)),
  };
  expect(
    (
      await http.write('/api/v1/me/personas/' + initial.data.id + '/draft', draft, 'PUT', {
        'If-Match': '"draft-1"',
      })
    ).status,
  ).toBe(200);
  return { id: initial.data.id, draft, revision: 2 };
}
