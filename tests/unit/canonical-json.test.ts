import { expect, it } from 'vitest';
import { canonicalJson } from '@personamarket/contracts';
it('自动保存比较忽略对象键顺序与 undefined，保留对话顺序和原始正文', () => {
  expect(
    canonicalJson({
      origin: {
        type: 'repost',
        redistribution: 'contact_required',
        authorizationStatement: '  原文\n',
        sourceUrl: '',
      },
    }),
  ).toBe(
    canonicalJson({
      origin: {
        sourceUrl: '',
        authorizationStatement: '  原文\n',
        redistribution: 'contact_required',
        type: 'repost',
        policyText: undefined,
      },
    }),
  );
  expect(canonicalJson([{ id: 'a' }, { id: 'b' }])).not.toBe(
    canonicalJson([{ id: 'b' }, { id: 'a' }]),
  );
  expect(canonicalJson({ text: '  原文\n' })).not.toBe(canonicalJson({ text: '原文' }));
});
