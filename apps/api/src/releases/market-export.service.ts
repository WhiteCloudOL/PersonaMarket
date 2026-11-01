import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  IdSchema,
  MarketPersonaSchema,
  MARKET_FORMAT,
  MARKET_SCHEMA_VERSION,
  type PublicReleaseSchema,
} from '@personamarket/contracts';
import {
  inspectMarkdownImages,
  remapMarkdownImages,
  serializeMarketPersona,
  ImportParseError,
  createMarketArchive,
  type MarketMedium,
} from '@personamarket/persona-adapters';
import {
  BusinessError,
  LocalStorage,
  createLogger,
  type ServerEnvironment,
} from '@personamarket/server';
import { ENVIRONMENT } from '../tokens.js';
import { PublicationsRepository } from './publications.repository.js';

@Injectable()
export class MarketExportService {
  private readonly storage;
  private readonly logger;
  constructor(
    @Inject(PublicationsRepository) readonly publications: PublicationsRepository,
    @Inject(ENVIRONMENT) readonly env: ServerEnvironment,
  ) {
    this.storage = new LocalStorage(env.STORAGE_ROOT);
    this.logger = createLogger('api-export', env.LOG_LEVEL);
  }
  private async document(release: z.infer<typeof PublicReleaseSchema>, medium: MarketMedium) {
    const snapshot = release.snapshot;
    const replacements = new Map<string, string>();
    const ids = new Set<string>();
    for (const url of inspectMarkdownImages(snapshot.readmeMarkdown).urls) {
      const parsed = IdSchema.safeParse(/^asset:\/\/(.+)$/i.exec(url)?.[1]);
      if (!parsed.success)
        throw new BusinessError('UNSUPPORTED_FORMAT', '该版本仍有未托管的README图片');
      const id = parsed.data.toLowerCase();
      ids.add(id);
      replacements.set(url, id);
    }
    for (const id of [snapshot.avatarAssetId, snapshot.coverAssetId])
      if (id) ids.add(id.toLowerCase());
    const assets = await this.publications.exportAssets(release.personaId, release.releaseId, [
      ...ids,
    ]);
    const paths = new Map(
      assets.map((asset) => [
        asset.id,
        `assets/${asset.id}.${asset.mime === 'image/png' ? 'png' : asset.mime === 'image/jpeg' ? 'jpg' : 'webp'}`,
      ]),
    );
    for (const [url, id] of replacements) {
      const path = paths.get(id);
      if (!path) throw new BusinessError('NOT_FOUND', '该版本的图片不可导出');
      replacements.set(url, medium === 'zip' ? path : 'asset://' + id);
    }
    const document = MarketPersonaSchema.safeParse({
      format: MARKET_FORMAT,
      schemaVersion: MARKET_SCHEMA_VERSION,
      platform: snapshot.platform,
      content:
        snapshot.platform === 'maibot'
          ? snapshot.content
          : {
              systemPrompt: snapshot.content.systemPrompt,
              dialoguePairs: snapshot.content.dialoguePairs.map(({ user, assistant }) => ({
                user,
                assistant,
              })),
            },
      metadata: {
        title: snapshot.title,
        summary: snapshot.summary,
        categoryName: release.publication.category.name,
        tagNames: release.publication.tags.map((tag) => tag.name),
        readmeMarkdown: remapMarkdownImages(snapshot.readmeMarkdown, replacements),
        recommendedModels: snapshot.recommendedModels,
        origin: snapshot.origin,
        authorNotes: snapshot.authorNotes ?? '',
        ...(snapshot.avatarAssetId ? { avatarKey: snapshot.avatarAssetId.toLowerCase() } : {}),
        ...(snapshot.coverAssetId ? { coverKey: snapshot.coverAssetId.toLowerCase() } : {}),
      },
      assets: assets.map((asset) => ({
        key: asset.id,
        mimeType: asset.mime,
        bytes: asset.bytes,
        sha256: asset.sha256,
        ...(medium === 'zip'
          ? { path: paths.get(asset.id) }
          : { url: new URL('/api/v1/public/assets/' + asset.id, this.env.PUBLIC_ORIGIN).href }),
      })),
      source: {
        siteUrl: this.env.PUBLIC_ORIGIN,
        personaUrl: new URL(
          `/personas/${release.personaId}/releases/${release.releaseId}`,
          this.env.PUBLIC_ORIGIN,
        ).href,
        publisherName: release.publication.publisher,
        version: release.version,
        changelog: release.changelog,
      },
    });
    if (!document.success)
      throw new BusinessError('UNSUPPORTED_FORMAT', '该版本的来源或素材资料不符合通用文件规则');
    return { document: document.data, assets };
  }
  async prepare(release: z.infer<typeof PublicReleaseSchema>, medium: MarketMedium = 'json') {
    const prepared = await this.document(release, medium);
    try {
      return serializeMarketPersona(prepared.document, medium);
    } catch (cause) {
      if (cause instanceof ImportParseError)
        throw new BusinessError('UNSUPPORTED_FORMAT', cause.message, { cause });
      throw cause;
    }
  }
  async downloadArchive(
    response: Response,
    release: z.infer<typeof PublicReleaseSchema>,
    filename: string,
    beforeSend: () => Promise<void>,
  ) {
    const prepared = await this.document(release, 'zip');
    const assets = new Map(prepared.assets.map((asset) => [asset.id, asset]));
    const read = async (key: string) => {
      const asset = assets.get(key);
      if (!asset) throw new BusinessError('NOT_FOUND', '该版本的图片不可导出');
      try {
        const bytes = await this.storage.read(asset.storageKey);
        if (
          bytes.byteLength !== asset.bytes ||
          createHash('sha256').update(bytes).digest('hex') !== asset.sha256
        )
          throw new Error('ARCHIVE_ASSET_INTEGRITY');
        return bytes;
      } catch (cause) {
        throw new BusinessError('NOT_FOUND', '该版本的图片暂时无法读取', { cause });
      }
    };
    // 发送ZIP头之前检查全部文件，不能把缺图包作为成功下载
    for (const asset of prepared.assets) {
      if (response.destroyed) return;
      await read(asset.id);
    }
    await this.publications.release(release.personaId, release.releaseId);
    if (response.destroyed) return;
    await beforeSend();
    const archive = createMarketArchive(prepared.document, read, new Date(release.publishedAt));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="persona-export.zip"; filename*=UTF-8\'\'' +
        encodeURIComponent(filename),
    );
    try {
      await pipeline(archive, response);
    } catch (cause) {
      this.logger.warn({
        event: 'export.archive.failed',
        requestId: response.locals['requestId'],
        code: cause instanceof ImportParseError ? cause.code : 'ARCHIVE_TRANSFER_FAILED',
      });
      if (response.headersSent || response.destroyed) {
        response.destroy();
        return;
      }
      throw new BusinessError('SERVICE_UNAVAILABLE', '归档暂时无法生成，请稍后重试', { cause });
    }
  }
}
