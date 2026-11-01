import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, lte, count } from 'drizzle-orm';
import { personaImports, type Database } from '@personamarket/database';
import {
  ImportPreviewDataSchema,
  PersonaDraftSchema,
  emptyPersonaDraft,
  canonicalJson,
  type ImportConfirmRequestSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import {
  BusinessError,
  assertPersonaPayloadBudget,
  readTransferSettings,
  assertTransferImport,
  assertOrdinaryWriteAllowed,
} from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { lockIdentity } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { PersonasRepository } from './personas.repository.js';

function checkConfirmation(
  record: typeof personaImports.$inferSelect | undefined,
  input: z.infer<typeof ImportConfirmRequestSchema>,
  confirmationHash: string,
): asserts record is typeof personaImports.$inferSelect {
  if (!record) throw new BusinessError('NOT_FOUND', '导入预览不存在或不可访问');
  if (record.expiresAt.getTime() <= Date.now())
    throw new BusinessError('CONFLICT', '导入预览已过期，请重新选择文件');
  if (record.contentHash !== input.contentHash)
    throw new BusinessError('CONFLICT', '导入内容已变化，请重新预览');
  if (record.resultPersonaId && record.confirmationHash !== confirmationHash)
    throw new BusinessError('CONFLICT', '该预览已用于另一次导入，请重新选择文件');
}
@Injectable()
export class ImportsRepository {
  constructor(
    @Inject(DATABASE) readonly database: Database,
    @Inject(PersonasRepository) readonly personas: PersonasRepository,
  ) {}
  async save(actor: Identity, data: z.infer<typeof ImportPreviewDataSchema>, inputBytes: number) {
    await this.database.db.transaction(async (tx) => {
      await lockIdentity(tx, actor, false, false);
      await assertOrdinaryWriteAllowed(tx);
      assertTransferImport(await readTransferSettings(tx, true), data.format, inputBytes);
      await assertPersonaPayloadBudget(tx, data);
      await tx
        .delete(personaImports)
        .where(
          and(
            eq(personaImports.ownerId, actor.account.id),
            lte(personaImports.expiresAt, new Date()),
          ),
        );
      const [total] = await tx
        .select({ value: count() })
        .from(personaImports)
        .where(eq(personaImports.ownerId, actor.account.id));
      if ((total?.value ?? 0) >= 20)
        throw new BusinessError('CONFLICT', '预览较多，请等待旧预览过期后重试');
      await tx.insert(personaImports).values({
        id: data.id,
        ownerId: actor.account.id,
        format: data.format,
        inputBytes,
        contentHash: data.contentHash,
        payload: data,
        expiresAt: new Date(data.expiresAt),
      });
    });
    return { data };
  }
  async confirm(actor: Identity, input: z.infer<typeof ImportConfirmRequestSchema>) {
    const confirmationHash = createHash('sha256').update(canonicalJson(input)).digest('hex');
    const id = await this.database.db.transaction(async (tx) => {
      await lockIdentity(tx, actor, false, false);
      const [completed] = await tx
        .select()
        .from(personaImports)
        .where(
          and(eq(personaImports.id, input.previewId), eq(personaImports.ownerId, actor.account.id)),
        );
      checkConfirmation(completed, input, confirmationHash);
      // 已成功的原请求只核对，不延长预览或再次创建草稿。
      if (completed.resultPersonaId) return completed.resultPersonaId;
      await assertOrdinaryWriteAllowed(tx);
      const [record] = await tx
        .select()
        .from(personaImports)
        .where(
          and(eq(personaImports.id, input.previewId), eq(personaImports.ownerId, actor.account.id)),
        )
        .for('update');
      checkConfirmation(record, input, confirmationHash);
      if (record.resultPersonaId) return record.resultPersonaId;
      assertTransferImport(await readTransferSettings(tx, true), record.format, record.inputBytes);
      const { persona } = ImportPreviewDataSchema.parse(record.payload);
      const draft = PersonaDraftSchema.parse({
        ...emptyPersonaDraft(persona.platform, input.title),
        ...persona,
        origin: {
          type: 'repost',
          redistribution: 'contact_required',
          originalAuthor: '',
          sourceDescription: input.sourceDescription,
          authorizationStatement: '',
        },
      });
      let personaId: string;
      if (input.target.mode === 'replace') {
        personaId = input.target.personaId;
        // 与普通自动保存共享乐观锁、平台限制、归属与素材引用事务
        await this.personas.saveWithin(tx, actor, personaId, draft, input.target.expectedRevision);
      } else
        personaId = await this.personas.createWithin(
          tx,
          actor,
          { platform: persona.platform, title: input.title },
          draft,
        );
      await tx
        .update(personaImports)
        .set({ resultPersonaId: personaId, confirmationHash, consumedAt: new Date() })
        .where(eq(personaImports.id, record.id));
      return personaId;
    });
    return this.personas.read(actor, id);
  }
}
