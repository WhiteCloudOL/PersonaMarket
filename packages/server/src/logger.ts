import { pino } from 'pino';

export function createLogger(service: string, level = 'info') {
  return pino({
    level,
    base: { service },
    redact: {
      paths: [
        'password',
        'token',
        'authorization',
        'cookie',
        'DATABASE_URL',
        'REDIS_URL',
        'APP_ENCRYPTION_KEY',
        'STATS_HMAC_KEY',
        'req.headers.cookie',
        'req.headers.authorization',
        '*.password',
        '*.token',
        '*.secret',
      ],
      censor: '[REDACTED]',
    },
  });
}
export type AppLogger = ReturnType<typeof createLogger>;
