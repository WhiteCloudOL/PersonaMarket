import { sql } from 'drizzle-orm';
import { AdminUserDetailSchema, type AdminUsersQuery } from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';
import { adminDeactivationHistory } from './admin-deactivation-views.js';

const summary = sql`jsonb_build_object(
  'id',u.id,'username',u.username,'role',u.role,'status',u.status,
  'emailVerified',u.email_verified_at IS NOT NULL,'securityVersion',u.security_version,
  'personaCount',(SELECT count(*)::int FROM personas p WHERE p.owner_id=u.id AND p.deleted_at IS NULL),
  'pendingDeactivation',EXISTS(SELECT 1 FROM deactivation_requests d WHERE d.user_id=u.id AND d.status='pending'),
  'activeSessionCount',(SELECT count(*)::int FROM auth_sessions s
    WHERE s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
      AND s.security_version=u.security_version),
  'createdAt',u.created_at
)`;

export function adminUserQueries(input: AdminUsersQuery) {
  const needle = '%' + input.q.replace(/[\\%_]/g, '\\$&') + '%';
  const condition = sql`
    u.deleted_at IS NULL AND (${input.role}='all' OR u.role=${input.role})
    AND (${input.status}='all' OR u.status=${input.status})
    AND (${input.deactivation}='all' OR EXISTS(SELECT 1 FROM deactivation_requests d WHERE d.user_id=u.id AND d.status='pending'))
    AND (${input.q}='' OR u.username ILIKE ${needle} OR u.email ILIKE ${needle} OR u.id::text=${input.q.toLowerCase()})
  `;
  const order =
    input.sort === 'username'
      ? sql`u.username ASC,u.id ASC`
      : input.sort === 'oldest'
        ? sql`u.created_at ASC,u.id ASC`
        : sql`u.created_at DESC,u.id DESC`;
  return {
    rows: sql`
      WITH user_page AS MATERIALIZED (
        SELECT u.id FROM users u WHERE ${condition} ORDER BY ${order}
        LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
      )
      SELECT ${summary} AS data FROM user_page page JOIN users u ON u.id=page.id
      ORDER BY ${order}
    `,
    total: sql`SELECT count(*)::int AS value FROM users u WHERE ${condition}`,
  };
}

export async function adminUserView(tx: Transaction, id: string) {
  const result = await tx.execute<{ data: unknown }>(sql`
    SELECT ${summary} || jsonb_build_object(
      'email',u.email,'updatedAt',u.updated_at,'deactivationRequests',${adminDeactivationHistory(id)},
      'mfaEnabled',EXISTS(SELECT 1 FROM user_mfa m WHERE m.user_id=u.id AND m.confirmed_at IS NOT NULL),
      'records',COALESCE((SELECT jsonb_agg(record.data ORDER BY record.created_at DESC,record.id DESC)
        FROM (
          SELECT r.id,r.created_at,jsonb_build_object(
            'id',r.id,'actor',jsonb_build_object('id',a.id,'username',a.username),
            'action',r.action,'reason',r.reason,'fromRole',r.from_role,'toRole',r.to_role,
            'fromStatus',r.from_status,'toStatus',r.to_status,'scope',r.scope,
            'affectedPersonas',r.affected_personas,'revokedSessions',r.revoked_sessions,
            'createdAt',r.created_at
          ) AS data
          FROM user_management_records r JOIN users a ON a.id=r.actor_id
          WHERE r.target_id=u.id ORDER BY r.created_at DESC,r.id DESC LIMIT 100
        ) record),'[]'::jsonb)
    ) AS data FROM users u WHERE u.id=${id} AND u.deleted_at IS NULL
  `);
  const row = result.rows[0];
  if (!row) throw new BusinessError('NOT_FOUND', '用户不存在或不可访问');
  return AdminUserDetailSchema.parse(row.data);
}
