import { Inject, Injectable } from '@nestjs/common';
import {
  IdSchema,
  type AdminUsersQuery,
  type DeleteAdminUserSchema,
  type AdminUserContentQuery,
  type AdminUserReviewRecordsQuery,
  type ReviewDeactivationRequestSchema,
  type RevokeAdminUserSessionsSchema,
  type SetAdminUserRoleSchema,
  type SetAdminUserStatusSchema,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';
import { AdminUsersReadRepository } from './admin-users-read.repository.js';
import { AdminUsersWriteRepository } from './admin-users-write.repository.js';
import { AdminDeactivationRepository } from './admin-deactivation.repository.js';

@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(AdminUsersReadRepository) readonly reads: AdminUsersReadRepository,
    @Inject(AdminUsersWriteRepository) readonly writes: AdminUsersWriteRepository,
    @Inject(AdminDeactivationRepository) readonly deactivations: AdminDeactivationRepository,
  ) {}
  private async actor(request: Request, write = false) {
    const actor = await this.auth.administrator(request, write ? 'recent' : 'session');
    const expected = request.get('x-expected-account');
    if (
      expected &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新确认管理操作');
    await this.auth.rate.take(
      write ? 'admin-users-write' : 'admin-users-read',
      actor.account.id,
      write ? 30 : 120,
      60,
    );
    return actor;
  }
  private key(request: Request) {
    const parsed = IdSchema.safeParse(request.get('idempotency-key'));
    if (!parsed.success) throw new BusinessError('INVALID_INPUT', '请提供有效的操作幂等标识');
    return parsed.data;
  }
  async delete(
    request: Request,
    response: Response,
    id: string,
    input: z.infer<typeof DeleteAdminUserSchema>,
  ) {
    return this.writes.delete(
      await this.actor(request, true),
      id,
      input,
      this.key(request),
      this.auth.requestId(response),
    );
  }
  async reviewDeactivation(
    request: Request,
    response: Response,
    id: string,
    applicationId: string,
    input: z.infer<typeof ReviewDeactivationRequestSchema>,
  ) {
    return this.deactivations.review(
      await this.actor(request, true),
      id,
      applicationId,
      input,
      this.key(request),
      this.auth.requestId(response),
    );
  }
  async list(request: Request, query: AdminUsersQuery) {
    return this.reads.list(await this.actor(request), query);
  }
  async detail(request: Request, id: string) {
    return this.reads.detail(await this.actor(request), id);
  }
  async publicPersonas(request: Request, id: string, query: AdminUserContentQuery) {
    return this.reads.publicPersonas(await this.actor(request), id, query);
  }
  async reviewRecords(request: Request, id: string, query: AdminUserReviewRecordsQuery) {
    return this.reads.reviewRecords(await this.actor(request), id, query);
  }
  async role(
    request: Request,
    response: Response,
    id: string,
    input: z.infer<typeof SetAdminUserRoleSchema>,
  ) {
    return this.writes.role(
      await this.actor(request, true),
      id,
      input,
      this.key(request),
      this.auth.requestId(response),
    );
  }
  async status(
    request: Request,
    response: Response,
    id: string,
    input: z.infer<typeof SetAdminUserStatusSchema>,
  ) {
    return this.writes.status(
      await this.actor(request, true),
      id,
      input,
      this.key(request),
      this.auth.requestId(response),
    );
  }
  async revokeSessions(
    request: Request,
    response: Response,
    id: string,
    input: z.infer<typeof RevokeAdminUserSessionsSchema>,
  ) {
    return this.writes.revokeSessions(
      await this.actor(request, true),
      id,
      input,
      this.key(request),
      this.auth.requestId(response),
    );
  }
}
