import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  IdSchema,
  type AdminTaskQuery,
  type AdminTaskPath,
  type RetryAdminTask,
} from '@personamarket/contracts';
import {
  BusinessError,
  inspectFailedQueueTasks,
  type ServerEnvironment,
} from '@personamarket/server';
import { AuthService } from '../auth/auth.service.js';
import { AdminTasksRepository } from './admin-tasks.repository.js';
import { AdminTaskRetriesRepository } from './admin-task-retries.repository.js';
import { ENVIRONMENT } from '../tokens.js';

@Injectable()
export class AdminTasksService {
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(AdminTasksRepository) readonly repository: AdminTasksRepository,
    @Inject(AdminTaskRetriesRepository) readonly retries: AdminTaskRetriesRepository,
    @Inject(ENVIRONMENT) readonly env: ServerEnvironment,
  ) {}
  private async retryActor(request: Request, write: boolean) {
    const actor = await this.auth.administrator(request, write ? 'recent' : 'session');
    const expected = request.get('x-expected-account');
    if (
      expected &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新确认任务操作');
    await this.auth.rate.take(
      write ? 'admin-tasks-write' : 'admin-tasks-read',
      actor.account.id,
      write ? 10 : 60,
      60,
    );
    return actor;
  }
  async history(request: Request, target: AdminTaskPath) {
    return this.retries.history(await this.retryActor(request, false), {
      ...target,
      id: target.id.toLowerCase(),
    });
  }
  async detail(request: Request, target: AdminTaskPath) {
    const actor = await this.retryActor(request, false);
    const observation = await inspectFailedQueueTasks(this.env.REDIS_URL, this.env.QUEUE_NAME);
    return this.repository.detail(actor, { ...target, id: target.id.toLowerCase() }, observation);
  }
  async retry(request: Request, response: Response, target: AdminTaskPath, input: RetryAdminTask) {
    const actor = await this.retryActor(request, true);
    const key = IdSchema.safeParse(request.get('idempotency-key'));
    if (!key.success) throw new BusinessError('INVALID_INPUT', '请提供有效的操作幂等标识');
    const observation = await inspectFailedQueueTasks(this.env.REDIS_URL, this.env.QUEUE_NAME);
    return this.retries.retry(
      actor,
      { ...target, id: target.id.toLowerCase() },
      input,
      key.data.toLowerCase(),
      this.auth.requestId(response),
      observation.samples,
    );
  }
  async list(request: Request, input: AdminTaskQuery) {
    const actor = await this.auth.administrator(request, 'session');
    const expected = request.get('x-expected-account');
    if (
      expected &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新读取任务列表');
    await this.auth.rate.take('admin-tasks-read', actor.account.id, 60, 60);
    const observation = await inspectFailedQueueTasks(this.env.REDIS_URL, this.env.QUEUE_NAME);
    // 外部观测不持有身份锁；SQL返回之前再核对实际会话和角色
    return this.repository.list(actor, input, observation);
  }
}
