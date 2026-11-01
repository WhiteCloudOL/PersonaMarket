import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthRateLimit } from '../auth/rate-limit.service.js';
import { SitemapRepository } from './sitemap.repository.js';

@Injectable()
export class SitemapService {
  constructor(
    @Inject(SitemapRepository) readonly repository: SitemapRepository,
    @Inject(AuthRateLimit) readonly rate: AuthRateLimit,
  ) {}
  async index(request: Request) {
    await this.rate.take('public-sitemap', request.ip ?? 'unknown', 120, 60);
    return this.repository.index();
  }
  async entries(request: Request, page: number) {
    await this.rate.take('public-sitemap', request.ip ?? 'unknown', 120, 60);
    return this.repository.entries(page);
  }
}
