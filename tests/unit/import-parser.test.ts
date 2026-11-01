import { describe, expect, it, vi } from 'vitest';
import { parseImportDocument } from '@personamarket/persona-adapters';
const bytes = (value: string) => new TextEncoder().encode(value);

describe('有界导入语法解析', () => {
  it('JSON / TOML 中的文本只作为数据，保留中文和多行', () => {
    expect(parseImportDocument(bytes('{"text":"用户文本\\n第二行"}'), 'json')).toEqual({
      text: '用户文本\n第二行',
    });
    expect(parseImportDocument(bytes('[personality]\ntext = "你好"'), 'toml')).toEqual({
      personality: { text: '你好' },
    });
  });
  it('拒绝非法编码、超量、语法错误与原型污染字段', () => {
    expect(() => parseImportDocument(new Uint8Array([0xff]), 'json')).toThrow('UTF-8');
    expect(() => parseImportDocument(new Uint8Array(4 * 1024 * 1024 + 1), 'json')).toThrow('4 MiB');
    expect(() => parseImportDocument(bytes('{'), 'json')).toThrow('语法');
    expect(() => parseImportDocument(bytes('{"__proto__":{"x":1}}'), 'json')).toThrow('字段名');
  });
  it('拒绝过深或过多节点', () => {
    expect(() => parseImportDocument(bytes('['.repeat(34) + '0' + ']'.repeat(34)), 'json')).toThrow(
      '层级',
    );
    expect(() =>
      parseImportDocument(bytes(JSON.stringify(Array.from({ length: 10_001 }, () => 0))), 'json'),
    ).toThrow('字段过多');
  });
  it('极深或极多结构在JSON.parse分配对象前拒绝', () => {
    for (const source of [
      '['.repeat(50000) + '0' + ']'.repeat(50000),
      '[' + '0,'.repeat(40000) + '0]',
    ]) {
      const parse = vi.spyOn(JSON, 'parse');
      try {
        expect(() => parseImportDocument(bytes(source), 'json')).toThrow('层级或字段过多');
        expect(parse.mock.calls.length).toBe(0);
      } finally {
        parse.mockRestore();
      }
    }
  });
  it('预检不把字符串内部的括号、转义引号或冒号算成结构', () => {
    const input = { text: '[{:,"\\}]'.repeat(10000) };
    expect(parseImportDocument(bytes(JSON.stringify(input)), 'json')).toEqual(input);
    const emptyNested = '['.repeat(33) + ']'.repeat(33);
    expect(() => parseImportDocument(bytes(emptyNested), 'json')).not.toThrow();
  });
});
