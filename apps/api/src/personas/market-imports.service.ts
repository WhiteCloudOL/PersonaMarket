import { Inject, Injectable } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { type MarketImportConfirmSchema, type ImportTextEncoding } from '@personamarket/contracts';
import {
  parseMarketPersonaFile,
  parseMarketArchive,
  ImportParseError,
} from '@personamarket/persona-adapters';
import {
  LocalStorage,
  BusinessError,
  readTransferSettings,
  assertTransferImport,
  stageMarketImage,
  pruneMarketImports,
  checkedImageUrl,
  createLogger,
  assertOrdinaryRequestAllowed,
  type ServerEnvironment,
} from '@personamarket/server';
import { ENVIRONMENT } from '../tokens.js';
import { AuthService } from '../auth/auth.service.js';
import { MarketImportsRepository } from './market-imports.repository.js';
import { importFilename } from './import-filename.js';

@Injectable()
export class MarketImportsService {
  private readonly storage;
  private readonly logger;
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(MarketImportsRepository) readonly repository: MarketImportsRepository,
    @Inject(ENVIRONMENT) env: ServerEnvironment,
  ) {
    this.storage = new LocalStorage(env.STORAGE_ROOT);
    this.logger = createLogger('api-import', env.LOG_LEVEL);
  }
  async preview(
    request: Request,
    bytes: Buffer,
    originalName: string,
    signal: AbortSignal,
    encoding: ImportTextEncoding,
  ) {
    const actor = await this.auth.identity(request);
    await assertOrdinaryRequestAllowed(this.repository.database);
    const format =
      bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50 ? 'market-zip' : 'market-json';
    assertTransferImport(
      await readTransferSettings(this.repository.database.db),
      format,
      bytes.length,
    );
    const filename = importFilename(originalName);
    const id = randomUUID();
    let started = false;
    try {
      signal.throwIfAborted();
      await pruneMarketImports(this.repository.database);
      if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) {
        await parseMarketArchive(
          bytes,
          async (asset, value) =>
            stageMarketImage(this.repository.database, this.storage, id, asset.key, value),
          {
            signal,
            onDocument: async (document) => {
              await this.repository.begin(
                actor,
                id,
                filename,
                'market-zip',
                document,
                bytes.length,
              );
              started = true;
            },
          },
        );
      } else {
        const parsed = parseMarketPersonaFile(bytes, encoding);
        await this.repository.begin(
          actor,
          id,
          filename,
          'market-json',
          parsed.document,
          bytes.length,
          parsed,
        );
        started = true;
      }
      signal.throwIfAborted();
      return await this.repository.complete(actor, id);
    } catch (cause) {
      if (started) {
        try {
          await this.repository.fail(actor, id);
          await pruneMarketImports(this.repository.database);
        } catch {
          this.logger.error({ event: 'import.cleanup_deferred', code: 'DATABASE_UNAVAILABLE' });
        }
      }
      if (cause instanceof ImportParseError)
        throw new BusinessError('UNSUPPORTED_FORMAT', cause.message, { cause });
      if (signal.aborted) throw new BusinessError('CONFLICT', '文件预览已取消，请重新选择文件');
      throw cause;
    }
  }
  async read(request: Request, id: string) {
    return this.repository.read(await this.auth.identity(request), id);
  }
  async discard(request: Request, id: string) {
    return this.repository.discard(await this.auth.identity(request), id);
  }
  async queueImage(request: Request, id: string, assetId: string) {
    const actor = await this.auth.identity(request);
    if (!actor.account.emailVerifiedAt)
      throw new BusinessError('FORBIDDEN', '请先验证邮箱后再导入在线图片');
    await this.auth.rate.take('market-image-import', actor.account.id, 10, 900);
    // 此处仅做地址结构检查；Worker对每一跳DNS/连接/TLS和实际字节重新验证
    const image = await this.repository.declaredImage(actor, id, assetId, true);
    if (!image?.sourceUrl) throw new BusinessError('NOT_FOUND', '待确认的在线图片不存在');
    checkedImageUrl(image.sourceUrl);
    return this.repository.queueImage(actor, id, assetId);
  }
  async imageList(request: Request, id: string) {
    return this.repository.imageList(await this.auth.identity(request), id);
  }
  async uploadImage(request: Request, id: string, assetId: string, bytes: Buffer) {
    const actor = await this.auth.identity(request);
    await assertOrdinaryRequestAllowed(this.repository.database);
    const declared = await this.repository.declaredImage(actor, id, assetId, true);
    await stageMarketImage(this.repository.database, this.storage, id, declared.packageKey, bytes);
    await this.repository.renewAfterImage(actor, id);
    return this.repository.imageList(actor, id);
  }
  async image(request: Request, response: Response, id: string, assetId: string) {
    const image = await this.repository.image(await this.auth.identity(request), id, assetId);
    const bytes = await this.storage.read(image.storageKey).catch(() => {
      throw new BusinessError('NOT_FOUND', '临时图片暂时无法读取，请重新选择文件');
    });
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(Buffer.from(bytes));
  }
  async confirm(request: Request, input: z.infer<typeof MarketImportConfirmSchema>) {
    const actor = await this.auth.identity(request);
    await this.auth.rate.take('market-import-confirm', actor.account.id, 20, 3600);
    return this.repository.confirm(actor, input, async (image) => {
      const bytes = await this.storage.read(image.storageKey).catch(() => {
        throw new BusinessError('NOT_FOUND', '临时图片缺失，请重新选择文件');
      });
      if (
        bytes.byteLength !== image.bytes ||
        createHash('sha256').update(bytes).digest('hex') !== image.sha256
      )
        throw new BusinessError('NOT_FOUND', '临时图片校验失败，请重新选择文件');
    });
  }
}
