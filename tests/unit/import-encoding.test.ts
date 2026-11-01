import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseAstrBot, parseMaiBot } from '@personamarket/persona-adapters';

// 固定的GBK编码“中文”，不依赖开发机区域设置或另一个编码器生成预期值
const chineseGbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
const maiBotGbk = Buffer.concat([
  Buffer.from('[personality]\npersonality = "  '),
  chineseGbk,
  Buffer.from('  "\nreply_style = "plain"\nbehavior_style = "kind"\n'),
]);

describe('上传文件的编码与原始正文', () => {
  it('GBK自动回退可预览，保留首尾空白且允许手动指定', () => {
    for (const encoding of ['auto', 'gbk', 'gb18030'] as const) {
      const result = parseMaiBot(maiBotGbk, encoding);
      expect(result.persona).toEqual({
        platform: 'maibot',
        content: { personality: '  中文  ', replyStyle: 'plain', behaviorStyle: 'kind' },
      });
      expect(result.sourceEncoding).toEqual({
        encoding: encoding === 'auto' ? 'gb18030' : encoding,
        determinedBy: encoding === 'auto' ? 'fallback' : 'manual',
      });
      expect(result.warnings.some((warning) => warning.includes('自动'))).toBe(encoding === 'auto');
    }
  });

  it('UTF-16双字节序BOM自动识别，正文换行与非BMP字符保持不变', () => {
    const prompt = '  中文\r\n星光🌟\n末行  ';
    const source = JSON.stringify({ system_prompt: prompt, begin_dialogs: [] });
    for (const encoding of ['utf-16le', 'utf-16be'] as const) {
      const bytes = Buffer.from('\ufeff' + source, 'utf16le');
      if (encoding === 'utf-16be') bytes.swap16();
      const result = parseAstrBot(bytes, randomUUID, 'auto');
      expect(result.persona).toEqual({
        platform: 'astrbot',
        content: { systemPrompt: prompt, dialoguePairs: [] },
      });
      expect(result.sourceEncoding).toEqual({ encoding, determinedBy: 'bom' });
    }
  });

  it('无BOM的UTF-16须手动选择，UTF-8 BOM与普通UTF-8均有明确预览结果', () => {
    const source = '{"system_prompt":"  中文\\r\\n🌟  ","begin_dialogs":[]}';
    const le = Buffer.from(source, 'utf16le');
    for (const encoding of ['utf-16le', 'utf-16be'] as const) {
      const bytes = Buffer.from(le);
      if (encoding === 'utf-16be') bytes.swap16();
      expect(parseAstrBot(bytes, randomUUID, encoding).sourceEncoding).toEqual({
        encoding,
        determinedBy: 'manual',
      });
    }
    for (const bom of [false, true]) {
      const result = parseAstrBot(Buffer.from((bom ? '\ufeff' : '') + source), randomUUID, 'auto');
      expect(result.sourceEncoding).toEqual({
        encoding: 'utf-8',
        determinedBy: bom ? 'bom' : 'utf8',
      });
      expect(result.persona).toEqual({
        platform: 'astrbot',
        content: { systemPrompt: '  中文\r\n🌟  ', dialoguePairs: [] },
      });
    }
  });

  it('手动编码错误、BOM冲突和截断序列不以替换字符蒙混通过', () => {
    expect(() => parseMaiBot(maiBotGbk, 'utf-8')).toThrow();
    for (const [bytes, encoding] of [
      [Buffer.from([0xff]), 'auto'],
      [Buffer.from([0x81]), 'gbk'],
      [Buffer.from([0x81, 0x30, 0x81]), 'gb18030'],
      [Buffer.from([0xff, 0xfe, 0x7b]), 'auto'],
      [Buffer.from([0xfe, 0xff, 0x00, 0x7b]), 'utf-16le'],
      [Buffer.from([0xff, 0xfe, 0x00, 0x00]), 'auto'],
    ] as const) {
      expect(() => parseAstrBot(bytes, randomUUID, encoding)).toThrow();
    }
  });

  it('4MiB原始GBK文件在转成Unicode后膨胀仍可解析，超出原始预算被拒绝', () => {
    const size = 4 * 1024 * 1024;
    const prefix = Buffer.concat([maiBotGbk, Buffer.from('\n#')]);
    const odd = (size - prefix.length) % 2;
    const bytes = Buffer.concat([
      prefix,
      Buffer.alloc(size - prefix.length - odd, chineseGbk.subarray(0, 2)),
      Buffer.alloc(odd, 0x20),
    ]);
    expect(bytes.length).toBe(size);
    const result = parseMaiBot(bytes, 'gbk');
    expect(result.persona).toEqual({
      platform: 'maibot',
      content: { personality: '  中文  ', replyStyle: 'plain', behaviorStyle: 'kind' },
    });
    expect(() => parseMaiBot(Buffer.concat([bytes, Buffer.from(' ')]), 'gbk')).toThrow();
  });
});
