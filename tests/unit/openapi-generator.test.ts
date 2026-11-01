import { expect, it } from 'vitest';
import { generateFetchOperations } from '../../scripts/openapi-fetch-generator.js';
it('只有必填请求头或查询参数的操作，也要求显式传入 options', () => {
  const generated = generateFetchOperations({
    paths: {
      '/logout': {
        post: {
          operationId: 'logout',
          parameters: [{ in: 'header', name: 'X-CSRF-Token', required: true }],
          responses: { 200: { content: { 'application/json': {} } } },
        },
      },
    },
  });
  expect(generated).not.toContain('baseUrl?: string } = {}');
});
it('可选参数不妨碍无参调用，路径级必填参数继承到操作', () => {
  const optional = generateFetchOperations({
    paths: {
      '/status': {
        get: { operationId: 'status', responses: { 200: { content: { 'application/json': {} } } } },
      },
    },
  });
  expect(optional).toContain('baseUrl?: string } = {}');
  const inherited = generateFetchOperations({
    paths: {
      '/search': {
        parameters: [{ in: 'query', name: 'q', required: true }],
        get: { operationId: 'search', responses: { 200: { content: { 'application/json': {} } } } },
      },
    },
  });
  expect(inherited).not.toContain('baseUrl?: string } = {}');
});
