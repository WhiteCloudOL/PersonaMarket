import { Inject, Injectable } from '@nestjs/common';
import {
  IdSchema,
  type CreateReleaseSchema,
  type ReviewRequestSchema,
  type RestoreSubmissionSchema,
  type PublicPersonaQuery,
} from '@personamarket/contracts';
import { BusinessError, LocalStorage, type ServerEnvironment } from '@personamarket/server';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';
import { ENVIRONMENT } from '../tokens.js';
import { ReleasesRepository } from './releases.repository.js';
import { ModerationRepository } from './moderation.repository.js';
import { PublicationsRepository } from './publications.repository.js';
@Injectable()
export class ReleasesService {
  private readonly storage;
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(ReleasesRepository) readonly releases: ReleasesRepository,
    @Inject(ModerationRepository) readonly moderation: ModerationRepository,
    @Inject(PublicationsRepository) readonly publications: PublicationsRepository,
    @Inject(ENVIRONMENT) env: ServerEnvironment,
  ) {
    this.storage = new LocalStorage(env.STORAGE_ROOT);
  }
  key(request: Request) {
    const parsed = IdSchema.safeParse(request.get('idempotency-key'));
    if (!parsed.success) throw new BusinessError('INVALID_INPUT', '请提供有效的操作幂等标识');
    return parsed.data;
  }
  async reviewer(request: Request) {
    const actor = await this.auth.identity(request);
    if (!['moderator', 'admin'].includes(actor.account.role))
      throw new BusinessError('FORBIDDEN', '此操作需要审核权限');
    return actor;
  }
  async create(
    request: Request,
    response: Response,
    id: string,
    input: z.infer<typeof CreateReleaseSchema>,
  ) {
    const actor = await this.auth.identity(request);
    await this.auth.rate.take('release-create', actor.account.id, 20, 3600);
    return this.releases.create(actor, id, input, this.key(request), this.auth.requestId(response));
  }
  async own(request: Request, id: string, page: number) {
    return this.releases.ownList(await this.auth.identity(request), id, page);
  }
  async pendingHint(request: Request, id: string) {
    const actor = await this.auth.identity(request);
    await this.auth.rate.take('submission-pending-hint', actor.account.id, 120, 60);
    return this.releases.pendingHint(actor, id);
  }
  async withdraw(
    request: Request,
    response: Response,
    id: string,
    expected: number,
    reason: string,
  ) {
    return this.releases.withdraw(
      await this.auth.identity(request),
      id,
      expected,
      reason,
      this.auth.requestId(response),
    );
  }
  async restore(
    request: Request,
    response: Response,
    id: string,
    input: z.infer<typeof RestoreSubmissionSchema>,
  ) {
    return this.releases.restore(
      await this.auth.identity(request),
      id,
      input,
      this.auth.requestId(response),
    );
  }
  async queue(
    request: Request,
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN',
    page: number,
  ) {
    await this.reviewer(request);
    return this.moderation.queue(status, page);
  }
  async detail(request: Request, id: string) {
    await this.reviewer(request);
    return this.moderation.detail(id);
  }
  async review(
    request: Request,
    response: Response,
    id: string,
    input: z.infer<typeof ReviewRequestSchema>,
  ) {
    return this.moderation.review(
      await this.reviewer(request),
      id,
      input,
      this.key(request),
      this.auth.requestId(response),
    );
  }
  async visibility(
    request: Request,
    response: Response,
    id: string,
    visibility: 'listed' | 'hidden',
    reason: string,
  ) {
    return this.moderation.visibility(
      await this.auth.identity(request),
      id,
      visibility,
      reason,
      this.auth.requestId(response),
    );
  }
  async rollback(
    request: Request,
    response: Response,
    id: string,
    releaseId: string,
    reason: string,
  ) {
    return this.moderation.rollback(
      await this.auth.identity(request),
      id,
      releaseId,
      reason,
      this.auth.requestId(response),
    );
  }
  async releaseAction(
    request: Request,
    response: Response,
    id: string,
    releaseId: string,
    action: 'withdraw' | 'block' | 'restore',
    reason: string,
  ) {
    const actor =
      action === 'withdraw'
        ? await this.auth.identity(request)
        : await this.auth.administrator(request, 'session');
    return this.moderation.releaseAction(
      actor,
      id,
      releaseId,
      action,
      reason,
      this.auth.requestId(response),
    );
  }
  async image(request: Request, response: Response, id: string, scope: 'public' | 'moderation') {
    if (scope === 'moderation') await this.reviewer(request);
    const read = () =>
      scope === 'public' ? this.publications.publicAsset(id) : this.publications.reviewAsset(id);
    const asset = await read();
    const bytes = await this.storage.read(asset.storageKey).catch(() => {
      throw new BusinessError('NOT_FOUND', '图片暂时不可读取');
    });
    await read();
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(Buffer.from(bytes));
  }
  list(query: PublicPersonaQuery) {
    return this.publications.list(query);
  }
  current(id: string) {
    return this.publications.current(id);
  }
  release(id: string, releaseId: string) {
    return this.publications.release(id, releaseId);
  }
  history(id: string, page: number) {
    return this.publications.history(id, page);
  }
}
