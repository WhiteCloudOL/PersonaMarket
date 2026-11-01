import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    username: varchar('username', { length: 32 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: varchar('role', { length: 16, enum: ['user', 'moderator', 'admin'] })
      .default('user')
      .notNull(),
    status: varchar('status', { length: 16, enum: ['active', 'banned', 'deactivated'] })
      .default('active')
      .notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    securityVersion: integer('security_version').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('users_username_unique').on(table.username),
    uniqueIndex('users_email_unique').on(table.email),
    index('users_created_idx').on(table.createdAt.desc(), table.id.desc()),
    index('users_role_status_created_idx').on(
      table.role,
      table.status,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check('users_username_canonical', sql`${table.username} ~ '^[a-z][a-z0-9_]{2,31}$'`),
    check(
      'users_email_canonical',
      sql`${table.email} = lower(btrim(${table.email})) AND position('@' in ${table.email}) > 1 AND ${table.email} !~ '[[:space:][:cntrl:]]'`,
    ),
    check(
      'users_password_hash_only',
      sql`${table.passwordHash} LIKE '$argon2id$%' AND length(${table.passwordHash}) BETWEEN 80 AND 512`,
    ),
    check('users_role_valid', sql`${table.role} in ('user', 'moderator', 'admin')`),
    check('users_status_valid', sql`${table.status} in ('active', 'banned', 'deactivated')`),
    check('users_security_version_positive', sql`${table.securityVersion} > 0`),
  ],
);

// 保护最后一个管理员的串行写哨兵，运行账户没有直接读写权限。
export const authAdminGuard = pgTable(
  'auth_admin_guard',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    revision: bigint('revision', { mode: 'bigint' })
      .default(sql`1`)
      .notNull(),
  },
  (table) => [check('auth_admin_guard_singleton', sql`${table.singleton}`)],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    csrfTokenHash: varchar('csrf_token_hash', { length: 64 }).notNull(),
    securityVersion: integer('security_version').notNull(),
    deviceName: varchar('device_name', { length: 200 }).default('').notNull(),
    restricted: boolean('restricted').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    mfaVerifiedAt: timestamp('mfa_verified_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('auth_sessions_token_unique').on(table.tokenHash),
    index('auth_sessions_user_idx').on(table.userId),
    check(
      'auth_sessions_hash_only',
      sql`${table.tokenHash} ~ '^[0-9a-f]{64}$' AND ${table.csrfTokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check('auth_sessions_expiry_valid', sql`${table.expiresAt} > ${table.createdAt}`),
    check('auth_sessions_security_version_positive', sql`${table.securityVersion} > 0`),
  ],
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: varchar('purpose', {
      length: 32,
      enum: ['email_verify', 'password_reset', 'email_change'],
    }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    targetEmail: varchar('target_email', { length: 254 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('auth_tokens_purpose_hash_unique').on(table.purpose, table.tokenHash),
    index('auth_tokens_user_purpose_idx').on(table.userId, table.purpose),
    check('auth_tokens_hash_only', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('auth_tokens_expiry_valid', sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      'auth_tokens_purpose_valid',
      sql`${table.purpose} in ('email_verify', 'password_reset', 'email_change')`,
    ),
    check(
      'auth_tokens_email_change_bound',
      sql`(${table.purpose} = 'email_change') = (${table.targetEmail} IS NOT NULL)`,
    ),
    check(
      'auth_tokens_email_canonical',
      sql`${table.targetEmail} IS NULL OR (${table.targetEmail} = lower(btrim(${table.targetEmail})) AND position('@' in ${table.targetEmail}) > 1 AND ${table.targetEmail} !~ '[[:space:][:cntrl:]]')`,
    ),
  ],
);
