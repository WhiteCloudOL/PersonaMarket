import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  IdSchema,
  type PolicySlug,
  type PolicyReadQuery,
  type PolicyWrite,
  type SubmitPolicy,
  type WithdrawPolicy,
  type ReviewPolicy,
  type UnpublishPolicy,
  type ActivatePolicy,
  type PolicySubmissionsQuery,
  type PolicyRecordsQuery,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { AuthService } from '../auth/auth.service.js';
import { PoliciesRepository } from './policies.repository.js';

@Injectable()
export class PoliciesService {
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(PoliciesRepository) readonly repository: PoliciesRepository,
  ) {}

  private async actor(request: Request, writing = false) {
    const actor = await this.auth.administrator(request, 'session');
    const expected = request.get('x-expected-account');
    if (
      expected &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新确认公共规则');
    await this.auth.rate.take(
      writing ? 'policy-management-write' : 'policy-management-read',
      actor.account.id,
      writing ? 30 : 120,
      60,
    );
    return actor;
  }

  private async publicActor(request: Request) {
    await this.auth.rate.take('site-policies', request.ip ?? 'unknown', 120, 60);
  }

  private headers(request: Request, slug: PolicySlug) {
    const match = new RegExp('^"policy-' + slug + '-([1-9]\\d{0,9})"$').exec(
      request.get('if-match') ?? '',
    );
    if (!match?.[1]) throw new BusinessError('INVALID_INPUT', '请先读取规则并提供对应的 If-Match');
    const key = IdSchema.safeParse(request.get('idempotency-key'));
    if (!key.success) throw new BusinessError('INVALID_INPUT', '请提供有效的操作幂等标识');
    return { expected: Number(match[1]), key: key.data.toLowerCase() };
  }

  async publicList(request: Request) {
    await this.publicActor(request);
    return this.repository.publicList();
  }

  async publicRead(request: Request, slug: PolicySlug, input: PolicyReadQuery) {
    await this.publicActor(request);
    return this.repository.publicRead(slug, input);
  }

  async list(request: Request) {
    return this.repository.list(await this.actor(request));
  }

  async read(request: Request, slug: PolicySlug) {
    return this.repository.read(await this.actor(request), slug);
  }

  async submissions(request: Request, slug: PolicySlug, input: PolicySubmissionsQuery) {
    return this.repository.submissions(await this.actor(request), slug, input);
  }

  async submission(request: Request, slug: PolicySlug, id: string) {
    return this.repository.submission(await this.actor(request), slug, id);
  }

  async records(request: Request, slug: PolicySlug, input: PolicyRecordsQuery) {
    return this.repository.records(await this.actor(request), slug, input);
  }

  async record(request: Request, slug: PolicySlug, id: string) {
    return this.repository.record(await this.actor(request), slug, id);
  }

  async write(request: Request, response: Response, slug: PolicySlug, input: PolicyWrite) {
    const actor = await this.actor(request, true),
      headers = this.headers(request, slug);
    return this.repository.write(
      actor,
      slug,
      input,
      headers.expected,
      headers.key,
      this.auth.requestId(response),
    );
  }

  async submit(request: Request, response: Response, slug: PolicySlug, input: SubmitPolicy) {
    const actor = await this.actor(request, true),
      headers = this.headers(request, slug);
    return this.repository.submit(
      actor,
      slug,
      input,
      headers.expected,
      headers.key,
      this.auth.requestId(response),
    );
  }

  async withdraw(
    request: Request,
    response: Response,
    slug: PolicySlug,
    id: string,
    input: WithdrawPolicy,
  ) {
    const actor = await this.actor(request, true),
      headers = this.headers(request, slug);
    return this.repository.withdraw(
      actor,
      slug,
      id,
      input,
      headers.expected,
      headers.key,
      this.auth.requestId(response),
    );
  }

  async review(
    request: Request,
    response: Response,
    slug: PolicySlug,
    id: string,
    input: ReviewPolicy,
  ) {
    const actor = await this.actor(request, true),
      headers = this.headers(request, slug);
    return this.repository.review(
      actor,
      slug,
      id,
      input,
      headers.expected,
      headers.key,
      this.auth.requestId(response),
    );
  }

  async unpublish(request: Request, response: Response, slug: PolicySlug, input: UnpublishPolicy) {
    const actor = await this.actor(request, true),
      headers = this.headers(request, slug);
    return this.repository.unpublish(
      actor,
      slug,
      input,
      headers.expected,
      headers.key,
      this.auth.requestId(response),
    );
  }

  async activate(request: Request, response: Response, slug: PolicySlug, input: ActivatePolicy) {
    const actor = await this.actor(request, true),
      headers = this.headers(request, slug);
    return this.repository.activate(
      actor,
      slug,
      input,
      headers.expected,
      headers.key,
      this.auth.requestId(response),
    );
  }
}
