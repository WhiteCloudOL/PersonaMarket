import { sql } from 'drizzle-orm';
import { categories, tags } from '@personamarket/database';
import type { TaxonomyKind, TaxonomyManagementQuery } from '@personamarket/contracts';

export const taxonomyTable = (kind: TaxonomyKind) => (kind === 'category' ? categories : tags);
export const taxonomyView = (kind: TaxonomyKind) => sql`jsonb_build_object(
  'id',t.id,'kind',${kind}::text,'name',t.name,'active',t.active,'sortOrder',t.sort_order,
  'revision',t.revision,'archivedAt',t.archived_at,'updatedAt',t.updated_at
)`;
export function taxonomyListQueries(kind: TaxonomyKind, input: TaxonomyManagementQuery) {
  const conditions = [sql`true`];
  if (input.q) {
    const pattern = '%' + input.q.replace(/[\\%_]/g, '\\$&') + '%';
    conditions.push(sql`(t.name ILIKE ${pattern} OR t.id::text=${input.q.toLowerCase()})`);
  }
  if (input.state === 'active') conditions.push(sql`t.active AND t.archived_at IS NULL`);
  if (input.state === 'disabled') conditions.push(sql`NOT t.active AND t.archived_at IS NULL`);
  if (input.state === 'archived') conditions.push(sql`t.archived_at IS NOT NULL`);
  const where = sql.join(conditions, sql` AND `);
  return {
    rows: sql`SELECT ${taxonomyView(kind)} AS data FROM ${taxonomyTable(kind)} t WHERE ${where} ORDER BY t.sort_order,t.name,t.id LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}`,
    total: sql`SELECT count(*)::int AS total FROM ${taxonomyTable(kind)} t WHERE ${where}`,
  };
}
export function taxonomyUsageQuery(kind: TaxonomyKind, id: string) {
  const drafts =
    kind === 'category'
      ? sql`lower(payload->>'categoryId')=${id.toLowerCase()}`
      : sql`EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(payload->'tagIds')='array' THEN payload->'tagIds' ELSE '[]'::jsonb END) ref(value) WHERE lower(ref.value)=${id.toLowerCase()})`;
  const submissions =
    kind === 'category'
      ? sql`lower(snapshot->>'categoryId')=${id.toLowerCase()}`
      : sql`EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(snapshot->'tagIds')='array' THEN snapshot->'tagIds' ELSE '[]'::jsonb END) ref(value) WHERE lower(ref.value)=${id.toLowerCase()})`;
  return sql`SELECT jsonb_build_object(
    'drafts',(SELECT count(*)::int FROM persona_drafts WHERE ${drafts}),
    'submissions',(SELECT count(*)::int FROM release_submissions WHERE ${submissions})
  ) AS usage`;
}
