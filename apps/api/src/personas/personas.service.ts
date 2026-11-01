import { Inject, Injectable } from '@nestjs/common';
import { BusinessError } from '@personamarket/server';
import type { PersonaDraft, CreatePersonaRequest } from '@personamarket/contracts';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { PersonasRepository } from './personas.repository.js';
@Injectable()
export class PersonasService {
  taxonomy() {
    return this.repository.taxonomy();
  }
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(PersonasRepository) readonly repository: PersonasRepository,
  ) {}
  async create(request: Request, input: CreatePersonaRequest) {
    const actor = await this.auth.identity(request);
    await this.auth.rate.take('persona-create', actor.account.id, 20, 3600);
    return this.repository.read(actor, await this.repository.create(actor, input));
  }
  async read(request: Request, id: string) {
    return this.repository.read(await this.auth.identity(request), id);
  }
  async list(request: Request, page: number, pageSize: number) {
    return this.repository.list(await this.auth.identity(request), page, pageSize);
  }
  async save(request: Request, id: string, payload: PersonaDraft) {
    const actor = await this.auth.identity(request);
    const expected = /^"draft-([0-9]+)"$/.exec(request.get('if-match') ?? '')?.[1];
    if (!expected || !Number.isSafeInteger(Number(expected)))
      throw new BusinessError('REVISION_CONFLICT', '请先读取服务器草稿版本后再保存');
    return this.repository.save(actor, id, payload, Number(expected));
  }
}
