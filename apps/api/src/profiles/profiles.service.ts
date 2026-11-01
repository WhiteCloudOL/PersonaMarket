import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  IdSchema,
  PublicPersonaQuerySchema,
  type SaveProfile,
  type SubmitProfile,
  type WithdrawProfile,
  type ReviewProfile,
  type SetProfileVisibility,
  type ProfileHistoryQuery,
  type ProfileModerationQuery,
  type CreatorPersonasQuery,
} from '@personamarket/contracts';
import { BusinessError, LocalStorage, type ServerEnvironment } from '@personamarket/server';
import { ENVIRONMENT } from '../tokens.js';
import { AuthService } from '../auth/auth.service.js';
import { ProfilesReadRepository } from './profiles-read.repository.js';
import { ProfilesWriteRepository } from './profiles-write.repository.js';
import { ProfilesModerationRepository } from './profiles-moderation.repository.js';
import { requireProfileModerator } from './profile-transactions.js';
import { DiscoveryRepository } from '../releases/discovery.repository.js';

@Injectable()
export class ProfilesService {
  private readonly storage;
  constructor(
    @Inject(ENVIRONMENT) env: ServerEnvironment,
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(ProfilesReadRepository) readonly reads: ProfilesReadRepository,
    @Inject(ProfilesWriteRepository) readonly writes: ProfilesWriteRepository,
    @Inject(ProfilesModerationRepository) readonly moderation: ProfilesModerationRepository,
    @Inject(DiscoveryRepository) readonly discovery: DiscoveryRepository,
  ) {
    this.storage = new LocalStorage(env.STORAGE_ROOT);
  }
  private async actor(request: Request, writing = false, managing = false) {
    const actor = await this.auth.identity(request),
      expected = request.get('x-expected-account');
    if (managing) requireProfileModerator(actor.account.role);
    if (
      expected &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请保留输入并重新确认');
    await this.auth.rate.take(
      writing ? 'profile-write' : 'profile-read',
      actor.account.id,
      writing ? 30 : 120,
      60,
    );
    return actor;
  }
  private key(request: Request) {
    const parsed = IdSchema.safeParse(request.get('idempotency-key'));
    if (!parsed.success) throw new BusinessError('INVALID_INPUT', '请提供有效的操作幂等标识');
    return parsed.data.toLowerCase();
  }
  async own(request: Request) {
    return this.reads.own(await this.actor(request));
  }
  async save(request: Request, input: SaveProfile) {
    return this.writes.save(await this.actor(request, true), input);
  }
  async submit(request: Request, response: Response, input: SubmitProfile) {
    return this.writes.submit(
      await this.actor(request, true),
      input,
      this.key(request),
      this.auth.requestId(response),
    );
  }
  async history(request: Request, input: ProfileHistoryQuery) {
    return this.reads.history(await this.actor(request), input);
  }
  async records(request: Request, input: ProfileHistoryQuery, userId?: string) {
    return this.reads.records(
      await this.actor(request, false, Boolean(userId)),
      input,
      userId?.toLowerCase(),
    );
  }
  async submission(request: Request, id: string) {
    return this.reads.submission(await this.actor(request), id.toLowerCase());
  }
  async withdraw(request: Request, response: Response, id: string, input: WithdrawProfile) {
    return this.writes.withdraw(
      await this.actor(request, true),
      id.toLowerCase(),
      input,
      this.key(request),
      this.auth.requestId(response),
    );
  }
  async adminList(request: Request, input: ProfileModerationQuery) {
    return this.reads.adminList(await this.actor(request, false, true), input);
  }
  async admin(request: Request, id: string) {
    return this.reads.admin(await this.actor(request, false, true), id.toLowerCase());
  }
  async review(request: Request, response: Response, id: string, input: ReviewProfile) {
    return this.moderation.review(
      await this.actor(request, true, true),
      id.toLowerCase(),
      input,
      this.key(request),
      this.auth.requestId(response),
    );
  }
  async visibility(
    request: Request,
    response: Response,
    userId: string,
    input: SetProfileVisibility,
  ) {
    return this.moderation.visibility(
      await this.actor(request, true, true),
      userId.toLowerCase(),
      input,
      this.key(request),
      this.auth.requestId(response),
    );
  }
  async creator(request: Request, response: Response, username: string) {
    await this.auth.rate.take('creator-public-read', request.ip ?? 'unknown', 120, 60);
    response.setHeader('Cache-Control', 'no-store');
    return this.reads.creator(username);
  }
  async creatorPersonas(
    request: Request,
    response: Response,
    username: string,
    input: CreatorPersonasQuery,
  ) {
    await this.auth.rate.take('creator-public-read', request.ip ?? 'unknown', 120, 60);
    response.setHeader('Cache-Control', 'no-store');
    const owner = await this.reads.publicOwner(username);
    return this.discovery.list(PublicPersonaQuerySchema.parse(input), owner.id);
  }
  private async sendAvatar(response: Response, key: string) {
    const bytes = await this.storage.read(key).catch(() => {
      throw new BusinessError('NOT_FOUND', '头像暂时无法读取');
    });
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(Buffer.from(bytes));
  }
  async publicAvatar(request: Request, response: Response, username: string, id: string) {
    await this.auth.rate.take('creator-avatar-read', request.ip ?? 'unknown', 120, 60);
    return this.sendAvatar(response, await this.reads.publicAvatar(username, id.toLowerCase()));
  }
  async adminAvatar(request: Request, response: Response, id: string) {
    return this.sendAvatar(
      response,
      await this.reads.adminAvatar(await this.actor(request, false, true), id.toLowerCase()),
    );
  }
}
