import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { authAuditEvents, siteSettings, type Database } from '@personamarket/database';
import { BusinessError, updatedMailSettings, type ServerEnvironment } from '@personamarket/server';
import type { UpdateMailSettings } from '@personamarket/contracts';
import { DATABASE, ENVIRONMENT } from '../tokens.js';
import { lockIdentity } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
@Injectable()
export class SettingsRepository {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENVIRONMENT) private readonly env: ServerEnvironment,
  ) {}
  async update(
    group: 'mail',
    input: UpdateMailSettings,
    expected: number,
    identity: Identity,
    requestId: string,
  ) {
    await this.database.db.transaction(async (transaction) => {
      await lockIdentity(transaction, identity, true);
      const [current] = await transaction
        .select()
        .from(siteSettings)
        .where(eq(siteSettings.key, group))
        .for('update');
      if (!current || current.revision !== expected)
        throw new BusinessError('REVISION_CONFLICT', '设置已被更新，请刷新后重试');
      const value = updatedMailSettings(input, current.value, this.env.APP_ENCRYPTION_KEY);
      await transaction
        .update(siteSettings)
        .set({ value, revision: sql`${siteSettings.revision}+1`, updatedAt: new Date() })
        .where(and(eq(siteSettings.key, group), eq(siteSettings.revision, expected)));
      await transaction
        .insert(authAuditEvents)
        .values({ userId: identity.account.id, requestId, event: 'admin.' + group + '_updated' });
    });
  }
  audit(event: string, identity: Identity, requestId: string) {
    return this.database.db
      .insert(authAuditEvents)
      .values({ userId: identity.account.id, event, requestId });
  }
}
