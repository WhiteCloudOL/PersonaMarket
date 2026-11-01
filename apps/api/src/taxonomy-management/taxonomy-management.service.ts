import { Inject, Injectable } from '@nestjs/common';
import {
  IdSchema,
  type TaxonomyKind,
  type TaxonomyManagementQuery,
  type TaxonomyManagementPagination,
  type CreateTaxonomyEntry,
  type UpdateTaxonomyEntry,
  type TaxonomyAction,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { TaxonomyManagementRepository } from './taxonomy-management.repository.js';

function expectedRevision(request: Request, kind: TaxonomyKind, id: string) {
  const raw = request.get('if-match');
  const prefix = '"' + kind + '-' + id.toLowerCase() + '-';
  if (!raw?.startsWith(prefix) || !raw.endsWith('"'))
    throw new BusinessError('INVALID_INPUT', '请先读取条目，并提供对应的 If-Match 修订标识');
  const text = raw.slice(prefix.length, -1);
  if (!/^[1-9]\d{0,9}$/.test(text))
    throw new BusinessError('INVALID_INPUT', '修订标识无效，请重新读取条目');
  return Number(text);
}

@Injectable()
export class TaxonomyManagementService {
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(TaxonomyManagementRepository) readonly repository: TaxonomyManagementRepository,
  ) {}
  private async actor(request: Request, writing = false) {
    const actor = await this.auth.administrator(request, 'session');
    const expected = request.get('x-expected-account');
    if (
      expected &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新确认管理操作');
    await this.auth.rate.take(
      writing ? 'taxonomy-management-write' : 'taxonomy-management-read',
      actor.account.id,
      writing ? 30 : 120,
      60,
    );
    return actor;
  }
  private key(request: Request) {
    const key = IdSchema.safeParse(request.get('idempotency-key'));
    if (!key.success) throw new BusinessError('INVALID_INPUT', '请提供有效的操作幂等标识');
    return key.data;
  }
  async list(request: Request, kind: TaxonomyKind, input: TaxonomyManagementQuery) {
    return this.repository.list(await this.actor(request), kind, input);
  }
  async detail(request: Request, kind: TaxonomyKind, id: string) {
    return this.repository.detail(await this.actor(request), kind, id.toLowerCase());
  }
  async records(
    request: Request,
    kind: TaxonomyKind,
    id: string,
    input: TaxonomyManagementPagination,
  ) {
    return this.repository.records(await this.actor(request), kind, id.toLowerCase(), input);
  }
  async create(
    request: Request,
    response: Response,
    kind: TaxonomyKind,
    input: CreateTaxonomyEntry,
  ) {
    return this.repository.change(
      await this.actor(request, true),
      kind,
      { action: 'created', input },
      this.key(request),
      this.auth.requestId(response),
    );
  }
  async update(
    request: Request,
    response: Response,
    kind: TaxonomyKind,
    id: string,
    input: UpdateTaxonomyEntry,
  ) {
    return this.repository.change(
      await this.actor(request, true),
      kind,
      {
        action: 'updated',
        id: id.toLowerCase(),
        expected: expectedRevision(request, kind, id),
        input,
      },
      this.key(request),
      this.auth.requestId(response),
    );
  }
  async action(
    request: Request,
    response: Response,
    kind: TaxonomyKind,
    id: string,
    action: 'archived' | 'restored',
    input: TaxonomyAction,
  ) {
    return this.repository.change(
      await this.actor(request, true),
      kind,
      { action, id: id.toLowerCase(), expected: expectedRevision(request, kind, id), input },
      this.key(request),
      this.auth.requestId(response),
    );
  }
}
