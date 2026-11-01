import { sql } from 'drizzle-orm';

export function adminDeactivationHistory(userId: string) {
  return sql`COALESCE((
    SELECT jsonb_agg(application.data ORDER BY application.created_at DESC,application.id DESC)
    FROM (
      SELECT r.id,r.created_at,jsonb_build_object(
        'id',r.id,'status',r.status,'reason',r.reason,'createdAt',r.created_at,'updatedAt',r.updated_at,
        'decision',CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id',d.id,'actor',jsonb_build_object('id',a.id,'username',a.username),
          'decision',d.decision,'reason',d.reason,'fromStatus',d.from_status,'toStatus',d.to_status,
          'fromSecurityVersion',d.from_security_version,'toSecurityVersion',d.to_security_version,
          'revokedSessions',d.revoked_sessions,'createdAt',d.created_at
        ) END
      ) AS data
      FROM deactivation_requests r
      LEFT JOIN deactivation_decisions d ON d.application_id=r.id
      LEFT JOIN users a ON a.id=d.actor_id
      WHERE r.user_id=${userId} ORDER BY r.created_at DESC,r.id DESC LIMIT 100
    ) application
  ),'[]'::jsonb)`;
}
