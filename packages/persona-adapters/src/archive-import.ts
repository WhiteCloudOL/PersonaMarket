import { createHash } from 'node:crypto';
import { addAbortSignal } from 'node:stream';
import { crc32 } from 'node:zlib';
import { fromBufferPromise, parseExtraFields, type Entry, type ZipFile } from 'yauzl';
import {
  MARKET_ARCHIVE_MAX_BYTES,
  MARKET_ARCHIVE_INFLATED_MAX_BYTES,
  MARKET_ARCHIVE_MAX_ENTRIES,
  MARKET_ASSET_MAX_BYTES,
  MARKET_DOCUMENT_MAX_BYTES,
  type MarketPersona,
} from '@personamarket/contracts';
import { parseMarketPersona } from './market.js';
import { ImportParseError } from './parser.js';
import { marketLicenseText } from './archive.js';

type ArchiveAsset = MarketPersona['assets'][number];
class ArchiveSinkError extends Error {
  constructor(cause: unknown) {
    super('ARCHIVE_SINK_FAILED', { cause });
  }
}
const permittedName =
  /^(persona\.json|README\.md|LICENSE\.txt|assets\/|assets\/[a-f0-9-]{36}\.(png|jpe?g|webp))$/;
function invalid(message: string): never {
  throw new ImportParseError('INVALID_FORMAT', message);
}
function text(bytes: Uint8Array) {
  try {
    const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (value.includes('\0')) invalid('归档文本包含无效字符');
    return value;
  } catch (cause) {
    if (cause instanceof ImportParseError) throw cause;
    throw new ImportParseError('INVALID_ENCODING', '归档文本需要使用UTF-8编码', { cause });
  }
}
function extras(bytes: Buffer) {
  // v1只接受ZIP64大小与标准时间，不接受链接、路径覆盖或其他扩展语义
  if (parseExtraFields(bytes).some((field) => ![0x0001, 0x5455].includes(field.id)))
    invalid('归档包含不支持的文件扩展字段');
}
function entryLimit(name: string) {
  if (name === 'assets/') return 0;
  if (name === 'persona.json') return MARKET_DOCUMENT_MAX_BYTES;
  if (name === 'README.md') return 30000 * 4;
  if (name === 'LICENSE.txt') return 65536;
  return MARKET_ASSET_MAX_BYTES;
}
async function read(
  archive: ZipFile,
  entry: Entry,
  signal: AbortSignal,
  budget: { actual: number },
) {
  signal.throwIfAborted();
  const stream = addAbortSignal(signal, await archive.openReadStreamPromise(entry));
  const chunks: Uint8Array[] = [];
  let size = 0;
  let checksum = 0;
  try {
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array)) invalid('归档数据无法读取');
      signal.throwIfAborted();
      size += chunk.byteLength;
      budget.actual += chunk.byteLength;
      if (size > entryLimit(entry.fileName) || budget.actual > MARKET_ARCHIVE_INFLATED_MAX_BYTES)
        throw new ImportParseError('IMPORT_TOO_LARGE', '归档实际解压大小超过上限');
      checksum = crc32(chunk, checksum);
      chunks.push(chunk);
    }
    if (size !== entry.uncompressedSize || checksum !== entry.crc32)
      invalid('归档文件大小或CRC校验不一致');
    return Buffer.concat(chunks, size);
  } finally {
    stream.destroy();
  }
}

