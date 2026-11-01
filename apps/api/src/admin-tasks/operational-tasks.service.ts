import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  IdSchema,
  type OperationalTaskPath,
  type OperationalTaskCommand,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { AuthService } from '../auth/auth.service.js';
import { OperationalTasksRepository } from './operational-tasks.repository.js';
@Injectable()
export class OperationalTasksService {
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(OperationalTasksRepository) readonly repository: OperationalTasksRepository,
  ) {}
  private async actor(request: Request, write: boolean) {
    const actor = await this.auth.administrator(request, 'session'),
      expected = request.get('x-expected-account');
    if (expected && expected.toLowerCase() !== actor.account.id)
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新核对');
    await this.auth.rate.take(
      write ? 'admin-operation-write' : 'admin-operation-read',
      actor.account.id,
      write ? 10 : 60,
      60,
    );
    return actor;
  }
  detail = async (request: Request, target: OperationalTaskPath) =>
    this.repository.detail(await this.actor(request, false), {
      ...target,
      id: target.id.toLowerCase(),
    });
  async handle(
    request: Request,
    response: Response,
    target: OperationalTaskPath,
    input: OperationalTaskCommand,
  ) {
    const actor = await this.actor(request, true),
      key = IdSchema.safeParse(request.get('idempotency-key'));
    if (!key.success) throw new BusinessError('INVALID_INPUT', '请提供有效的操作标识');
    return this.repository.handle(
      actor,
      { ...target, id: target.id.toLowerCase() },
      input,
      key.data.toLowerCase(),
      this.auth.requestId(response),
    );
  }
  async receipt(request: Request, target: OperationalTaskPath) {
    const actor = await this.actor(request, false),
      key = IdSchema.safeParse(request.get('idempotency-key')),
      hash = request.get('x-retry-request-hash');
    if (!key.success || !hash || !/^[a-f0-9]{64}$/.test(hash))
      throw new BusinessError('INVALID_INPUT', '原操作标识或指纹无效');
    return this.repository.receipt(
      actor,
      { ...target, id: target.id.toLowerCase() },
      key.data.toLowerCase(),
      hash,
    );
  }
}
