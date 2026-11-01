import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { RankingQuery } from '@personamarket/contracts';
import { AuthService } from '../auth/auth.service.js';
import { RankingsRepository } from './rankings.repository.js';

@Injectable()
export class RankingsService {
  constructor(
    @Inject(RankingsRepository) readonly repository: RankingsRepository,
    @Inject(AuthService) readonly auth: AuthService,
  ) {}
  async list(request: Request, query: RankingQuery) {
    await this.auth.rate.take('public-rankings', request.ip ?? 'unknown', 60, 60);
    return this.repository.list(query);
  }
}