/** 有界内存输入；不解压到路径、不联网，图片逐张交付给受控暂存层 */
export async function parseMarketArchive(
  bytes: Uint8Array,
  receiveAsset: (asset: ArchiveAsset, bytes: Uint8Array) => Promise<void>,
  options?: { signal?: AbortSignal; onDocument?: (document: MarketPersona) => Promise<void> },
) {
  if (bytes.byteLength > MARKET_ARCHIVE_MAX_BYTES)
    throw new ImportParseError('IMPORT_TOO_LARGE', '完整包不能超过128MiB');
  const signal = options?.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
    : AbortSignal.timeout(30000);
  signal.throwIfAborted();
  // 调用方持有上传缓冲区，解析期间不改变；不再复制最多128MiB的整包
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50)
    invalid('请选择有效的完整人设ZIP包');
  let archive: ZipFile | undefined;
  try {
    archive = await fromBufferPromise(buffer, {
      lazyEntries: true,
      autoClose: false,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    if (archive.entryCount > MARKET_ARCHIVE_MAX_ENTRIES)
      throw new ImportParseError('IMPORT_TOO_LARGE', '归档文件数量超过128条');
    const entries = new Map<string, Entry>();
    const ranges: Array<{ start: number; end: number }> = [];
    let declared = 0;
    for await (const entry of archive.eachEntry()) {
      signal.throwIfAborted();
      const name = entry.fileName;
      if (!permittedName.test(name) || !entry.fileNameRaw.equals(Buffer.from(name, 'ascii')))
        invalid('归档包含不允许的文件名或路径');
      if (entries.has(name)) invalid('归档包含重复文件');
      if (entries.size >= MARKET_ARCHIVE_MAX_ENTRIES)
        throw new ImportParseError('IMPORT_TOO_LARGE', '归档文件数量超过128条');
      const kind = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (kind !== 0 && kind !== (name === 'assets/' ? 0x4000 : 0x8000))
        invalid('归档不能包含链接或特殊文件');
      if ((entry.externalFileAttributes & 0x410) !== (name === 'assets/' ? 0x10 : 0))
        invalid('归档文件属性无效');
      if (
        (entry.generalPurposeBitFlag & ~0x080e) !== 0 ||
        ![0, 8].includes(entry.compressionMethod)
      )
        invalid('归档不能加密或使用不支持的压缩方式');
      if (
        entry.uncompressedSize > entryLimit(name) ||
        entry.compressedSize > MARKET_ARCHIVE_MAX_BYTES
      )
        throw new ImportParseError('IMPORT_TOO_LARGE', '归档文件大小超过上限');
      declared += entry.uncompressedSize;
      if (declared > MARKET_ARCHIVE_INFLATED_MAX_BYTES)
        throw new ImportParseError('IMPORT_TOO_LARGE', '归档解压总量超过160MiB');
      extras(entry.extraFieldRaw);
      const header = await archive.readLocalFileHeaderPromise(entry);
      if (
        !header.fileName.equals(entry.fileNameRaw) ||
        header.generalPurposeBitFlag !== entry.generalPurposeBitFlag ||
        header.compressionMethod !== entry.compressionMethod
      )
        invalid('归档目录与本地文件头不一致');
      extras(header.extraField);
      if (
        !(entry.generalPurposeBitFlag & 8) &&
        (header.crc32 !== entry.crc32 ||
          header.compressedSize !== entry.compressedSize ||
          header.uncompressedSize !== entry.uncompressedSize)
      )
        invalid('归档文件头校验信息不一致');
      ranges.push({
        start: entry.relativeOffsetOfLocalHeader,
        end: header.fileDataStart + entry.compressedSize,
      });
      entries.set(name, entry);
    }
    ranges.sort((a, b) => a.start - b.start);
    for (let index = 1; index < ranges.length; index++) {
      const previous = ranges[index - 1];
      const current = ranges[index];
      if (previous && current && current.start < previous.end) invalid('归档文件区域重叠');
    }
    const budget = { actual: 0 };
    const opened = archive;
    const get = async (name: string) => {
      const entry = entries.get(name);
      if (!entry) invalid('完整包缺少清单、README或来源许可文件');
      return read(opened, entry, signal, budget);
    };
    const document = parseMarketPersona(await get('persona.json'), 'zip');
    const expected = new Set(['persona.json', 'README.md', 'LICENSE.txt', 'assets/']);
    for (const asset of document.assets) {
      if (!('path' in asset)) invalid('完整包素材必须使用包内路径');
      if (!entries.has(asset.path)) invalid('归档缺少清单声明的图片');
      expected.add(asset.path);
    }
    if ([...entries.keys()].some((name) => !expected.has(name))) invalid('归档包含未声明的图片');
    if (text(await get('README.md')) !== document.metadata.readmeMarkdown)
      invalid('归档README与人设清单不一致');
    const licenseText = text(await get('LICENSE.txt'));
    if (!licenseText.trim()) invalid('归档缺少来源许可说明');
    if (
      licenseText.replaceAll('\r\n', '\n') !== marketLicenseText(document).replaceAll('\r\n', '\n')
    )
      invalid('包内许可说明与清单不一致，请核对来源和转载规则后重新打包');
    if (entries.has('assets/')) await get('assets/');
    if (options?.onDocument) {
      try {
        await options.onDocument(structuredClone(document));
      } catch (cause) {
        throw new ArchiveSinkError(cause);
      }
    }
    for (const asset of document.assets) {
      signal.throwIfAborted();
      if (!('path' in asset)) invalid('完整包素材必须使用包内路径');
      const data = await get(asset.path);
      if (
        data.byteLength !== asset.bytes ||
        createHash('sha256').update(data).digest('hex') !== asset.sha256
      )
        invalid('图片实际大小或SHA-256与清单不一致');
      try {
        await receiveAsset(asset, data);
      } catch (cause) {
        throw new ArchiveSinkError(cause);
      }
    }
    signal.throwIfAborted();
    return { document, licenseText };
  } catch (cause) {
    if (signal.aborted) {
      if (options?.signal?.aborted) throw options.signal.reason;
      throw new ImportParseError('IMPORT_TOO_COMPLEX', '归档处理超过30秒，请减少内容后重试', {
        cause,
      });
    }
    if (cause instanceof ArchiveSinkError) throw cause.cause;
    if (cause instanceof ImportParseError) throw cause;
    throw new ImportParseError('INVALID_FORMAT', '归档损坏或使用不支持的文件结构', { cause });
  } finally {
    archive?.close();
  }
}
