import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CommentActionResponseSchema,
  CommentIdSchema,
  CommentResponseSchema,
  CommentsQuerySchema,
  CreateCommentSchema,
  DeleteCommentSchema,
  EditCommentSchema,
  ErrorResponseSchema,
  OwnCommentsQuerySchema,
  OwnCommentsResponseSchema,
  PersonaIdSchema,
  PublicCommentsResponseSchema,
} from '@personamarket/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { CommentsService } from './comments.service.js';

@ApiTags('comments')
@ApiHeader({
  name: 'X-Expected-Account',
  required: false,
  description: '可选账号前置条件，仅用于与实际会话核对，不授予身份或权限',
})
@Controller()
@UseGuards(AuthGuard)
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 422, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class CommentsController {
  constructor(@Inject(CommentsService) readonly service: CommentsService) {}
  @Get('personas/:id/comments')
  @ApiOperation({ operationId: 'getPublicComments' })
  @ApiOkResponse({ standardSchema: PublicCommentsResponseSchema })
  @SerializeOptions({ schema: PublicCommentsResponseSchema })
  public(
    @Req() request: Request,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
    @Query({ schema: CommentsQuerySchema }) query: z.infer<typeof CommentsQuerySchema>,
  ) {
    return this.service.public(request, id, query);
  }
  @Get('comments/:id/replies')
  @ApiOperation({ operationId: 'getCommentReplies' })
  @ApiOkResponse({ standardSchema: PublicCommentsResponseSchema })
  @SerializeOptions({ schema: PublicCommentsResponseSchema })
  replies(
    @Req() request: Request,
    @Param({ schema: CommentIdSchema }) { id }: z.infer<typeof CommentIdSchema>,
    @Query({ schema: CommentsQuerySchema }) query: z.infer<typeof CommentsQuerySchema>,
  ) {
    return this.service.replies(request, id, query);
  }
  @Get('me/comments')
  @ApiOperation({ operationId: 'getOwnComments' })
  @ApiOkResponse({ standardSchema: OwnCommentsResponseSchema })
  @SerializeOptions({ schema: OwnCommentsResponseSchema })
  own(
    @Req() request: Request,
    @Query({ schema: OwnCommentsQuerySchema }) query: z.infer<typeof OwnCommentsQuerySchema>,
  ) {
    return this.service.own(request, query);
  }
  @Get('me/comments/:id')
  @ApiOperation({ operationId: 'getOwnComment' })
  @ApiOkResponse({ standardSchema: CommentResponseSchema })
  @SerializeOptions({ schema: CommentResponseSchema })
  ownDetail(
    @Req() request: Request,
    @Param({ schema: CommentIdSchema }) { id }: z.infer<typeof CommentIdSchema>,
  ) {
    return this.service.ownDetail(request, id);
  }
  @Post('personas/:id/comments')
  @HttpCode(200)
  @ApiOperation({ operationId: 'createComment' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: CommentResponseSchema })
  @SerializeOptions({ schema: CommentResponseSchema })
  create(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
    @Body({ schema: CreateCommentSchema }) input: z.infer<typeof CreateCommentSchema>,
  ) {
    return this.service.create(request, response, id, input);
  }
  @Patch('comments/:id')
  @ApiOperation({ operationId: 'editComment' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: CommentResponseSchema })
  @SerializeOptions({ schema: CommentResponseSchema })
  edit(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: CommentIdSchema }) { id }: z.infer<typeof CommentIdSchema>,
    @Body({ schema: EditCommentSchema }) input: z.infer<typeof EditCommentSchema>,
  ) {
    return this.service.edit(request, response, id, input);
  }
  @Delete('comments/:id')
  @ApiOperation({ operationId: 'deleteComment' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: CommentActionResponseSchema })
  @SerializeOptions({ schema: CommentActionResponseSchema })
  delete(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: CommentIdSchema }) { id }: z.infer<typeof CommentIdSchema>,
    @Body({ schema: DeleteCommentSchema }) input: z.infer<typeof DeleteCommentSchema>,
  ) {
    return this.service.delete(request, response, id, input);
  }
}
