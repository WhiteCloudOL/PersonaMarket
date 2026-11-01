import { sql, type SQL } from 'drizzle-orm';

// 仅生成公开标记白名单；调用方仍须应用公开可见性或管理员权限检查
export function personaCurationSql(personaId: SQL) {
  return sql<unknown>`COALESCE(
    (SELECT jsonb_build_object('official',c.official,'featured',c.featured)
      FROM persona_curations c WHERE c.persona_id=${personaId}),
    jsonb_build_object('official',false,'featured',false)
  )`;
}
