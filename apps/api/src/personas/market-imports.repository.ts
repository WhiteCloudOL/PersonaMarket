import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, count, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  marketImports,
  marketImportAssets,
  assets,
  categories,
  tags,
  outboxEvents,
  type Database,
} from '@personamarket/database';
import {
  MarketImportPreviewResponseSchema,
  MarketImportImageListResponseSchema,
  MarketPersonaSchema,
  PersonaDraftSchema,
  IdSchema,
  canonicalJson,
  type MarketPersona,
  type MarketImportConfirmSchema,
  ImportSourceEncodingSchema,
  type ImportSourceEncoding,
} from '@personamarket/contracts';
import { remapMarkdownImages } from '@personamarket/persona-adapters';
import {
  BusinessError,
  readTransferSettings,
  assertTransferImport,
  assertAssetQuota,
  assertImageImportCapacity,
  readMediaSettings,
  assertMediaImage,
  assertMediaImageSize,
  assertMediaRemote,
  pruneMarketImports,
  assertOrdinaryWriteAllowed,
} from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { PersonasRepository } from './personas.repository.js';

const StoredSchema = z.strictObject({
  document: MarketPersonaSchema,
  dialogueIds: z.array(IdSchema).max(100),
  categoryId: IdSchema.nullable(),
  tagIds: z.array(IdSchema).max(8),
  warnings: z.array(z.string()).max(32),
  sourceEncoding: ImportSourceEncodingSchema.optional(),
});
type PreviewRow = typeof marketImports.$inferSelect;
type ImageRow = typeof marketImportAssets.$inferSelect;
function usable<T extends Pick<PreviewRow, 'state' | 'expiresAt' | 'consumedAt'>>(
  row: T | undefined,
  consumed = false,
): asserts row is T {
  if (!row) throw new BusinessError('NOT_FOUND', '导入预览不存在或不可访问');
  if (row.expiresAt.getTime() <= Date.now())
    throw new BusinessError('CONFLICT', '导入预览已过期，请重新选择文件');
  if (row.state !== 'ready' || (!consumed && row.consumedAt))
    throw new BusinessError('CONFLICT', '预览尚未就绪或已用于导入');
}
@Injectable()
export class MarketImportsRepository {
  constructor(
    @Inject(DATABASE) readonly database: Database,
    @Inject(PersonasRepository) readonly personas: PersonasRepository,
  ) {}
  async begin(
    actor: Identity,
    id: string,
    filename: string,
    format: 'market-json' | 'market-zip',
    document: MarketPersona,
    inputBytes: number,
    decoding?: { sourceEncoding: ImportSourceEncoding; warnings: string[] },
  ) {
    await this.database.db.transaction(async (tx) => {
      await lockIdentity(tx, actor, false, false);
      await assertOrdinaryWriteAllowed(tx);
      assertTransferImport(await readTransferSettings(tx, true), format, inputBytes);
      if (document.assets.length) {
        const media = await readMediaSettings(tx, true);
        if (!media.uploadsEnabled && !media.remoteImportsEnabled)
          throw new BusinessError('FORBIDDEN', '管理员已关闭图片上传和在线图片导入');
        for (const image of document.assets) {
          if (format === 'market-zip') assertMediaImage(media, image.bytes);
          else assertMediaImageSize(media, image.bytes);
        }
      }
      const [total] = await tx
        .select({ value: count() })
        .from(marketImports)
        .where(eq(marketImports.ownerId, actor.account.id));
      if ((total?.value ?? 0) >= 20)
        throw new BusinessError('CONFLICT', '预览较多，请等待旧预览过期后重试');
      if (document.assets.length)
        await assertAssetQuota(
          tx,
          actor.account.id,
          document.assets.length,
          document.assets.reduce((sum, image) => sum + image.bytes, 0),
        );
      const categoryRows = document.metadata.categoryName
        ? await tx
            .select()
            .from(categories)
            .where(
              and(eq(categories.active, true), eq(categories.name, document.metadata.categoryName)),
            )
            .for('share')
        : [];
      const tagRows = document.metadata.tagNames.length
        ? await tx
            .select()
            .from(tags)
            .where(and(eq(tags.active, true), inArray(tags.name, document.metadata.tagNames)))
            .for('share')
        : [];
      const warnings = [
        ...(decoding?.warnings ?? []),
        '导入仅生成本人私有草稿，不会恢复源站身份、审核状态或授权证据',
      ];
      if (document.metadata.categoryName && !categoryRows.length)
        warnings.push('源分类尚未对应本站分类，请在草稿中重新选择');
      if (tagRows.length !== document.metadata.tagNames.length)
        warnings.push('部分标签尚未对应本站标签，请在草稿中补充');
      if (format === 'market-json' && document.assets.length)
        warnings.push('JSON不包含图片本体，需逐张确认并安全托管后才能完成导入');
      const stored = StoredSchema.parse({
        document,
        ...(decoding ? { sourceEncoding: decoding.sourceEncoding } : {}),
        dialogueIds:
          document.platform === 'astrbot'
            ? document.content.dialoguePairs.map(() => randomUUID())
            : [],
        categoryId: categoryRows[0]?.id ?? null,
        tagIds: document.metadata.tagNames.flatMap((name) =>
          tagRows.filter((tag) => tag.name === name).map((tag) => tag.id),
        ),
        warnings,
      });
      await tx.insert(marketImports).values({
        id,
        ownerId: actor.account.id,
        format,
        inputBytes,
        state: 'processing',
        filename,
        contentHash: createHash('sha256').update(canonicalJson(document)).digest('hex'),
        document: stored,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      });
      if (document.assets.length)
        await tx.insert(marketImportAssets).values(
          document.assets.map((image) => ({
            id: randomUUID(),
            previewId: id,
            packageKey: image.key,
            storageKey: randomUUID().replaceAll('-', '') + '.webp',
            ...('url' in image ? { sourceUrl: image.url } : {}),
            expectedMime: image.mimeType,
            expectedBytes: image.bytes,
            expectedHash: image.sha256,
          })),
        );
    });
  }
  async complete(actor: Identity, id: string) {
    await this.database.db.transaction(async (tx) => {
      await lockIdentity(tx, actor, false, false);
      await assertOrdinaryWriteAllowed(tx);
      const [row] = await tx
        .select()
        .from(marketImports)
        .where(and(eq(marketImports.id, id), eq(marketImports.ownerId, actor.account.id)))
        .for('update');
      if (!row || row.expiresAt.getTime() <= Date.now() || row.state !== 'processing')
        throw new BusinessError('CONFLICT', '导入预览已过期，请重新选择文件');
      const images = await tx
        .select()
        .from(marketImportAssets)
        .where(eq(marketImportAssets.previewId, id));
      if (row.format === 'market-zip' && images.some((image) => image.status !== 'ready'))
        throw new BusinessError('CONFLICT', '包内图片尚未处理完成');
      await tx.update(marketImports).set({ state: 'ready' }).where(eq(marketImports.id, id));
    });
    return this.read(actor, id);
  }
  async fail(actor: Identity, id: string) {
    await this.database.db
      .update(marketImports)
      .set({ state: 'failed', expiresAt: new Date() })
      .where(and(eq(marketImports.id, id), eq(marketImports.ownerId, actor.account.id)));
  }
  private async renewWithin(tx: Transaction, row: PreviewRow) {
    await tx
      .update(marketImports)
      .set({
        expiresAt: new Date(
          Math.min(Date.now() + 30 * 60 * 1000, row.createdAt.getTime() + 60 * 60 * 1000),
        ),
      })
      .where(eq(marketImports.id, row.id));
  }
  async renewAfterImage(actor: Identity, id: string) {
    await this.database.db.transaction(async (tx) => {
      await lockIdentity(tx, actor, false, false);
      await assertOrdinaryWriteAllowed(tx);
      const [row] = await tx
        .select()
        .from(marketImports)
        .where(and(eq(marketImports.id, id), eq(marketImports.ownerId, actor.account.id)))
        .for('update');
      usable(row);
      assertTransferImport(await readTransferSettings(tx, true), row.format, row.inputBytes);
      await this.renewWithin(tx, row);
    });
  }
  async discard(actor: Identity, id: string) {
    await this.database.db.transaction(async (tx) => {
      await lockIdentity(tx, actor, false, false);
      await assertOrdinaryWriteAllowed(tx);
      const [row] = await tx
        .select()
        .from(marketImports)
        .where(and(eq(marketImports.id, id), eq(marketImports.ownerId, actor.account.id)))
        .for('update');
      if (!row) throw new BusinessError('NOT_FOUND', '预览已过期或不可访问');
      if (row.consumedAt) throw new BusinessError('CONFLICT', '该预览已完成导入，请到草稿中管理');
      await tx
        .update(marketImports)
        .set({ state: 'failed', expiresAt: new Date() })
        .where(eq(marketImports.id, id));
    });
    await pruneMarketImports(this.database);
    return { data: { id, cancelled: true as const } };
  }
  private draft(row: PreviewRow, images: ImageRow[]) {
    const stored = StoredSchema.parse(row.document);
    const document = stored.document;
    const metadata = document.metadata;
    const mapped = new Map(images.map((image) => [image.packageKey, image.id]));
    const imageId = (key: string) => {
      const id = mapped.get(key);
      if (!id) throw new Error('IMPORT_ASSET_MAPPING_MISSING');
      return id;
    };
    const replacements = new Map(
      document.assets.map((image) => [
        'path' in image ? image.path : `asset://${image.key}`,
        `asset://${imageId(image.key)}`,
      ]),
    );
    const origin =
      metadata.origin.type === 'repost'
        ? metadata.origin
        : {
            ...metadata.origin,
            type: 'repost' as const,
            originalAuthor: document.source?.publisherName ?? '',
            ...(document.source?.personaUrl ? { sourceUrl: document.source.personaUrl } : {}),
            sourceDescription: '导入文件：' + row.filename,
            authorizationStatement: '',
          };
    const content =
      document.platform === 'maibot'
        ? { platform: document.platform, content: document.content }
        : {
            platform: document.platform,
            content: {
              systemPrompt: document.content.systemPrompt,
              dialoguePairs: document.content.dialoguePairs.map((pair, index) => {
                const id = stored.dialogueIds[index];
                if (!id) throw new Error('IMPORT_DIALOGUE_MAPPING_MISSING');
                return { ...pair, id };
              }),
            },
          };
    return {
      stored,
      draft: PersonaDraftSchema.parse({
        ...content,
        schemaVersion: 1,
        title: metadata.title,
        summary: metadata.summary,
        categoryId: stored.categoryId,
        tagIds: stored.tagIds,
        readmeMarkdown: remapMarkdownImages(metadata.readmeMarkdown, replacements),
        recommendedModels: metadata.recommendedModels,
        authorNotes: metadata.authorNotes,
        origin,
        rightsAccepted: false,
        evidenceAssetIds: [],
        ...(metadata.avatarKey ? { avatarAssetId: imageId(metadata.avatarKey) } : {}),
        ...(metadata.coverKey ? { coverAssetId: imageId(metadata.coverKey) } : {}),
      }),
    };
  }
  async read(actor: Identity, id: string) {
    const [row] = await this.database.db
      .select()
      .from(marketImports)
      .where(and(eq(marketImports.id, id), eq(marketImports.ownerId, actor.account.id)));
    usable(row);
    const images = await this.database.db
      .select()
      .from(marketImportAssets)
      .where(eq(marketImportAssets.previewId, id));
    const { stored, draft } = this.draft(row, images);
    return MarketImportPreviewResponseSchema.parse({
      data: {
        id: row.id,
        format: row.format,
        filename: row.filename,
        contentHash: row.contentHash,
        expiresAt: row.expiresAt.toISOString(),
        ...(stored.sourceEncoding ? { sourceEncoding: stored.sourceEncoding } : {}),
        draft,
        declaredOrigin: stored.document.metadata.origin,
        source: stored.document.source,
        categoryName: stored.document.metadata.categoryName,
        tagNames: stored.document.metadata.tagNames,
        images: images.map((image) => ({
          id: image.id,
          key: image.packageKey,
          status: image.status,
          mimeType: image.expectedMime,
          bytes: image.expectedBytes,
          ...(image.sourceUrl ? { sourceUrl: image.sourceUrl } : {}),
        })),
        warnings: stored.warnings,
      },
    });
  }
  async image(actor: Identity, id: string, assetId: string) {
    const image = await this.declaredImage(actor, id, assetId);
    if (image.status !== 'ready') throw new BusinessError('NOT_FOUND', '图片尚未完成托管');
    return image;
  }
  async declaredImage(actor: Identity, id: string, assetId: string, writing = false) {
    const [row] = await this.database.db
      .select({
        image: marketImportAssets,
        preview: {
          format: marketImports.format,
          inputBytes: marketImports.inputBytes,
          state: marketImports.state,
          expiresAt: marketImports.expiresAt,
          consumedAt: marketImports.consumedAt,
        },
      })
      .from(marketImportAssets)
      .innerJoin(marketImports, eq(marketImports.id, marketImportAssets.previewId))
      .where(
        and(
          eq(marketImportAssets.id, assetId),
          eq(marketImportAssets.previewId, id),
          eq(marketImports.ownerId, actor.account.id),
        ),
      );
    if (!row) throw new BusinessError('NOT_FOUND', '导入图片不存在或不可访问');
    usable(row.preview);
    if (writing)
      assertTransferImport(
        await readTransferSettings(this.database.db),
        row.preview.format,
        row.preview.inputBytes,
      );
    return row.image;
  }
  async imageList(actor: Identity, id: string) {
    const [row] = await this.database.db
      .select({
        state: marketImports.state,
        expiresAt: marketImports.expiresAt,
        consumedAt: marketImports.consumedAt,
      })
      .from(marketImports)
      .where(and(eq(marketImports.id, id), eq(marketImports.ownerId, actor.account.id)));
    usable(row);
    const images = await this.database.db
      .select()
      .from(marketImportAssets)
      .where(eq(marketImportAssets.previewId, id));
    return MarketImportImageListResponseSchema.parse({
      data: images.map((image) => ({
        id: image.id,
        key: image.packageKey,
        status: image.status,
        mimeType: image.expectedMime,
        bytes: image.expectedBytes,
        ...(image.sourceUrl ? { sourceUrl: image.sourceUrl } : {}),
      })),
    });
  }
  async queueImage(actor: Identity, id: string, assetId: string) {
    await this.database.db.transaction(async (tx) => {
      await lockIdentity(tx, actor, false, false);
      const [completed] = await tx
        .select()
        .from(marketImports)
        .where(and(eq(marketImports.id, id), eq(marketImports.ownerId, actor.account.id)));
      usable(completed);
      const [existing] = await tx
        .select()
        .from(marketImportAssets)
        .where(and(eq(marketImportAssets.id, assetId), eq(marketImportAssets.previewId, id)));
      if (!existing?.sourceUrl) throw new BusinessError('NOT_FOUND', '待确认的在线图片不存在');
      // 已排队/完成只返回现有图片状态，不续期、不再次排 Outbox。
      if (['ready', 'queued', 'processing'].includes(existing.status)) return;
      await assertOrdinaryWriteAllowed(tx);
      const [row] = await tx
        .select()
        .from(marketImports)
        .where(and(eq(marketImports.id, id), eq(marketImports.ownerId, actor.account.id)))
        .for('update');
      usable(row);
      const [image] = await tx
        .select()
        .from(marketImportAssets)
        .where(and(eq(marketImportAssets.id, assetId), eq(marketImportAssets.previewId, id)))
        .for('update');
      if (!image?.sourceUrl) throw new BusinessError('NOT_FOUND', '待确认的在线图片不存在');
      if (['ready', 'queued', 'processing'].includes(image.status)) return;
      assertTransferImport(await readTransferSettings(tx, true), row.format, row.inputBytes);
      assertMediaRemote(await readMediaSettings(tx, true), image.sourceUrl);
      await assertImageImportCapacity(tx, actor.account.id);
      await this.renewWithin(tx, row);
      await tx
        .update(marketImportAssets)
        .set({ status: 'queued' })
        .where(eq(marketImportAssets.id, assetId));
      await tx
        .insert(outboxEvents)
        .values({ topic: 'market.image', payload: { schemaVersion: 1, assetId } });
    });
    return this.imageList(actor, id);
  }
  async confirm(
    actor: Identity,
    input: z.infer<typeof MarketImportConfirmSchema>,
    verifyImage: (image: ImageRow) => Promise<void>,
  ) {
    const hash = createHash('sha256').update(canonicalJson(input)).digest('hex');
    const id = await this.database.db.transaction(async (tx) => {
      await lockIdentity(tx, actor, false, false);
      const [completed] = await tx
        .select()
        .from(marketImports)
        .where(
          and(eq(marketImports.id, input.previewId), eq(marketImports.ownerId, actor.account.id)),
        );
      usable(completed, true);
      if (completed.contentHash !== input.contentHash)
        throw new BusinessError('CONFLICT', '导入内容已变化，请重新预览');
      if (completed.resultPersonaId) {
        if (completed.confirmationHash !== hash)
          throw new BusinessError('CONFLICT', '预览已用于另一次导入，请重新选择文件');
        return completed.resultPersonaId;
      }
      await assertOrdinaryWriteAllowed(tx);
      const [row] = await tx
        .select()
        .from(marketImports)
        .where(
          and(eq(marketImports.id, input.previewId), eq(marketImports.ownerId, actor.account.id)),
        )
        .for('update');
      usable(row, true);
      if (row.contentHash !== input.contentHash)
        throw new BusinessError('CONFLICT', '导入内容已变化，请重新预览');
      if (row.resultPersonaId) {
        if (row.confirmationHash !== hash)
          throw new BusinessError('CONFLICT', '预览已用于另一次导入，请重新选择文件');
        return row.resultPersonaId;
      }
      assertTransferImport(await readTransferSettings(tx, true), row.format, row.inputBytes);
      const images = await tx
        .select()
        .from(marketImportAssets)
        .where(eq(marketImportAssets.previewId, row.id));
      if (images.some((image) => image.status !== 'ready'))
        throw new BusinessError('CONFLICT', '请先确认并完成所有图片托管');
      if (images.length) await assertAssetQuota(tx, actor.account.id, 0, 0);
      for (const image of images) {
        if (
          image.bytes === null ||
          image.width === null ||
          image.height === null ||
          image.sha256 === null
        )
          throw new Error('IMPORT_ASSET_NOT_READY');
        await verifyImage(image);
        await tx.insert(assets).values({
          id: image.id,
          ownerId: actor.account.id,
          purpose: 'content',
          storageKey: image.storageKey,
          mime: 'image/webp',
          bytes: image.bytes,
          width: image.width,
          height: image.height,
          sha256: image.sha256,
          sourceUrl: image.sourceUrl,
        });
      }
      const prepared = this.draft(row, images).draft;
      const origin = prepared.origin;
      if (origin.type !== 'repost') throw new Error('IMPORT_ORIGIN_INVALID');
      const draft = PersonaDraftSchema.parse({
        ...prepared,
        title: input.title,
        origin: {
          ...origin,
          sourceDescription: input.sourceDescription,
          authorizationStatement: input.authorizationStatement,
        },
      });
      const personaId = await this.save(tx, actor, input, draft);
      await tx.delete(marketImportAssets).where(eq(marketImportAssets.previewId, row.id));
      await tx
        .update(marketImports)
        .set({ resultPersonaId: personaId, confirmationHash: hash, consumedAt: new Date() })
        .where(eq(marketImports.id, row.id));
      return personaId;
    });
    return this.personas.read(actor, id);
  }
  private async save(
    tx: Transaction,
    actor: Identity,
    input: z.infer<typeof MarketImportConfirmSchema>,
    draft: z.infer<typeof PersonaDraftSchema>,
  ) {
    if (input.target.mode === 'replace') {
      await this.personas.saveWithin(
        tx,
        actor,
        input.target.personaId,
        draft,
        input.target.expectedRevision,
      );
      return input.target.personaId;
    }
    return this.personas.createWithin(
      tx,
      actor,
      { platform: draft.platform, title: input.title },
      draft,
    );
  }
}
