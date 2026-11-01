import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IdSchema, type RetryAdminRankingGeneration } from '@personamarket/contracts';
import {
  BusinessError,
  createSystemQueue,
  observeRankingQueueEvent,
  type RankingQueueObservation,
  type ServerEnvironment,
} from '@personamarket/server';
import { AuthService } from '../auth/auth.service.js';
import type { Identity } from '../auth/auth.service.js';
import { ENVIRONMENT } from '../tokens.js';
import { RankingRetryRepository } from './ranking-retry.repository.js';

@Injectable()
export class RankingRetryService {
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(RankingRetryRepository) readonly repository: RankingRetryRepository,
    @Inject(ENVIRONMENT) readonly env: ServerEnvironment,
  ) {}
  private async actor(request: Request, write = false) {
    const actor = await this.auth.administrator(request, 'session');
    const expected = request.get('x-expected-account');
    if (
      expected &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新核对原批次');
    await this.auth.rate.take(
      write ? 'admin-ranking-retry-write' : 'admin-ranking-retry-read',
      actor.account.id,
      write ? 10 : 60,
      60,
    );
    return actor;
  }
  private key(request: Request) {
    const result = IdSchema.safeParse(request.get('idempotency-key'));
    if (!result.success) throw new BusinessError('INVALID_INPUT', '请提供有效的操作幂等标识');
    return result.data.toLowerCase();
  }
  private async observation(
    actor: Identity,
    id: string,
  ): Promise<RankingQueueObservation | undefined> {
    const eventId = await this.repository.eventTarget(actor, id);
    if (!eventId) return;
    const queue = createSystemQueue(this.env.REDIS_URL, this.env.QUEUE_NAME);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          await queue.waitUntilReady();
          return observeRankingQueueEvent(queue, id, eventId);
        })(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(Error('RANKING_OBSERVATION_TIMEOUT')), 3000);
        }),
      ]);
    } catch {
      return {
        eventId,
        generationId: id,
        state: 'unavailable',
        attempts: null,
        limit: null,
        finishedAt: null,
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      await queue.disconnect().catch(() => undefined);
      await queue.close().catch(() => undefined);
    }
  }
  async detail(request: Request, id: string) {
    const actor = await this.actor(request),
      normalized = id.toLowerCase();
    return this.repository.detail(actor, normalized, await this.observation(actor, normalized));
  }
  async receipt(request: Request, id: string) {
    const actor = await this.actor(request),
      hash = request.get('x-retry-request-hash');
    if (!hash || !/^[a-f0-9]{64}$/u.test(hash))
      throw new BusinessError('INVALID_INPUT', '请提供原恢复请求的完整指纹');
    return this.repository.receipt(actor, id.toLowerCase(), this.key(request), hash);
  }
  async retry(
    request: Request,
    response: Response,
    id: string,
    input: RetryAdminRankingGeneration,
  ) {
    const actor = await this.actor(request, true),
      normalized = id.toLowerCase(),
      key = this.key(request);
    const replay = await this.repository.replay(actor, normalized, input, key);
    if (replay) return replay;
    return this.repository.retry(
      actor,
      normalized,
      input,
      key,
      this.auth.requestId(response),
      await this.observation(actor, normalized),
    );
  }
}
