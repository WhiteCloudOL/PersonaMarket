import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { FavoritesQuery } from '@personamarket/contracts';
import { AuthService } from '../auth/auth.service.js';
import { InteractionsRepository } from './interactions.repository.js';

@Injectable()
export class InteractionsService {
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(InteractionsRepository) readonly repository: InteractionsRepository,
  ) {}
  async states(request: Request, ids: string) {
    const actor = await this.auth.identity(request);
    await this.auth.rate.take('interaction-read', actor.account.id, 120, 60);
    return this.repository.states(actor, [...new Set(ids.toLowerCase().split(','))]);
  }
  async set(request: Request, id: string, kind: 'like' | 'favorite', enabled: boolean) {
    const actor = await this.auth.identity(request);
    await this.auth.rate.take('interaction-write', actor.account.id, 30, 60);
    return this.repository.set(actor, id, kind, enabled);
  }
  async favorites(request: Request, input: FavoritesQuery) {
    const actor = await this.auth.identity(request);
    await this.auth.rate.take('favorites-read', actor.account.id, 60, 60);
    return this.repository.favorites(actor, input);
  }
}
