import { sql } from 'drizzle-orm';
import { personaCurationSql } from '../personas/persona-curation-sql.js';
import type { AdminPersonasQuery } from '@personamarket/contracts';
import { publicCurrentCondition } from '../releases/public-visibility.js';

const title = sql`COALESCE(release_submissions.snapshot->>'title',pending.snapshot->>'title',d.payload->>'title','')`;
const category = sql`COALESCE(release_submissions.publication->'category',pending.publication->'category',CASE WHEN catalog.id IS NULL THEN NULL ELSE jsonb_build_object('id',catalog.id,'name',catalog.name) END)`;
const visible = sql`COALESCE(${publicCurrentCondition},false)`;
const base = sql`
  FROM personas JOIN users owner ON owner.id=personas.owner_id
  LEFT JOIN persona_drafts d ON d.persona_id=personas.id
  LEFT JOIN persona_releases ON persona_releases.id=personas.published_release_id AND persona_releases.persona_id=personas.id
  LEFT JOIN release_submissions ON release_submissions.id=persona_releases.approved_submission_id AND release_submissions.persona_id=personas.id AND release_submissions.release_id=persona_releases.id
  LEFT JOIN LATERAL (
    SELECT r.id,r.snapshot,r.publication FROM release_submissions r WHERE r.persona_id=personas.id AND r.status='PENDING'
    ORDER BY r.created_at DESC,r.id DESC LIMIT 1
  ) pending ON true
  LEFT JOIN categories catalog ON catalog.id::text=d.payload->>'categoryId'
`;
const view = sql`jsonb_build_object(
  'id',personas.id,'owner',jsonb_build_object('id',owner.id,'username',owner.username,'status',owner.status),
  'platform',personas.platform,'title',${title},'category',${category},'revision',personas.revision,'draftRevision',d.revision,
  'ownerVisibility',personas.owner_visibility,'moderationState',personas.moderation_state,'publiclyVisible',${visible},
  'curation',${personaCurationSql(sql`personas.id`)},
  'publishedReleaseId',personas.published_release_id,'latestPendingSubmissionId',pending.id,
  'publishedSubmissionId',persona_releases.approved_submission_id,
  'pendingCount',(SELECT count(*)::int FROM release_submissions r WHERE r.persona_id=personas.id AND r.status='PENDING'),
  'createdAt',personas.created_at,'updatedAt',personas.updated_at
)`;
export function adminPersonaDetailQuery(id: string) {
  return sql`SELECT ${view} AS data ${base} WHERE personas.id=${id} AND personas.deleted_at IS NULL`;
}
export function adminPersonaListQueries(input: AdminPersonasQuery) {
  const conditions = [sql`personas.deleted_at IS NULL`];
  if (input.q) {
    const pattern = '%' + input.q.replace(/[\\%_]/g, '\\$&') + '%';
    conditions.push(
      sql`(${title} ILIKE ${pattern} OR owner.username ILIKE ${pattern} OR personas.id::text=${input.q.toLowerCase()})`,
    );
  }
  if (input.ownerId) conditions.push(sql`personas.owner_id=${input.ownerId}`);
  if (input.platform !== 'all') conditions.push(sql`personas.platform=${input.platform}`);
  if (input.categoryId) conditions.push(sql`(${category}->>'id')=${input.categoryId}`);
  if (input.state === 'public') conditions.push(visible);
  if (input.state === 'unpublished') conditions.push(sql`NOT ${visible}`);
  if (input.state === 'pending') conditions.push(sql`pending.id IS NOT NULL`);
  if (input.state === 'hidden') conditions.push(sql`personas.owner_visibility='hidden'`);
  if (input.state === 'blocked') conditions.push(sql`personas.moderation_state='blocked'`);
  for (const field of ['official', 'featured'] as const) {
    if (input[field] === 'all') continue;
    const flag = field === 'official' ? sql`c.official` : sql`c.featured`;
    const exists = sql`EXISTS(SELECT 1 FROM persona_curations c WHERE c.persona_id=personas.id AND ${flag})`;
    conditions.push(input[field] === 'true' ? exists : sql`NOT ${exists}`);
  }
  const where = sql.join(conditions, sql` AND `);
  const order =
    input.sort === 'oldest'
      ? sql`personas.created_at ASC,personas.id ASC`
      : input.sort === 'newest'
        ? sql`personas.created_at DESC,personas.id DESC`
        : sql`personas.updated_at DESC,personas.id DESC`;
  return {
    rows: sql`WITH page AS MATERIALIZED(SELECT personas.id ${base} WHERE ${where} ORDER BY ${order} LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}) SELECT ${view} AS data ${base} JOIN page ON page.id=personas.id ORDER BY ${order}`,
    total: sql`SELECT count(*)::int AS total ${base} WHERE ${where}`,
  };
}
