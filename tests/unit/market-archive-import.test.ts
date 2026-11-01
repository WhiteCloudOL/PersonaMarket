import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { MarketPersonaSchema, MARKET_ARCHIVE_MAX_BYTES } from '@personamarket/contracts';
import {
  parseMarketArchive,
  marketLicenseText,
  createMarketArchive,
} from '@personamarket/persona-adapters';
import { marketPersona } from '../fixtures/market-personas.js';
import { fixturePng } from '../fixtures/image.js';
import { fixtureZip } from '../fixtures/zip.js';

const key = '3cabba2c-340d-4edb-8357-a1404f6f878a';
const path = `assets/${key}.png`;
function contents(withImage = true) {
  const original = marketPersona();
  const document = MarketPersonaSchema.parse({
    ...original,
    metadata: {
      ...original.metadata,
      ...(withImage ? { avatarKey: key, readmeMarkdown: `# 原文  \n![图](${path})` } : {}),
    },
    assets: withImage
      ? [
          {
            key,
            path,
            mimeType: 'image/png',
            bytes: fixturePng.length,
            sha256: createHash('sha256').update(fixturePng).digest('hex'),
          },
        ]
      : [],
  });
  const files = [
    { name: 'persona.json', bytes: Buffer.from(JSON.stringify(document)) },
    { name: 'README.md', bytes: Buffer.from(document.metadata.readmeMarkdown) },
    { name: 'LICENSE.txt', bytes: Buffer.from(marketLicenseText(document)) },
    ...(withImage ? [{ name: path, bytes: fixturePng }] : []),
  ];
  return { document, files };
}
describe('通用归档入站安全边界', () => {
  it('不忽略与清单不同的包内许可声明，换行差异不改变声明', async () => {
    const { files } = contents(false);
    const altered = files.map((file) =>
      file.name === 'LICENSE.txt'
        ? {
            ...file,
            bytes: Buffer.from('附加条件：未经授权禁止转载'),
          }
        : file,
    );
    await expect(parseMarketArchive(fixtureZip(altered), async () => {})).rejects.toThrow('许可');
    const windows = files.map((file) =>
      file.name === 'LICENSE.txt'
        ? {
            ...file,
            bytes: Buffer.from(file.bytes.toString().replaceAll('\n', '\r\n')),
          }
        : file,
    );
    expect((await parseMarketArchive(fixtureZip(windows), async () => {})).document).toEqual(
      contents(false).document,
    );
  });
  it('先完成清单与根文件校验再准备暂存，准备回调不能改写正在核验的文件', async () => {
    const { document, files } = contents();
    const order: string[] = [];
    const parsed = await parseMarketArchive(
      fixtureZip(files),
      async () => {
        order.push('image');
      },
      {
        onDocument: async (copy) => {
          order.push('document');
          copy.metadata.title = '回调中的修改';
        },
      },
    );
    expect(order).toEqual(['document', 'image']);
    expect(parsed.document).toEqual(document);
  });
  it('暂存准备失败保留异常，并且不交付任何图片', async () => {
    const { files } = contents();
    const failure = new Error('测试预览配额失败');
    const receive = vi.fn(async () => {});
    await expect(
      parseMarketArchive(fixtureZip(files), receive, {
        onDocument: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(receive).not.toHaveBeenCalled();
  });
  it('暂存层错误保留原因，不能伪装成包格式错误或成功', async () => {
    const { files } = contents();
    const failure = new Error('测试配额或存储错误');
    await expect(
      parseMarketArchive(fixtureZip(files), async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
  it('实际导出的ZIP可往返，逐文件流和时间扩展不影响内容', async () => {
    const { document } = contents();
    const chunks: Uint8Array[] = [];
    for await (const chunk of createMarketArchive(
      document,
      async () => fixturePng,
      new Date('2026-10-27T00:00:00Z'),
    )) {
      if (!(chunk instanceof Uint8Array)) throw new Error('无效fixture');
      chunks.push(chunk);
    }
    const write = vi.fn(async () => {});
    const parsed = await parseMarketArchive(Buffer.concat(chunks), write);
    expect(parsed.document).toEqual(document);
    expect(write).toHaveBeenCalledExactlyOnceWith(document.assets[0], fixturePng);
  });
  it('保留README的BOM字符、CRLF和空白，不让解码器改写作者正文', async () => {
    const document = marketPersona();
    document.metadata.readmeMarkdown = '\ufeff# 作者原文\r\n\r\n 保留  ';
    const parsed = await parseMarketArchive(
      fixtureZip([
        { name: 'persona.json', bytes: Buffer.from(JSON.stringify(document)), method: 8 },
        { name: 'README.md', bytes: Buffer.from(document.metadata.readmeMarkdown), method: 8 },
        { name: 'LICENSE.txt', bytes: Buffer.from(marketLicenseText(document)), method: 8 },
      ]),
      async () => {
        throw new Error('不应有图片');
      },
    );
    expect(parsed.document).toEqual(document);
  });
  it('无网络/无磁盘解析，逐张校验CRC和SHA后交付，保持资料与原文', async () => {
    const { document, files } = contents();
    const received: Array<{ key: string; bytes: Buffer }> = [];
    const result = await parseMarketArchive(fixtureZip(files), async (asset, bytes) => {
      received.push({ key: asset.key, bytes: Buffer.from(bytes) });
    });
    expect(result.document).toEqual(document);
    expect(result.licenseText).toBe(marketLicenseText(document));
    expect(received).toEqual([{ key, bytes: fixturePng }]);
  });
  it.each([
    '../persona.json',
    '/persona.json',
    'C:/persona.json',
    'assets\\evil.png',
    'assets/%2e%2e/evil.png',
    'assets/../evil.png',
    'assets/archive.zip',
    'assets/.hidden',
    'assets/CON.png',
    'PERSONA.JSON',
    '未知.txt',
  ])('拒绝路径或未允许附件：%s', async (name) => {
    const { files } = contents(false);
    await expect(
      parseMarketArchive(
        fixtureZip([...files, { name, bytes: Buffer.from('bad') }]),
        async () => {},
      ),
    ).rejects.toThrow();
  });
  it('拒绝重复名、缺少文件、未声明图片及README不一致，校验完成前不交付图', async () => {
    const { files } = contents();
    const write = vi.fn(async () => {});
    const manifest = files[0];
    if (!manifest) throw new Error('fixture');
    const cases = [
      [...files, manifest],
      files.filter((file) => file.name !== path),
      [...files, { name: 'assets/3cabba2c-340d-4edb-8357-a1404f6f878b.png', bytes: fixturePng }],
      files.map((file) =>
        file.name === 'README.md' ? { ...file, bytes: Buffer.from('改写') } : file,
      ),
    ];
    for (const entries of cases)
      await expect(parseMarketArchive(fixtureZip(entries), write)).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
  it.each([
    { mode: 0o120777 },
    { mode: 0o010644 },
    { flags: 0x801 },
    { flags: 0x840 },
    { method: 99 },
    { extra: Buffer.from([0x0d, 0, 0, 0]) },
    { extra: Buffer.from([0x75, 0x70, 0, 0]) },
    { localName: '../evil.json' },
  ])('拒绝链接、加密、未知扩展或本地与目录不一致：%j', async (changes) => {
    const { files } = contents(false);
    await expect(
      parseMarketArchive(
        fixtureZip(files.map((file, index) => (index === 0 ? { ...file, ...changes } : file))),
        async () => {},
      ),
    ).rejects.toThrow();
  });
  it('拒绝CRC损坏及图片SHA不符', async () => {
    const { files } = contents();
    await expect(
      parseMarketArchive(
        fixtureZip(files.map((file) => (file.name === path ? { ...file, checksum: 1 } : file))),
        async () => {},
      ),
    ).rejects.toThrow();
    await expect(
      parseMarketArchive(
        fixtureZip(
          files.map((file) =>
            file.name === path ? { ...file, bytes: Buffer.alloc(fixturePng.length) } : file,
          ),
        ),
        async () => {},
      ),
    ).rejects.toThrow();
  });
  it('逐块限制实际解压量，不相信压缩目录声称的大小', async () => {
    const { files } = contents(false);
    const bytes = fixtureZip(
      files.map((file) =>
        file.name === 'README.md'
          ? { ...file, bytes: Buffer.alloc(6 * 1024 * 1024), declaredBytes: 1, method: 8 }
          : file,
      ),
    );
    await expect(parseMarketArchive(bytes, async () => {})).rejects.toThrow();
    await expect(
      parseMarketArchive(
        fixtureZip(
          Array.from({ length: 129 }, (_, index) => ({
            name: `extra${index}`,
            bytes: Buffer.alloc(0),
          })),
        ),
        async () => {},
      ),
    ).rejects.toThrow();
  });
  it('拒绝超上传边界、损坏归档、未知版本，支持调用方取消', async () => {
    const { files } = contents(false);
    await expect(
      parseMarketArchive(Buffer.alloc(MARKET_ARCHIVE_MAX_BYTES + 1), async () => {}),
    ).rejects.toThrow();
    await expect(
      parseMarketArchive(fixtureZip(files).subarray(0, 50), async () => {}),
    ).rejects.toThrow();
    const unknown = files.map((file) =>
      file.name === 'persona.json'
        ? {
            ...file,
            bytes: Buffer.from(
              file.bytes.toString().replace('"schemaVersion":1', '"schemaVersion":999'),
            ),
          }
        : file,
    );
    await expect(parseMarketArchive(fixtureZip(unknown), async () => {})).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(
      parseMarketArchive(fixtureZip(files), async () => {}, { signal: controller.signal }),
    ).rejects.toThrow();
  });
});
