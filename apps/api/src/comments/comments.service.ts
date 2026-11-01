import { Inject, Injectable } from '@nestjs/common';
import { IdSchema, BulkReviewCommentsResponseSchema } from '@personamarket/contracts';
import type {
  BulkReviewCommentsSchema,
  CommentModerationQuerySchema,
  CommentVisibilitySchema,
  CommentsQuery,
  CreateCommentSchema,
  DeleteCommentSchema,
  EditCommentSchema,
  OwnCommentsQuerySchema,
  ReviewCommentSchema,
} from '@personamarket/contracts';
import { BusinessError, createLogger } from '@personamarket/server';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthService, type Identity } from '../auth/auth.service.js';
import { CommentsReadRepository } from './comments-read.repository.js';
import { CommentsWriteRepository } from './comments-write.repository.js';
import { CommentsModerationRepository } from './comments-moderation.repository.js';

@Injectable()
export class CommentsService {
  private readonly logger;
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(CommentsReadRepository) readonly reads: CommentsReadRepository,
    @Inject(CommentsWriteRepository) readonly writes: CommentsWriteRepository,
    @Inject(CommentsModerationRepository) readonly moderation: CommentsModerationRepository,
  ) {
    this.logger = createLogger('comments', auth.env.LOG_LEVEL);
  }

  private key(request: Request) {
    const result = IdSchema.safeParse(request.get('idempotency-key'));
    if (!result.success) throw new BusinessError('INVALID_INPUT', '请使用有效的幂等标识后重试');
    return result.data;
  }
  private async actor(request: Request, scope: string, limit: number) {
    const actor = await this.auth.identity(request);
    this.expectedActor(request, actor);
    await this.auth.rate.take(scope, actor.account.id, limit, 60);
    return actor;
  }
  private expectedActor(request: Request, actor: Identity) {
    const expected = request.get('x-expected-account');
    if (
      expected &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新确认评论操作');
  }
  private async reviewer(request: Request) {
    const actor = await this.actor(request, 'comments-moderation', 60);
    if (!['admin', 'moderator'].includes(actor.account.role))
      throw new BusinessError('FORBIDDEN', '此操作需要审核权限');
    return actor;
  }
  async public(request: Request, id: string, query: CommentsQuery) {
    await this.auth.rate.take('comments-public', request.ip ?? 'unknown', 120, 60);
    return this.reads.public(id, query);
  }
  async replies(request: Request, id: string, query: CommentsQuery) {
    await this.auth.rate.take('comments-public', request.ip ?? 'unknown', 120, 60);
    const personaId = await this.writes.location(id);
    return this.reads.public(personaId, query, id);
  }
  async own(request: Request, query: z.infer<typeof OwnCommentsQuerySchema>) {
    return this.reads.own(
      await this.actor(request, 'comments-private', 120),
      query.personaId,
      query,
    );
  }
  async ownDetail(request: Request, id: string) {
    return this.reads.ownDetail(await this.actor(request, 'comments-private', 120), id);
  }
  async create(
    request: Request,
    response: Response,
    id: string,
    input: z.infer<typeof CreateCommentSchema>,
  ) {
    return this.writes.create(
      await this.actor(request, 'comments-write', 30),
      id,
      input,
      this.key(request),
      this.auth.requestId(response),
    );
  }
  async edit(
    request: Request,
    response: Response,
    id: string,
    input: z.infer<typeof EditCommentSchema>,
  ) {
    return this.writes.edit(
      await this.actor(request, 'comments-write', 30),
      id,
      input,
      this.key(request),
      this.auth.requestId(response),
    );
  }
  async delete(
    request: Request,
    response: Response,
    id: string,
    input: z.infer<typeof DeleteCommentSchema>,
  ) {
    return this.writes.delete(
      await this.actor(request, 'comments-write', 30),
      id,
      input,
      this.key(request),
      this.auth.requestId(response),
    );
  }
  async queue(request: Request, input: z.infer<typeof CommentModerationQuerySchema>) {
    return this.reads.queue(await this.reviewer(request), input);
  }
  async detail(request: Request, id: string) {
    return this.reads.detail(await this.reviewer(request), id);
  }
  async review(
    request: Request,
    response: Response,
    id: string,
    input: z.infer<typeof ReviewCommentSchema>,
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
    input: z.infer<typeof CommentVisibilitySchema>,
  ) {
    const actor = await this.auth.administrator(request, 'session');
    this.expectedActor(request, actor);
    await this.auth.rate.take('comments-moderation', actor.account.id, 60, 60);
    return this.moderation.visibility(
      actor,
      id,
      input,
      this.key(request),
      this.auth.requestId(response),
    );
  }
  async bulk(
    request: Request,
    response: Response,
    input: z.infer<typeof BulkReviewCommentsSchema>,
  ) {
    const actor = await this.reviewer(request);
    const key = this.key(request);
    const requestId = this.auth.requestId(response);
    await this.moderation.bulkReceipt(actor, input, key);
    const results: z.infer<typeof BulkReviewCommentsResponseSchema>['data'] = [];
    for (const item of input.items) {
      try {
        const result = await this.moderation.review(
          actor,
          item.id,
          item.review,
          key,
          requestId,
          true,
        );
        results.push({ id: item.id, ok: true, data: result.data });
      } catch (cause) {
        if (cause instanceof BusinessError)
          results.push({
            id: item.id,
            ok: false,
            error: { code: cause.code, message: cause.message },
          });
        else {
          this.logger.error({
            event: 'comment.bulk.item_failed',
            requestId,
            commentId: item.id,
            code: 'INTERNAL_ERROR',
          });
          results.push({
            id: item.id,
            ok: false,
            error: { code: 'INTERNAL_ERROR', message: '这条评论暂未处理，请刷新后重试' },
          });
        }
      }
    }
    return BulkReviewCommentsResponseSchema.parse({ data: results });
  }
}
