import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  AdminOverviewResponseSchema,
  IdSchema,
  type QueueObservation,
  type StorageObservation,
} from '@personamarket/contracts';
import {
  BusinessError,
  inspectQueueUsage,
  inspectStorageUsage,
  type ServerEnvironment,
} from '@personamarket/server';
import { AuthService } from '../auth/auth.service.js';
import { ENVIRONMENT } from '../tokens.js';
import { AdminOverviewRepository } from './admin-overview.repository.js';

@Injectable()
export class AdminOverviewService {
  private observations?: {
    expiresAt: number;
    pending: Promise<{ queue: QueueObservation; storage: StorageObservation }>;
  };
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(AdminOverviewRepository) readonly repository: AdminOverviewRepository,
    @Inject(ENVIRONMENT) readonly env: ServerEnvironment,
  ) {}
  private observe() {
    if (!this.observations || this.observations.expiresAt <= Date.now()) {
      this.observations = {
        expiresAt: Date.now() + 30_000,
        pending: Promise.all([
          inspectQueueUsage(this.env.REDIS_URL, this.env.QUEUE_NAME),
          inspectStorageUsage(this.env.STORAGE_ROOT),
        ]).then(([queue, storage]) => ({ queue, storage })),
      };
    }
    return this.observations.pending;
  }
  private async actor(request: Request) {
    const actor = await this.auth.identity(request);
    const expected = request.get('x-expected-account');
    if (
      expected &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新读取管理概览');
    await this.auth.rate.take('admin-overview-read', actor.account.id, 60, 60);
    return actor;
  }
  async indicators(request: Request) {
    return this.repository.indicators(await this.actor(request));
  }
  async read(request: Request) {
    const actor = await this.actor(request);
    const role = await this.repository.authorize(actor);
    const observations = role === 'admin' ? await this.observe() : undefined;
    // 文件/Redis观测不持有DB身份行锁；返回敏感统计前再次核对真实会话及角色
    const current = await this.repository.read(actor);
    if (current.role === 'admin' && !observations)
      throw new BusinessError('CONFLICT', '管理权限已变化，请重新读取概览');
    return AdminOverviewResponseSchema.parse({
      data: current.role === 'admin' ? { ...current, observations } : current,
    });
  }
}
