import { Inject, Injectable } from '@nestjs/common';
import {
  IdSchema,
  type AdminPersonasQuery,
  type PersonaModerationSchema,
  type DeleteAdminPersonaSchema,
  type SetPersonaCuration,
  type AdminPersonaBulkRequest,
  AdminPersonaBulkResponseSchema,
  type AdminPersonaRecordsQuery,
} from '@personamarket/contracts';
import { BusinessError, createLogger } from '@personamarket/server';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';
import { AdminPersonasRepository } from './admin-personas.repository.js';
import { ModerationRepository } from '../releases/moderation.repository.js';
import { PersonaCurationRepository } from './persona-curation.repository.js';

@Injectable()
export class AdminPersonasService {
  private readonly logger;
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(AdminPersonasRepository) readonly repository: AdminPersonasRepository,
    @Inject(ModerationRepository) readonly moderation: ModerationRepository,
    @Inject(PersonaCurationRepository) readonly curations: PersonaCurationRepository,
  ) {
    this.logger = createLogger('persona-management', auth.env.LOG_LEVEL);
  }
  private async actor(request: Request, write = false) {
    const actor = await this.auth.administrator(request, 'session');
    const expected = request.get('x-expected-account');
    if (
      expected &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新确认管理操作');
    await this.auth.rate.take(
      write ? 'admin-personas-write' : 'admin-personas-read',
      actor.account.id,
      write ? 30 : 120,
      60,
    );
    return actor;
  }
  async list(request: Request, input: AdminPersonasQuery) {
    return this.repository.list(await this.actor(request), input);
  }
  async delete(
    request: Request,
    response: Response,
    id: string,
    input: z.infer<typeof DeleteAdminPersonaSchema>,
  ) {
    const actor = await this.actor(request, true);
    const key = IdSchema.safeParse(request.get('idempotency-key'));
    if (!key.success) throw new BusinessError('INVALID_INPUT', '请提供有效的操作幂等标识');
    return this.moderation.deletePersona(
      actor,
      id,
      input.expectedRevision,
      key.data,
      this.auth.requestId(response),
    );
  }
  async detail(request: Request, id: string) {
    return this.repository.detail(await this.actor(request), id);
  }
  async records(request: Request, id: string, input: AdminPersonaRecordsQuery) {
    return this.repository.records(await this.actor(request), id, input);
  }
  async bulk(request: Request, response: Response, input: AdminPersonaBulkRequest) {
    const actor = await this.actor(request, true);
    await this.auth.rate.take('admin-personas-bulk', actor.account.id, 5, 60);
    const requestId = this.auth.requestId(response);
    const results: z.infer<typeof AdminPersonaBulkResponseSchema>['data'] = [];
    const deadline = Date.now() + 10000;
    for (const item of input.items) {
      if (Date.now() >= deadline || request.aborted || response.destroyed) {
        results.push({
          id: item.id,
          ok: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: '本项尚未处理，请核对结果后重试未完成项' },
        });
        continue;
      }
      try {
        const result =
          input.action === 'curate'
            ? await this.curations.set(
                actor,
                item.id,
                {
                  official: input.official,
                  featured: input.featured,
                  expectedRevision: item.expectedRevision,
                  reason: input.reason,
                  selfReviewConfirmed: input.selfReviewConfirmed,
                },
                item.idempotencyKey,
                requestId,
              )
            : await this.moderation.moderatePersona(
                actor,
                item.id,
                {
                  state: input.action === 'block' ? 'blocked' : 'normal',
                  expectedRevision: item.expectedRevision,
                  reason: input.reason,
                },
                item.idempotencyKey,
                requestId,
              );
        results.push({ id: item.id, ok: true, message: result.data.message });
      } catch (cause) {
        if (cause instanceof BusinessError)
          results.push({
            id: item.id,
            ok: false,
            error: { code: cause.code, message: cause.message },
          });
        else {
          this.logger.error({
            event: 'persona.bulk.item_failed',
            requestId,
            personaId: item.id,
            code: 'INTERNAL_ERROR',
          });
          results.push({
            id: item.id,
            ok: false,
            error: { code: 'INTERNAL_ERROR', message: '本项暂未确认，请核对状态后重试' },
          });
        }
      }
    }
    return AdminPersonaBulkResponseSchema.parse({ data: results });
  }
  async curate(request: Request, response: Response, id: string, input: SetPersonaCuration) {
    const actor = await this.actor(request, true);
    const key = IdSchema.safeParse(request.get('idempotency-key'));
    if (!key.success) throw new BusinessError('INVALID_INPUT', '请提供有效的操作幂等标识');
    return this.curations.set(actor, id, input, key.data, this.auth.requestId(response));
  }
  async moderate(
    request: Request,
    response: Response,
    id: string,
    input: z.infer<typeof PersonaModerationSchema>,
  ) {
    const actor = await this.actor(request, true);
    const key = IdSchema.safeParse(request.get('idempotency-key'));
    if (!key.success) throw new BusinessError('INVALID_INPUT', '请提供有效的操作幂等标识');
    return this.moderation.moderatePersona(
      actor,
      id,
      input,
      key.data,
      this.auth.requestId(response),
    );
  }
}
