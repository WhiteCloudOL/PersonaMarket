import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { AccountCredentialsSchema } from '@personamarket/contracts';
import type { Database } from '@personamarket/database';
import { hashPassword } from '@personamarket/server';

/** 历史前缀库只写当时已存在的列，不能使用会列出当前 schema 全部列的 ORM insert。 */
export async function seedUpgradeAdministrator(database: Database, input: unknown) {
  const account = AccountCredentialsSchema.parse(input);
  const passwordHash = await hashPassword(account.password);
  return database.db.transaction(async (tx) => {
    const result = await tx.execute<{ id: string; username: string }>(sql`
      INSERT INTO users(username,email,password_hash,role,email_verified_at)
      VALUES(${account.username},${account.email},${passwordHash},'admin',clock_timestamp())
      RETURNING id,username
    `);
    const created = result.rows[0];
    if (!created) throw Error('缺少历史升级夹具账号');
    await tx.execute(sql`
      INSERT INTO auth_audit_events(user_id,event,request_id)
      VALUES(${created.id}::uuid,'auth.admin_bootstrap',${randomUUID()}::uuid)
    `);
    return created;
  });
}
