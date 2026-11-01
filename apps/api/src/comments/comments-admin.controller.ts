import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  AdminCommentResponseSchema,
  BulkReviewCommentsResponseSchema,
  BulkReviewCommentsSchema,
  CommentIdSchema,
  CommentModerationQuerySchema,
  CommentModerationResponseSchema,
  CommentVisibilitySchema,
  ErrorResponseSchema,
  ReviewCommentSchema,
} from '@personamarket/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { CommentsService } from './comments.service.js';

@ApiTags('comment-moderation')
@ApiHeader({
  name: 'X-Expected-Account',
  required: false,
  description: '可选账号前置条件，仅用于与实际会话核对，不授予身份或权限',
})
@Controller('admin/comments')
@UseGuards(AuthGuard)
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class CommentsAdminController {
  constructor(@Inject(CommentsService) readonly service: CommentsService) {}
  @Get()
  @ApiOperation({ operationId: 'getModerationComments' })
  @ApiOkResponse({ standardSchema: CommentModerationResponseSchema })
  @SerializeOptions({ schema: CommentModerationResponseSchema })
  queue(
    @Req() request: Request,
    @Query({ schema: CommentModerationQuerySchema })
    query: z.infer<typeof CommentModerationQuerySchema>,
  ) {
    return this.service.queue(request, query);
  }
  @Get(':id')
  @ApiOperation({ operationId: 'getModerationComment' })
  @ApiOkResponse({ standardSchema: AdminCommentResponseSchema })
  @SerializeOptions({ schema: AdminCommentResponseSchema })
  detail(
    @Req() request: Request,
    @Param({ schema: CommentIdSchema }) { id }: z.infer<typeof CommentIdSchema>,
  ) {
    return this.service.detail(request, id);
  }
  @Post('bulk-review')
  @HttpCode(200)
  @ApiOperation({ operationId: 'reviewCommentsBatch' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: BulkReviewCommentsResponseSchema })
  @SerializeOptions({ schema: BulkReviewCommentsResponseSchema })
  bulk(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body({ schema: BulkReviewCommentsSchema }) input: z.infer<typeof BulkReviewCommentsSchema>,
  ) {
    return this.service.bulk(request, response, input);
  }
  @Post(':id/review')
  @HttpCode(200)
  @ApiOperation({ operationId: 'reviewComment' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminCommentResponseSchema })
  @SerializeOptions({ schema: AdminCommentResponseSchema })
  review(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: CommentIdSchema }) { id }: z.infer<typeof CommentIdSchema>,
    @Body({ schema: ReviewCommentSchema }) input: z.infer<typeof ReviewCommentSchema>,
  ) {
    return this.service.review(request, response, id, input);
  }
  @Put(':id/visibility')
  @ApiOperation({ operationId: 'setCommentVisibility' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminCommentResponseSchema })
  @SerializeOptions({ schema: AdminCommentResponseSchema })
  visibility(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: CommentIdSchema }) { id }: z.infer<typeof CommentIdSchema>,
    @Body({ schema: CommentVisibilitySchema }) input: z.infer<typeof CommentVisibilitySchema>,
  ) {
    return this.service.visibility(request, response, id, input);
  }
}
