import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  ImportPreviewDataSchema,
  canonicalJson,
  type ImportPreviewRequestSchema,
  type ImportConfirmRequestSchema,
  type NativeImportFormatSchema,
  type ImportTextEncoding,
  type TextMappedPreviewRequestSchema,
  type TextImportFileQuerySchema,
  TextImportSourceResponseSchema,
} from '@personamarket/contracts';
import {
  parseMaiBot,
  parseAstrBot,
  ImportParseError,
  readManualImportText,
} from '@personamarket/persona-adapters';
import {
  BusinessError,
  readTransferSettings,
  assertTransferImport,
  assertOrdinaryRequestAllowed,
} from '@personamarket/server';
import { AuthService, type Identity } from '../auth/auth.service.js';
import { ImportsRepository } from './imports.repository.js';
import { importFilename } from './import-filename.js';
@Injectable()
export class ImportsService {
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(ImportsRepository) readonly repository: ImportsRepository,
  ) {}
  async authorizePreview(request: Request) {
    const actor = await this.auth.identity(request);
    await assertOrdinaryRequestAllowed(this.repository.database);
    await this.auth.rate.take('persona-import-preview', actor.account.id, 20, 3600);
    return actor;
  }
  async authorizeTextSource(request: Request) {
    const actor = await this.auth.identity(request);
    await assertOrdinaryRequestAllowed(this.repository.database);
    await this.auth.rate.take('persona-text-source', actor.account.id, 20, 3600);
    return actor;
  }
  async textSource(
    request: Request,
    bytes: Buffer,
    originalName: string,
    query: z.infer<typeof TextImportFileQuerySchema>,
    signal: AbortSignal,
  ) {
    await this.auth.identity(request);
    await assertOrdinaryRequestAllowed(this.repository.database);
    assertTransferImport(
      await readTransferSettings(this.repository.database.db),
      query.format,
      bytes.length,
    );
    const filename = importFilename(originalName);
    try {
      signal.throwIfAborted();
      const decoded = readManualImportText(bytes, query.encoding);
      signal.throwIfAborted();
      await assertOrdinaryRequestAllowed(this.repository.database);
      // 只供本次映射读取，完整原文不进入预览表、Storage或日志
      return TextImportSourceResponseSchema.parse({
        data: { format: query.format, filename, ...decoded },
      });
    } catch (cause) {
      if (signal.aborted)
        throw new BusinessError('CONFLICT', '文本读取已取消，当前文件仍可重新选择', { cause });
      if (cause instanceof ImportParseError)
        throw new BusinessError('UNSUPPORTED_FORMAT', cause.message, { cause });
      throw cause;
    }
  }
  async previewMappedText(request: Request, input: z.infer<typeof TextMappedPreviewRequestSchema>) {
    const actor = await this.authorizePreview(request);
    const persona =
      input.persona.platform === 'maibot'
        ? input.persona
        : {
            platform: 'astrbot' as const,
            content: {
              ...input.persona.content,
              dialoguePairs: input.persona.content.dialoguePairs.map((pair) => ({
                ...pair,
                id: randomUUID(),
              })),
            },
          };
    const inputBytes = Buffer.byteLength(canonicalJson(input.persona), 'utf8');
    return this.savePreparedPreview(
      actor,
      {
        format: input.format,
        filename: input.filename,
        persona,
        warnings: ['仅保存你已确认的映射字段，未映射的原文不会保存'],
        ignoredFields: [],
      },
      inputBytes,
    );
  }
  async preview(request: Request, input: z.infer<typeof ImportPreviewRequestSchema>) {
    const actor = await this.authorizePreview(request);
    return this.savePreview(actor, input, Buffer.from(input.source, 'utf8'));
  }
  async previewFile(
    request: Request,
    bytes: Buffer,
    originalName: string,
    format: z.infer<typeof NativeImportFormatSchema>,
    encoding: ImportTextEncoding,
    signal: AbortSignal,
  ) {
    // 上传可能持续一段时间，解析前重新检查实际会话；限流已在上传guard执行
    const actor = await this.auth.identity(request);
    return this.savePreview(
      actor,
      { format, filename: importFilename(originalName), encoding },
      bytes,
      signal,
    );
  }
  private async savePreview(
    actor: Identity,
    input: Pick<z.infer<typeof ImportPreviewRequestSchema>, 'format' | 'filename'> & {
      encoding?: ImportTextEncoding;
    },
    bytes: Buffer,
    signal?: AbortSignal,
  ) {
    try {
      await assertOrdinaryRequestAllowed(this.repository.database);
      signal?.throwIfAborted();
      assertTransferImport(
        await readTransferSettings(this.repository.database.db),
        input.format,
        bytes.length,
      );
      const parsed =
        input.format === 'maibot-toml'
          ? parseMaiBot(bytes, input.encoding)
          : parseAstrBot(bytes, randomUUID, input.encoding);
      signal?.throwIfAborted();
      return await this.savePreparedPreview(
        actor,
        {
          ...parsed,
          format: input.format,
          filename: input.filename,
        },
        bytes.length,
      );
    } catch (cause) {
      if (signal?.aborted)
        throw new BusinessError('CONFLICT', '文件预览已取消，请重新选择文件', { cause });
      if (cause instanceof ImportParseError)
        throw new BusinessError('UNSUPPORTED_FORMAT', cause.message, { cause });
      throw cause;
    }
  }
  private async savePreparedPreview(
    actor: Identity,
    prepared: Pick<
      z.infer<typeof ImportPreviewDataSchema>,
      'format' | 'filename' | 'persona' | 'warnings' | 'ignoredFields' | 'sourceEncoding'
    >,
    inputBytes: number,
  ) {
    // 原始文件可能带机器人密钥，仅保存白名单正文与安全提示，不落盘原文
    const contentHash = createHash('sha256').update(canonicalJson(prepared.persona)).digest('hex');
    return this.repository.save(
      actor,
      ImportPreviewDataSchema.parse({
        id: randomUUID(),
        format: prepared.format,
        filename: prepared.filename,
        contentHash,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        persona: prepared.persona,
        ...(prepared.sourceEncoding ? { sourceEncoding: prepared.sourceEncoding } : {}),
        warnings: [
          ...prepared.warnings,
          '导入仅保存私有草稿，请补充原作者、来源与转载依据后再发版',
        ],
        ignoredFields: prepared.ignoredFields
          .slice(0, 50)
          .map((field) => Array.from(field).slice(0, 120).join('')),
      }),
      inputBytes,
    );
  }
  async confirm(request: Request, input: z.infer<typeof ImportConfirmRequestSchema>) {
    const actor = await this.auth.identity(request);
    await this.auth.rate.take('persona-import-confirm', actor.account.id, 20, 3600);
    return this.repository.confirm(actor, input);
  }
}
