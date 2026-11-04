import { Inject, Injectable } from '@nestjs/common';
import { AssetInfoSchema, IdSchema, type AssetPurposeSchema } from '@personamarket/contracts';
import {
  BusinessError,
  LocalStorage,
  storeImage,
  checkedImageUrl,
  assertOrdinaryRequestAllowed,
  type ServerEnvironment,
} from '@personamarket/server';
import type { z } from 'zod';
import type { Request, Response } from 'express';
import { ENVIRONMENT } from '../tokens.js';
import { AuthService } from '../auth/auth.service.js';
import { AssetsRepository } from './assets.repository.js';
@Injectable()
export class AssetsService {
  private readonly storage;
  constructor(
    @Inject(ENVIRONMENT) env: ServerEnvironment,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AssetsRepository) readonly repository: AssetsRepository,
  ) {
    this.storage = new LocalStorage(env.STORAGE_ROOT);
  }
  info(row: Awaited<ReturnType<AssetsRepository['own']>>) {
    return AssetInfoSchema.parse({
      id: row.id,
      purpose: row.purpose,
      mime: row.mime,
      bytes: row.bytes,
      width: row.width,
      height: row.height,
      createdAt: row.createdAt.toISOString(),
    });
  }
  async upload(
    request: Request,
    purpose: z.infer<typeof AssetPurposeSchema> | 'persona-avatar',
    bytes: Buffer,
  ) {
    const actor = await this.auth.identity(request);
    const expected = request.get('x-expected-account');
    if (purpose === 'persona-avatar' && !expected)
      throw new BusinessError('INVALID_INPUT', '请确认要上传头像的账号');
    if (
      expected &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新确认需要上传的图片');
    await assertOrdinaryRequestAllowed(this.repository.database);
    const row = await storeImage(
      this.repository.database,
      this.storage,
      actor.account.id,
      purpose,
      bytes,
    );
    return { data: this.info(row) };
  }
  async list(request: Request) {
    const actor = await this.auth.identity(request);
    return { data: (await this.repository.list(actor)).map((row) => this.info(row)) };
  }
  async read(request: Request, response: Response, id: string) {
    const actor = await this.auth.identity(request);
    const asset = await this.repository.own(actor, id);
    const bytes = await this.storage.read(asset.storageKey).catch(() => {
      throw new BusinessError('NOT_FOUND', '素材暂时不可读取');
    });
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(Buffer.from(bytes));
  }
  async queue(request: Request, url: string) {
    const actor = await this.auth.identity(request);
    if (!actor.account.emailVerifiedAt)
      throw new BusinessError('FORBIDDEN', '请先验证邮箱后再导入在线图片');
    await assertOrdinaryRequestAllowed(this.repository.database);
    checkedImageUrl(url);
    await this.auth.rate.take('image-import', actor.account.id, 10, 900);
    const job = await this.repository.queue(actor, url);
    return this.jobView(job);
  }
  jobView(job: Awaited<ReturnType<AssetsRepository['job']>>) {
    return {
      data: {
        id: job.id,
        status: job.status,
        assetId: job.assetId,
        message:
          job.status === 'failed'
            ? job.errorCode === 'IMAGE_IMPORT_NOT_ALLOWED'
              ? '当前账号或图片设置不允许继续导入，请核对后重试'
              : '导入失败，请检查公网 HTTPS 地址、图片格式与大小后重试'
            : null,
      },
    };
  }
  async job(request: Request, id: string) {
    return this.jobView(await this.repository.job(await this.auth.identity(request), id));
  }
}
