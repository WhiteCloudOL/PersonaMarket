import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Database } from '@personamarket/database';
import { AdminOverviewDataSchema, ReviewIndicatorsResponseSchema } from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { Identity } from '../auth/auth.service.js';
import { lockIdentity } from '../auth/locked-identity.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { DATABASE } from '../tokens.js';

const moderatorSchema = AdminOverviewDataSchema.options[0];
const administratorSchema = AdminOverviewDataSchema.options[1].omit({ observations: true });

@Injectable()
export class AdminOverviewRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  indicators(actor: Identity) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const { account } = await lockIdentity(tx, actor, false, false);
        if (account.role !== 'admin' && account.role !== 'moderator')
          throw new BusinessError('FORBIDDEN', '此操作需要审核权限');
        const rows = await tx.execute(sql`SELECT
        EXISTS(SELECT 1 FROM release_submissions s JOIN personas p ON p.id=s.persona_id
          WHERE s.status='PENDING' AND p.moderation_state='normal'
          AND (${account.role}='admin' OR p.owner_id<>${account.id})) AS releases,
        EXISTS(SELECT 1 FROM comments c JOIN users u ON u.id=c.author_id JOIN personas p ON p.id=c.persona_id
          WHERE c.visibility='normal' AND c.pending_revision_id IS NOT NULL AND u.status='active' AND p.deleted_at IS NULL
          AND (${account.role}='admin' OR c.author_id<>${account.id})) AS comments,
        EXISTS(SELECT 1 FROM profile_submissions s JOIN users u ON u.id=s.user_id
          WHERE s.status='PENDING' AND u.status='active'
          AND (${account.role}='admin' OR s.user_id<>${account.id})) AS profiles,
        CASE WHEN ${account.role}='admin' THEN EXISTS(SELECT 1 FROM reports WHERE status IN ('pending','processing')) ELSE false END AS reports`);
        return ReviewIndicatorsResponseSchema.parse({ data: rows.rows[0] });
      },
      { area: 'content' },
    );
  }
  authorize(actor: Identity) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const { account } = await lockIdentity(tx, actor, false, false);
        if (account.role !== 'moderator' && account.role !== 'admin')
          throw new BusinessError('FORBIDDEN', '此页面需要审核或管理权限');
        return account.role;
      },
      { area: 'content' },
    );
  }
  read(actor: Identity) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const { account } = await lockIdentity(tx, actor, false, false);
        if (account.role !== 'moderator' && account.role !== 'admin')
          throw new BusinessError('FORBIDDEN', '此页面需要审核或管理权限');
        // 同一RR快照与单一数据库时刻；不读取用户正文、证据或任务payload
        const result = await tx.execute(sql`SELECT jsonb_build_object(
        'asOf',now(),
        'queues',jsonb_build_object(
          'releases',(SELECT count(*) FROM release_submissions WHERE status='PENDING'),
          'comments',(SELECT count(*) FROM comments WHERE visibility='normal' AND pending_revision_id IS NOT NULL),
          'profiles',(SELECT count(*) FROM profile_submissions WHERE status='PENDING')
        )) AS data`);
        const queues = moderatorSchema.omit({ role: true }).parse(result.rows[0]?.['data']);
        if (account.role === 'moderator') return { role: 'moderator' as const, ...queues };
        const statistics = await tx.execute(sql`WITH public_versions AS MATERIALIZED (
        SELECT p.id AS persona_id,p.owner_id,p.first_published_at,p.published_release_id,
          v.id AS release_id,v.published_at
        FROM personas p JOIN persona_releases v ON v.persona_id=p.id
        JOIN release_submissions s ON s.id=v.approved_submission_id AND s.persona_id=p.id AND s.release_id=v.id
        WHERE p.owner_visibility='listed' AND p.moderation_state='normal'
          AND v.lifecycle='PUBLISHED' AND s.status='APPROVED'
      ), public_personas AS MATERIALIZED (
        SELECT * FROM public_versions WHERE release_id=published_release_id
      ), failed_dispatch AS MATERIALIZED (
        SELECT topic FROM outbox_events WHERE delivered_at IS NULL AND attempts>=5
          AND (lease_until IS NULL OR lease_until<=now())
      ) SELECT jsonb_build_object(
        'windowStart',now()-interval '168 hours',
        'reports',(SELECT count(*) FROM reports WHERE status IN ('pending','processing')),
        'catalog',jsonb_build_object(
          'publicPersonas',(SELECT count(*) FROM public_personas),
          'activeUsers',(SELECT count(*) FROM users WHERE status='active'),
          'newPublicPersonas7d',(SELECT count(*) FROM public_personas WHERE first_published_at BETWEEN now()-interval '168 hours' AND now()),
          'newActiveUsers7d',(SELECT count(*) FROM users WHERE status='active' AND created_at BETWEEN now()-interval '168 hours' AND now()),
          'publishedReleases7d',(SELECT count(*) FROM public_versions WHERE published_at BETWEEN now()-interval '168 hours' AND now())
        ),
        'interactions',jsonb_build_object(
          'likes7d',(SELECT count(*) FROM persona_likes i JOIN public_personas p ON p.persona_id=i.persona_id
            JOIN users u ON u.id=i.user_id WHERE i.active AND i.user_id<>p.owner_id AND u.status='active' AND u.email_verified_at IS NOT NULL
            AND i.first_added_at BETWEEN now()-interval '168 hours' AND now()),
          'favorites7d',(SELECT count(*) FROM persona_favorites i JOIN public_personas p ON p.persona_id=i.persona_id
            JOIN users u ON u.id=i.user_id WHERE i.active AND i.user_id<>p.owner_id AND u.status='active' AND u.email_verified_at IS NOT NULL
            AND i.first_added_at BETWEEN now()-interval '168 hours' AND now()),
          'comments7d',(SELECT count(*) FROM comments c JOIN public_personas p ON p.persona_id=c.persona_id
            JOIN users u ON u.id=c.author_id JOIN comment_revisions r ON r.id=c.public_revision_id AND r.comment_id=c.id
            WHERE c.visibility='normal' AND r.status='APPROVED' AND u.status='active' AND u.email_verified_at IS NOT NULL
            AND c.first_published_at BETWEEN now()-interval '168 hours' AND now()
            AND (c.parent_id IS NULL OR EXISTS(SELECT 1 FROM comments root WHERE root.id=c.parent_id AND root.first_published_at IS NOT NULL)))
        ),
        'tasks',jsonb_build_object(
          'dispatchFailed',(SELECT count(*) FROM failed_dispatch),
          'emailDispatchFailed',(SELECT count(*) FROM failed_dispatch WHERE topic='auth.email'),
          'notificationFailed',(SELECT count(*) FROM notifications WHERE status='failed'),
          'imageImportFailed',((SELECT count(*) FROM asset_jobs WHERE status='failed')+(SELECT count(*) FROM market_import_assets WHERE status='failed')),
          'rankingFailed',(SELECT count(*) FROM ranking_generations WHERE status='failed')
        )) AS data`);
        const data: unknown = statistics.rows[0]?.['data'];
        // 数据库JSON经统一Schema检查，响应只保留明确字段
        const fields = administratorSchema
          .omit({ role: true, asOf: true, queues: true })
          .extend({ reports: moderatorSchema.shape.queues.shape.releases })
          .parse(data);
        const { reports, ...statisticsFields } = fields;
        return administratorSchema.parse({
          ...statisticsFields,
          role: 'admin',
          asOf: queues.asOf,
          queues: { ...queues.queues, reports },
        });
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
}
