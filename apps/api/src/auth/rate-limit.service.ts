import { createHmac } from 'node:crypto';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { createClient } from 'redis';
import { BusinessError, type ServerEnvironment } from '@personamarket/server';
import { ENVIRONMENT } from '../tokens.js';

@Injectable()
export class AuthRateLimit implements OnApplicationShutdown {
  private readonly redis;
  private connection: Promise<unknown> | undefined;
  constructor(@Inject(ENVIRONMENT) private readonly env: ServerEnvironment) {
    this.redis = createClient({
      url: env.REDIS_URL,
      socket: { connectTimeout: 2000, reconnectStrategy: false },
    });
    this.redis.on('error', () => undefined);
  }
  async take(scope: string, identity: string, limit: number, seconds: number) {
    const digest = createHmac('sha256', this.env.STATS_HMAC_KEY)
      .update(`${scope}\0${identity}`)
      .digest('hex');
    try {
      if (!this.redis.isOpen)
        this.connection ??= this.redis.connect().finally(() => {
          this.connection = undefined;
        });
      await this.connection;
      const count = await this.redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
        {
          keys: [`pm:auth-rate:${new URL(this.env.DATABASE_URL).pathname}:${scope}:${digest}`],
          arguments: [String(seconds)],
        },
      );
      if (typeof count !== 'number') throw new Error('INVALID_RATE_RESULT');
      if (count > limit)
        throw new BusinessError('RATE_LIMITED', '请求过于频繁，请稍后重试', {
          retryAfterSeconds: Math.max(
            1,
            await this.redis.ttl(
              `pm:auth-rate:${new URL(this.env.DATABASE_URL).pathname}:${scope}:${digest}`,
            ),
          ),
        });
    } catch (cause) {
      if (cause instanceof BusinessError) throw cause;
      throw new BusinessError('SERVICE_UNAVAILABLE', '安全服务暂时不可用，请稍后重试', { cause });
    }
  }
  onApplicationShutdown() {
    if (this.redis.isOpen) this.redis.destroy();
  }
}
