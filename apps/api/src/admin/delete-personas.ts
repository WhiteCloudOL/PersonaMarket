import { sql, type SQL } from 'drizzle-orm';
import type { Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';

export async function removePersonas(
  tx: Transaction,
  actor: Identity,
  condition: SQL,
  requestId: string,
) {
  await tx.execute(sql`
    WITH removed AS (
      UPDATE personas SET deleted_at=clock_timestamp(), moderation_state='blocked',
        published_release_id=NULL, revision=revision+1, updated_at=clock_timestamp()
      WHERE deleted_at IS NULL AND (${condition}) RETURNING id,owner_id
    ), projection AS (
      DELETE FROM persona_public_projection p USING removed r WHERE p.persona_id=r.id
    ), draft_links AS (
      DELETE FROM asset_references a USING removed r WHERE a.persona_id=r.id AND a.resource_type='draft'
    ), drafts AS (
      DELETE FROM persona_drafts d USING removed r WHERE d.persona_id=r.id
    ), withdrawn AS (
      UPDATE release_submissions s SET status='WITHDRAWN', revision=s.revision+1,
        reason='人设已删除' FROM removed r WHERE s.persona_id=r.id AND s.status='PENDING'
    ), pending_comments AS MATERIALIZED (
      SELECT c.id,c.pending_revision_id FROM comments c JOIN removed r ON r.id=c.persona_id
      WHERE c.pending_revision_id IS NOT NULL ORDER BY c.id FOR UPDATE OF c
    ), withdrawn_comments AS (
      UPDATE comment_revisions v SET status='SUPERSEDED',reason=NULL
      FROM pending_comments c WHERE v.id=c.pending_revision_id
    ), cleared_comments AS (
      UPDATE comments c SET pending_revision_id=NULL,revision=c.revision+1,updated_at=clock_timestamp()
      FROM pending_comments p WHERE p.id=c.id
    )
    INSERT INTO moderation_records(persona_id,actor_id,action,reason,request_id,self_review)
    SELECT id,${actor.account.id},'persona_deleted','管理员删除人设',${requestId},owner_id=${actor.account.id}
    FROM removed
  `);
}
