import { z } from 'zod';

const content = z.record(z.string(), z.unknown());
const parameterSchema = z.object({ required: z.boolean().optional(), $ref: z.string().optional() });
const operationSchema = z.object({
  operationId: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  responses: z.record(z.string(), z.object({ content: content.optional() })),
  requestBody: z.object({ required: z.boolean().optional(), content }).optional(),
  parameters: z.array(parameterSchema).optional(),
});
const documentSchema = z.object({ paths: z.record(z.string(), z.record(z.string(), z.unknown())) });
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

/** 传输层依赖成熟的 openapi-fetch；模型仍由 Hey API 从实际 OpenAPI 生成。 */
export function generateFetchOperations(input: unknown) {
  const document = documentSchema.parse(input);
  const pathTypes: string[] = [];
  const functions: string[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    const operations: string[] = [];
    for (const [method, raw] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      const operation = operationSchema.parse(raw);
      const name = operation.operationId;
      const type = name[0]?.toUpperCase() + name.slice(1);
      const responses: string[] = [];
      for (const [status, response] of Object.entries(operation.responses)) {
        if (!/^[1-5][0-9]{2}$|^default$/.test(status))
          throw new Error(`不支持的响应状态：${status}`);
        const model = `Models.${type}${status.startsWith('2') ? 'Responses' : 'Errors'}[${status === 'default' ? "'default'" : status}]`;
        const contents = Object.keys(response.content ?? {})
          .map((mime) => `${JSON.stringify(mime)}: ${model};`)
          .join('\n');
        responses.push(
          `${status}: { headers: Record<string, unknown>; ${contents ? `content: { ${contents} }` : 'content?: never'} };`,
        );
      }
      let body = 'requestBody?: never;';
      if (operation.requestBody) {
        const contents = Object.keys(operation.requestBody.content)
          .map((mime) => `${JSON.stringify(mime)}: Models.${type}Data['body'];`)
          .join('\n');
        body = `requestBody${operation.requestBody.required ? '' : '?'}: { content: { ${contents} } };`;
      }
      operations.push(
        `${method}: { parameters: Params<Models.${type}Data>; ${body} responses: { ${responses.join('\n')} } };`,
      );
      const inherited = z.array(parameterSchema).parse(item['parameters'] ?? []);
      const required =
        operation.requestBody?.required ||
        /\{[^}]+\}/.test(path) ||
        [...inherited, ...(operation.parameters ?? [])].some(
          (parameter) => parameter.required || parameter.$ref,
        );
      functions.push(`export function ${name}({ baseUrl = '', ...options }: FetchOptions<ApiPaths[${JSON.stringify(path)}][${JSON.stringify(method)}]> & { baseUrl?: string }${required ? '' : ' = {}'}) {
        return createClient<ApiPaths>({ baseUrl }).${method.toUpperCase()}(${JSON.stringify(path)}, options);
      }`);
    }
    pathTypes.push(`${JSON.stringify(path)}: { ${operations.join('\n')} };`);
  }
  return `// 此文件由 scripts/generate-api.ts 从实际 OpenAPI 生成，请勿手工修改。
import createClient, { type FetchOptions } from 'openapi-fetch';
import type * as Models from './types.gen.js';
type Parameter<D, K extends PropertyKey, N extends string> = K extends keyof D
  ? Omit<D, K> extends D ? { [P in N]?: D[K] } : { [P in N]: D[K] }
  : { [P in N]?: never };
type Params<D> = Parameter<D, 'query', 'query'> & Parameter<D, 'path', 'path'> & Parameter<D, 'headers', 'header'>;
export interface ApiPaths { ${pathTypes.join('\n')} }
${functions.join('\n')}
`;
}
