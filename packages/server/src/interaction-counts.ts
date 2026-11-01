import { sql, type SQL } from 'drizzle-orm';
import { personaLikes, personaFavorites, users } from '@personamarket/database';
import type { InteractionCounts } from '@personamarket/contracts';

/** 直接从当前有效关系重建计数；不保存可因重试漂移或减成负数的客户端计数 */
export function interactionCountsSql(personaId: SQL): SQL<InteractionCounts> {
  return sql<InteractionCounts>`jsonb_build_object(
    'likes', (SELECT count(*) FROM ${personaLikes} il JOIN ${users} iu ON iu.id=il.user_id
      WHERE il.persona_id=${personaId} AND il.active AND iu.status='active' AND iu.email_verified_at IS NOT NULL),
    'favorites', (SELECT count(*) FROM ${personaFavorites} ifv JOIN ${users} iu ON iu.id=ifv.user_id
      WHERE ifv.persona_id=${personaId} AND ifv.active AND iu.status='active' AND iu.email_verified_at IS NOT NULL))`;
}
