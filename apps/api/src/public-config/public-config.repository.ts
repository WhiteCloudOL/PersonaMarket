import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@personamarket/database';
import { DATABASE } from '../tokens.js';
import { and, eq, sql } from 'drizzle-orm';
import { siteSettings, authAuditEvents } from '@personamarket/database';
import type { PublicBrand } from '@personamarket/contracts';
import type { Identity } from '../auth/auth.service.js';
import { lockIdentity } from '../auth/locked-identity.js';

@Injectable()
export class PublicConfigRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}
  updateBrand(value: PublicBrand, revision: number, identity: Identity, requestId: string) {
    return this.database.db.transaction(async (transaction) => {
      await lockIdentity(transaction, identity, true, false);
      const [row] = await transaction
        .update(siteSettings)
        .set({ value, revision: sql`${siteSettings.revision}+1`, updatedAt: new Date() })
        .where(and(eq(siteSettings.key, 'brand'), eq(siteSettings.revision, revision)))
        .returning();
      if (row)
        await transaction
          .insert(authAuditEvents)
          .values({ userId: identity.account.id, event: 'admin.brand_updated', requestId });
      return row;
    });
  }
  async readBrand() {
    return this.database.db.query.siteSettings.findFirst({
      where: (settings, { eq }) => eq(settings.key, 'brand'),
      columns: { value: true, revision: true },
    });
  }
}
