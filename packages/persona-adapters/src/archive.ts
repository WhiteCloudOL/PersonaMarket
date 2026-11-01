import { createHash } from 'node:crypto';
import { Readable, Transform, pipeline } from 'node:stream';
import { ZipFile } from 'yazl';
import {
  MARKET_ARCHIVE_MAX_BYTES,
  MARKET_ARCHIVE_INFLATED_MAX_BYTES,
  MARKET_ARCHIVE_MAX_ENTRIES,
  MARKET_ASSET_MAX_BYTES,
  type MarketPersona,
} from '@personamarket/contracts';
import { serializeMarketPersona, validateMarketPersona } from './market.js';
import { ImportParseError } from './parser.js';

export function marketLicenseText(document: MarketPersona) {
  const origin = document.metadata.origin;
  const policies = {
    not_allowed: '禁止再转载',
    attribution_required: '允许转载，须署名',
    contact_required: '须联系原作者授权',
    custom: '按作者自定义说明',
  };
  return [
    '作品来源与转载声明',
    `作品：${document.metadata.title}`,
    `发布者声明：${document.source?.publisherName || '未注明'}`,
    `来源类型：${origin.type === 'original' ? '原创声明' : '转载声明'}`,
    ...(origin.type === 'repost'
      ? [
          `原作者：${origin.originalAuthor || '未注明'}`,
          ...(origin.sourceUrl ? [`来源链接：${origin.sourceUrl}`] : []),
          ...(origin.sourceDescription ? [`来源说明：${origin.sourceDescription}`] : []),
          `转载依据：${origin.authorizationStatement}`,
        ]
      : []),
    `转载规则：${policies[origin.redistribution]}`,
    ...(origin.policyText ? ['作者补充说明：', origin.policyText] : []),
    '',
    '本文件记录作品中的来源与许可声明，导入不会自动取得原创身份或授权',
    '',
  ].join('\n');
}

/** 不提取文件；依次读取一张图并验证，不将全部图片缓存在内存 */
export function createMarketArchive(
  input: MarketPersona,
  readAsset: (key: string) => Promise<Uint8Array>,
  modifiedAt: Date,
) {
  const document = validateMarketPersona(input, 'zip');
  const manifest = Buffer.from(serializeMarketPersona(document, 'zip'));
  const readme = Buffer.from(document.metadata.readmeMarkdown);
  const license = Buffer.from(marketLicenseText(document));
  const inflated =
    manifest.length +
    readme.length +
    license.length +
    document.assets.reduce((total, asset) => total + asset.bytes, 0);
  if (
    inflated > MARKET_ARCHIVE_INFLATED_MAX_BYTES ||
    document.assets.length + 3 > MARKET_ARCHIVE_MAX_ENTRIES
  )
    throw new ImportParseError('IMPORT_TOO_LARGE', '归档的大小或文件数量超过上限');
  if (!Number.isFinite(modifiedAt.getTime()))
    throw new ImportParseError('INVALID_FORMAT', '归档版本日期无效');
  const archive = new ZipFile();
  const source = archive.outputStream;
  if (!(source instanceof Readable)) throw new Error('ARCHIVE_STREAM_INVALID');
  let active: Readable | undefined;
  let transferred = 0;
  const output = new Transform({
    transform(chunk: unknown, _encoding, callback) {
      if (!(chunk instanceof Uint8Array)) {
        callback(new Error('ARCHIVE_CHUNK_INVALID'));
        return;
      }
      transferred += chunk.byteLength;
      if (transferred > MARKET_ARCHIVE_MAX_BYTES) {
        callback(new ImportParseError('IMPORT_TOO_LARGE', '归档文件超过128MiB'));
        return;
      }
      callback(null, chunk);
    },
  });
  archive.on('error', (cause: unknown) =>
    source.destroy(cause instanceof Error ? cause : new Error('归档生成失败', { cause })),
  );
  // 取消可同步关闭管道，不让异步生成器的return等待未完成的图片Promise
  output.once('close', () => {
    source.destroy();
    active?.destroy();
  });
  pipeline(source, output, (cause) => {
    active?.destroy();
    if (cause) output.destroy(cause);
  });
  const options = { mtime: modifiedAt, mode: 0o100644 };
  archive.addBuffer(manifest, 'persona.json', options);
  archive.addBuffer(readme, 'README.md', options);
  archive.addBuffer(license, 'LICENSE.txt', options);
  for (const asset of document.assets) {
    if (!('path' in asset)) throw new ImportParseError('INVALID_FORMAT', '归档只能使用包内素材');
    archive.addReadStreamLazy(
      asset.path,
      { ...options, size: asset.bytes, compress: false },
      (callback) => {
        void Promise.resolve()
          .then(() => readAsset(asset.key))
          .then((value) => {
            if (value.byteLength > MARKET_ASSET_MAX_BYTES || value.byteLength !== asset.bytes)
              throw new ImportParseError('INVALID_FORMAT', '归档图片实际大小与清单不一致');
            const bytes = Buffer.from(value);
            if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
              throw new ImportParseError('INVALID_FORMAT', '归档图片校验失败');
            if (output.destroyed) throw new Error('ARCHIVE_CANCELLED');
            active = Readable.from(
              (function* () {
                for (let offset = 0; offset < bytes.length; offset += 65536)
                  yield bytes.subarray(offset, offset + 65536);
              })(),
              { objectMode: false },
            );
            callback(null, active);
          })
          .catch((cause: unknown) => {
            // 上游声明要求第二参数，发生错误时yazl只传播错误，不使用该空流
            callback(
              cause instanceof Error ? cause : new Error('图片读取失败', { cause }),
              Readable.from([]),
            );
          });
      },
    );
  }
  archive.end();
  return output;
}
