import { randomUUID } from 'node:crypto';
import { AccountCredentialsSchema } from '@personamarket/contracts';
import { authAuditEvents, users, type Database } from '@personamarket/database';
import { hashPassword } from './password.js';
import { BusinessError } from './errors.js';
import { assertNewPassword } from './password-policy.js';

/** 仅由受控服务器 CLI 调用，不提供 HTTP 初始化入口。 */
export async function createAdministrator(database: Database, input: unknown) {
  const account = AccountCredentialsSchema.parse(input);
  assertNewPassword(account.password, account);
  const passwordHash = await hashPassword(account.password);
  return database.db.transaction(async (transaction) => {
    const [created] = await transaction
      .insert(users)
      .values({
        username: account.username,
        email: account.email,
        passwordHash,
        role: 'admin',
        emailVerifiedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: users.id, username: users.username });
    if (!created) throw new BusinessError('CONFLICT', '用户名或邮箱已被使用');
    await transaction
      .insert(authAuditEvents)
      .values({ userId: created.id, event: 'auth.admin_bootstrap', requestId: randomUUID() });
    return created;
  });
}
