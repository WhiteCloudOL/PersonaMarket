import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { z } from 'zod';

const rootRequire = createRequire(import.meta.url);
const codegenRequire = createRequire(rootRequire.resolve('@hey-api/openapi-ts/package.json'));
const parserRequire = createRequire(
  codegenRequire.resolve('@hey-api/json-schema-ref-parser/package.json'),
);
const yaml = z
  .custom<{ load(source: string, options: { maxTotalMergeKeys: number }): unknown }>(
    (value) =>
      value !== null &&
      typeof value === 'object' &&
      'load' in value &&
      typeof value.load === 'function',
  )
  .parse(parserRequire('js-yaml') as unknown);

it('代码生成工具实际解析器限制累计merge工作量，短输入不能绕过预算', () => {
  const lines = ['a0: &a0 { k0: 0 }'];
  for (let index = 1; index < 32; index++)
    lines.push(`a${index}: &a${index} { <<: *a${index - 1}, k${index}: ${index} }`);
  // 只构造32层平面映射，避免在真实机器运行大型资源耗尽PoC
  expect(() => yaml.load(lines.join('\n'), { maxTotalMergeKeys: 100 })).toThrow(
    /maxTotalMergeKeys/u,
  );
});

it('代码生成解析器把空merge来源计入累计预算，防止后续空来源绕过', () => {
  // 低于旧解析器的20项单序列上限，确保测到累计预算而不是其他保护
  const aliases = Array.from({ length: 11 }, () => '*empty').join(', ');
  expect(() =>
    yaml.load('empty: &empty {}\nresult: { <<: [' + aliases + '] }', {
      maxTotalMergeKeys: 10,
    }),
  ).toThrow(/maxTotalMergeKeys/u);
});

it('预算内的正常别名和覆盖字段保持兼容，不能通过关闭YAML支持掩盖告警', () => {
  expect(
    yaml.load('base: &base { enabled: true, quota: 4 }\ncopy: { <<: *base, quota: 5 }', {
      maxTotalMergeKeys: 100,
    }),
  ).toEqual({ base: { enabled: true, quota: 4 }, copy: { enabled: true, quota: 5 } });
});
