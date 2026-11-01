import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MarketPersonaSchema, MARKET_DOCUMENT_MAX_BYTES } from '@personamarket/contracts';
import {
  parseMarketPersona,
  serializeMarketPersona,
  validateMarketPersona,
  marketPersonaContent,
} from '@personamarket/persona-adapters';
import { marketPersona } from '../fixtures/market-personas.js';
const bytes = (value: string) => new TextEncoder().encode(value);
const key = '3cabba2c-340d-4edb-8357-a1404f6f878a';
const image = { key, mimeType: 'image/webp', bytes: 128, sha256: 'a'.repeat(64) };

describe('本站通用格式适配', () => {
  for (const platform of ['maibot', 'astrbot'] as const)
    it(`${platform} 无图JSON与ZIP清单往返保留全部可迁移信息`, () => {
      const document = marketPersona(platform);
      for (const medium of ['json', 'zip'] as const)
        expect(parseMarketPersona(bytes(serializeMarketPersona(document, medium)), medium)).toEqual(
          document,
        );
    });

  it('JSON只声明外部图片，保留原作者与许可，不将外部账号恢复为本站身份', () => {
    const document = marketPersona();
    const value = MarketPersonaSchema.parse({
      ...document,
      metadata: {
        ...document.metadata,
        coverKey: key,
        readmeMarkdown: `![作者原图](asset://${key})`,
      },
      assets: [{ ...image, url: 'https://example.org/source.webp' }],
    });
    const result = parseMarketPersona(bytes(serializeMarketPersona(value, 'json')), 'json');
    expect(result).toEqual(value);
    expect(result.metadata.origin).toEqual(document.metadata.origin);
    expect(Object.keys(result.metadata)).not.toContain('ownerId');
    expect(() => validateMarketPersona(result, 'zip')).toThrow('包内素材');
  });

  it('ZIP的README使用实际包内路径，清单和实际引用必须双向一致', () => {
    const document = marketPersona();
    const path = `assets/${key}.webp`;
    const value = MarketPersonaSchema.parse({
      ...document,
      metadata: { ...document.metadata, avatarKey: key, readmeMarkdown: `![图](${path})` },
      assets: [{ ...image, path }],
    });
    expect(parseMarketPersona(bytes(serializeMarketPersona(value, 'zip')), 'zip')).toEqual(value);
    expect(() => validateMarketPersona(value, 'json')).toThrow('在线引用清单');
    expect(() =>
      validateMarketPersona(
        { ...value, metadata: { ...document.metadata, readmeMarkdown: '' } },
        'zip',
      ),
    ).toThrow('未引用');
    expect(() =>
      validateMarketPersona(
        { ...document, metadata: { ...document.metadata, readmeMarkdown: `![图](${path})` } },
        'zip',
      ),
    ).toThrow('不在');
    expect(() =>
      validateMarketPersona(
        {
          ...document,
          metadata: { ...document.metadata, readmeMarkdown: '![外图](https://example.org/a.webp)' },
        },
        'json',
      ),
    ).toThrow('不在');
  });

  it('拒绝未知根结构、原生文件、危险键、畸形UTF8与超界文件', () => {
    for (const source of [
      '{}',
      '[]',
      '{"system_prompt":"原生格式"}',
      '{"__proto__":{"admin":true}}',
      JSON.stringify({ ...marketPersona(), approved: true }),
      '{"format":',
    ])
      expect(() => parseMarketPersona(bytes(source), 'json')).toThrow();
    expect(() => parseMarketPersona(new Uint8Array([0xff, 0xfe]), 'json')).toThrow();
    expect(() => parseMarketPersona(new Uint8Array(MARKET_DOCUMENT_MAX_BYTES + 1), 'json')).toThrow(
      '4 MiB',
    );
  });

  it('超过文件总预算的合法字段组合明确失败，不能静默裁剪正文', () => {
    const document = marketPersona('astrbot');
    if (document.platform !== 'astrbot') throw new Error('错误的平台');
    const long = '🪄'.repeat(20000);
    document.content.dialoguePairs = Array.from({ length: 100 }, () => ({
      user: long,
      assistant: long,
    }));
    expect(MarketPersonaSchema.safeParse(document).success).toBe(true);
    expect(() => serializeMarketPersona(document, 'json')).toThrow('超过4MiB');
    expect(document.content.dialoguePairs[99]?.assistant).toBe(long);
  });

  it('导入对话重新分配行ID且不改变内容和顺序，返回正文与源对象隔离', () => {
    const document = marketPersona('astrbot');
    const result = marketPersonaContent(document, randomUUID);
    if (document.platform !== 'astrbot' || result.platform !== 'astrbot')
      throw new Error('错误的平台');
    expect(result.content.systemPrompt).toBe(document.content.systemPrompt);
    expect(
      result.content.dialoguePairs.map(({ user, assistant }) => ({ user, assistant })),
    ).toEqual(document.content.dialoguePairs);
    expect(new Set(result.content.dialoguePairs.map((pair) => pair.id)).size).toBe(2);
    const first = result.content.dialoguePairs[0];
    if (!first) throw new Error('缺少对话');
    first.user = '只改副本';
    expect(document.content.dialoguePairs[0]?.user).toBe('第一句');
  });
});
