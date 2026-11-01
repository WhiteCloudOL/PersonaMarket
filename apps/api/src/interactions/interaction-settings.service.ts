import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { siteSettings, authAuditEvents, type Database } from '@personamarket/database';
import {
  type InteractionSettingsSchema,
  InteractionSettingsResponseSchema,
  defaultInteractionSettings,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { DATABASE } from '../tokens.js';
import { AuthService } from '../auth/auth.service.js';
import { lockIdentity } from '../auth/locked-identity.js';

@Injectable()
export class InteractionSettingsService {
  constructor(
    @Inject(DATABASE) readonly database: Database,
    @Inject(AuthService) readonly auth: AuthService,
  ) {}
  async read(request: Request) {
    await this.auth.administrator(request, 'session');
    const [row] = await this.database.db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, 'community'));
    return InteractionSettingsResponseSchema.parse({
      data: row?.value,
      defaults: defaultInteractionSettings,
      meta: { revision: row?.revision },
    });
  }
  async update(
    request: Request,
    response: Response,
    input: z.infer<typeof InteractionSettingsSchema>,
  ) {
    const actor = await this.auth.administrator(request, 'session');
    const raw = /^"community-([1-9][0-9]*)"$/.exec(request.get('if-match') ?? '')?.[1];
    const expected = Number(raw);
    if (!raw || !Number.isSafeInteger(expected))
      throw new BusinessError('REVISION_CONFLICT', '请刷新社区设置后重试');
    await this.database.db.transaction(async (tx) => {
      await lockIdentity(tx, actor, true, false);
      const [row] = await tx
        .select()
        .from(siteSettings)
        .where(eq(siteSettings.key, 'community'))
        .for('update');
      if (!row || row.revision !== expected)
        throw new BusinessError('REVISION_CONFLICT', '社区设置已更新，请刷新后重新确认');
      await tx
        .update(siteSettings)
        .set({ value: input, revision: sql`${siteSettings.revision}+1`, updatedAt: new Date() })
        .where(eq(siteSettings.key, 'community'));
      await tx.insert(authAuditEvents).values({
        userId: actor.account.id,
        requestId: this.auth.requestId(response),
        event: 'admin.community_settings_updated',
      });
    });
    return this.read(request);
  }
}
