import { isAbsolute } from 'node:path';
import { z } from 'zod';

const origin = z.url({ protocol: /^https?$/ }).refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
}, '必须为不带路径或凭据的 origin。');
const databaseUrl = z.url({ protocol: /^postgres(ql)?$/ });
const redisUrl = z.url({ protocol: /^rediss?$/ });
const key = z.string().regex(/^[a-f0-9]{64}$/i);

export const ServerEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PUBLIC_ORIGIN: origin,
    API_INTERNAL_ORIGIN: origin,
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    APP_ENCRYPTION_KEY: key,
    STATS_HMAC_KEY: key,
    STORAGE_ROOT: z.string().min(1).refine(isAbsolute, '必须为绝对路径。'),
    CADDY_DOMAIN: z.string().min(1).max(253),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
    QUEUE_NAME: z
      .string()
      .regex(/^[a-z0-9-]{1,80}$/)
      .default('personamarket-system'),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(500).max(60_000).default(1_000),
    AUTH_REGISTRATION_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().min(600).max(604800).default(86400),
    SMTP_HOST: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.email().default('no-reply@example.invalid'),
  })
  .superRefine((env, context) => {
    if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
      context.addIssue({
        code: 'custom',
        path: ['SMTP_USER'],
        message: 'SMTP 账号和密码必须同时配置',
      });
    }
    if (env.APP_ENCRYPTION_KEY === env.STATS_HMAC_KEY) {
      context.addIssue({ code: 'custom', path: ['STATS_HMAC_KEY'], message: '密钥用途必须隔离。' });
    }
    if (env.NODE_ENV !== 'production') return;
    if (env.AUTH_REGISTRATION_ENABLED && (!env.SMTP_HOST || env.SMTP_FROM.endsWith('.invalid'))) {
      context.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: '开放注册前必须配置真实 SMTP',
      });
    }
    if (!env.PUBLIC_ORIGIN.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['PUBLIC_ORIGIN'],
        message: '生产环境必须使用 HTTPS。',
      });
    }
    for (const field of ['DATABASE_URL', 'REDIS_URL'] as const) {
      const password = decodeURIComponent(new URL(env[field]).password);
      if (password.length < 24 || /change.?me|placeholder|example/i.test(password)) {
        context.addIssue({ code: 'custom', path: [field], message: '生产服务凭据未正确配置。' });
      }
    }
    for (const field of ['APP_ENCRYPTION_KEY', 'STATS_HMAC_KEY'] as const) {
      if (new Set(env[field]).size < 8) {
        context.addIssue({ code: 'custom', path: [field], message: '不能使用示例或低熵密钥。' });
      }
    }
  });
export type ServerEnvironment = z.infer<typeof ServerEnvironmentSchema>;

export function parseServerEnvironment(input: unknown): ServerEnvironment {
  const result = ServerEnvironmentSchema.safeParse(input);
  if (!result.success) {
    // 不把验证器原始输入或连接 URL 放入错误信息和日志。
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`环境配置无效：${fields.join('、')}。请核对 .env.example。`);
  }
  return result.data;
}

export function webEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  const allowed = [
    'PATH',
    'Path',
    'SystemRoot',
    'SYSTEMROOT',
    'COMSPEC',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'NODE_ENV',
    'PUBLIC_ORIGIN',
    'API_INTERNAL_ORIGIN',
    'TRUST_PROXY_HOPS',
    'PORT',
    'NEXT_TELEMETRY_DISABLED',
    'CI',
  ];
  for (const name of allowed) if (source[name] !== undefined) result[name] = source[name];
  return result;
}
