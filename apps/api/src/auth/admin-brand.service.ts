import { Inject, Injectable } from '@nestjs/common';
import { PublicBrandSchema, type PublicBrand } from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { PublicConfigService } from '../public-config/public-config.service.js';
import { PublicConfigRepository } from '../public-config/public-config.repository.js';
@Injectable()
export class AdminBrandService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PublicConfigService) private readonly publicBrand: PublicConfigService,
    @Inject(PublicConfigRepository) private readonly repository: PublicConfigRepository,
  ) {}
  private async requireAdmin(request: Request) {
    return this.auth.administrator(request, 'session');
  }
  async read(request: Request) {
    await this.requireAdmin(request);
    return this.publicBrand.read();
  }
  async update(input: PublicBrand, request: Request, response: Response) {
    const identity = await this.requireAdmin(request);
    const expected = /^"brand-([0-9]+)"$/.exec(request.get('if-match') ?? '')?.[1];
    if (!expected || !Number.isSafeInteger(Number(expected)))
      throw new BusinessError('REVISION_CONFLICT', '请刷新设置后重试');
    const row = await this.repository.updateBrand(
      input,
      Number(expected),
      identity,
      this.auth.requestId(response),
    );
    if (!row) throw new BusinessError('REVISION_CONFLICT', '设置已被更新，请刷新后重试');
    return { data: PublicBrandSchema.parse(row.value), meta: { revision: row.revision } };
  }
}
