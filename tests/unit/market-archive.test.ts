import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { fromBufferPromise } from 'yauzl';
import { MarketPersonaSchema } from '@personamarket/contracts';
import {
  createMarketArchive,
  marketLicenseText,
  parseMarketPersona,
} from '@personamarket/persona-adapters';
import { marketPersona } from '../fixtures/market-personas.js';
import { fixturePng } from '../fixtures/image.js';
const key = '3cabba2c-340d-4edb-8357-a1404f6f878a';
const modifiedAt = new Date('2026-10-27T00:00:00Z');
async function collect(stream: Readable) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) throw new Error('错误的字节流');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function documentWithImage() {
  const document = marketPersona();
  return MarketPersonaSchema.parse({
    ...document,
    metadata: {
      ...document.metadata,
      avatarKey: key,
      coverKey: key,
      readmeMarkdown: `# 原样保留  \n\n![图](assets/${key}.png)`,
    },
    assets: [
      {
        key,
        path: `assets/${key}.png`,
        mimeType: 'image/png',
        bytes: fixturePng.length,
        sha256: createHash('sha256').update(fixturePng).digest('hex'),
      },
    ],
  });
}
describe('完整人设ZIP生成', () => {
  it('真实ZIP可由独立读取器消费，包含同一份清单、README、许可与真实图片', async () => {
    const document = documentWithImage();
    const requests: string[] = [];
    const bytes = await collect(
      createMarketArchive(
        document,
        async (id) => {
          requests.push(id);
          return fixturePng;
        },
        modifiedAt,
      ),
    );
    const archive = await fromBufferPromise(bytes, {
      lazyEntries: true,
      validateEntrySizes: true,
      strictFileNames: true,
    });
    const files = new Map<string, Buffer>();
    try {
      for await (const entry of archive.eachEntry())
        files.set(entry.fileName, await collect(await archive.openReadStreamPromise(entry)));
    } finally {
      archive.close();
    }
    expect([...files.keys()]).toEqual([
      'persona.json',
      'README.md',
      'LICENSE.txt',
      `assets/${key}.png`,
    ]);
    expect(requests).toEqual([key]);
    const manifest = files.get('persona.json');
    if (!manifest) throw new Error('缺少清单');
    expect(parseMarketPersona(manifest, 'zip')).toEqual(document);
    expect(files.get('README.md')?.toString()).toBe(document.metadata.readmeMarkdown);
    expect(files.get('LICENSE.txt')?.toString()).toBe(marketLicenseText(document));
    expect(files.get(`assets/${key}.png`)).toEqual(fixturePng);
    expect(files.get('LICENSE.txt')?.toString()).toContain(
      document.metadata.origin.type === 'repost' ? document.metadata.origin.originalAuthor : '',
    );
  });
  it('无图作品仍输出真实三文件归档，不调用图片读取', async () => {
    const bytes = await collect(
      createMarketArchive(
        marketPersona(),
        async () => {
          throw new Error('不应读取图片');
        },
        modifiedAt,
      ),
    );
    const archive = await fromBufferPromise(bytes, { lazyEntries: true });
    const names: string[] = [];
    try {
      for await (const entry of archive.eachEntry()) names.push(entry.fileName);
    } finally {
      archive.close();
    }
    expect(names).toEqual(['persona.json', 'README.md', 'LICENSE.txt']);
  });
  it('缺失图片、实际字节不符或哈希不符均使流失败，不输出缺图成功包', async () => {
    const document = documentWithImage();
    for (const read of [
      () => {
        throw new Error('同步图片读取失败');
      },
      async () => {
        throw new Error('测试图片缺失');
      },
      async () => fixturePng.subarray(1),
      async () => Buffer.alloc(fixturePng.length),
    ])
      await expect(collect(createMarketArchive(document, read, modifiedAt))).rejects.toThrow();
  });
  it('取消下载不会等待仍未完成的图片读取', async () => {
    let requested: () => void = () => {};
    const reading = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const stream = createMarketArchive(
      documentWithImage(),
      () => {
        requested();
        return new Promise<Uint8Array>(() => {});
      },
      modifiedAt,
    );
    const closed = new Promise<void>((resolve) => {
      stream.once('close', resolve);
    });
    stream.resume();
    await reading;
    // 让已就绪的元信息管道排空，剩余图片读取由未决Promise明确阻塞
    await new Promise<void>((resolve) => setImmediate(resolve));
    stream.destroy();
    await closed;
    expect(stream.closed).toBe(true);
  });
});
