import { Inject, Injectable } from '@nestjs/common';
import { and, eq, desc } from 'drizzle-orm';
import { assets, assetJobs, outboxEvents, type Database } from '@personamarket/database';
import {
  BusinessError,
  assertImageImportCapacity,
  readMediaSettings,
  assertMediaRemote,
  assertOrdinaryWriteAllowed,
} from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import type { Identity } from '../auth/auth.service.js';
import { lockIdentity } from '../auth/locked-identity.js';
@Injectable()
export class AssetsRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  async list(actor: Identity) {
    return this.database.db
      .select()
      .from(assets)
      .where(eq(assets.ownerId, actor.account.id))
      .orderBy(desc(assets.createdAt))
      .limit(100);
  }
  async own(actor: Identity, id: string) {
    const [asset] = await this.database.db
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.ownerId, actor.account.id)));
    if (!asset) throw new BusinessError('NOT_FOUND', '素材不存在或不可访问');
    return asset;
  }
  async queue(actor: Identity, url: string) {
    return this.database.db.transaction(async (tx) => {
      await lockIdentity(tx, actor, false, false);
      await assertOrdinaryWriteAllowed(tx);
      assertMediaRemote(await readMediaSettings(tx, true), url);
      await assertImageImportCapacity(tx, actor.account.id);
      const [job] = await tx
        .insert(assetJobs)
        .values({ ownerId: actor.account.id, sourceUrl: url })
        .returning();
      if (!job) throw new Error('IMAGE_JOB_INSERT_FAILED');
      await tx
        .insert(outboxEvents)
        .values({ topic: 'asset.import', payload: { schemaVersion: 1, jobId: job.id } });
      return job;
    });
  }
  async job(actor: Identity, id: string) {
    const [job] = await this.database.db
      .select()
      .from(assetJobs)
      .where(and(eq(assetJobs.id, id), eq(assetJobs.ownerId, actor.account.id)));
    if (!job) throw new BusinessError('NOT_FOUND', '导入任务不存在或不可访问');
    return job;
  }
}
