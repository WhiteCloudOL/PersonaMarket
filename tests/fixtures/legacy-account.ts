import { users, type Database } from '@personamarket/database';
import { hashPassword } from '@personamarket/server';

export async function seedLegacyUnverified(
  database: Database,
  input: { username: string; email: string; password: string },
) {
  await database.db.insert(users).values({
    username: input.username,
    email: input.email,
    passwordHash: await hashPassword(input.password),
  });
}
