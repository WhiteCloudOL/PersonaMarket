import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  Res,
  Inject,
  UseGuards,
  SerializeOptions,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiResponse, ApiHeader } from '@nestjs/swagger';
import {
  CreateReleaseSchema,
  SubmissionResponseSchema,
  SubmissionListResponseSchema,
  SubmissionPendingHintResponseSchema,
  ReviewRequestSchema,
  ReviewDetailResponseSchema,
  WithdrawSubmissionSchema,
  PublicReleaseResponseSchema,
  PublicReleaseListResponseSchema,
  PublicPersonaListResponseSchema,
  PublicPersonaQuerySchema,
  VisibilityRequestSchema,
  RollbackRequestSchema,
  ReleaseActionSchema,
  ReleasePathSchema,
  RestoreSubmissionSchema,
  ReviewQueueSchema,
  PersonaIdSchema,
  PaginationSchema,
  AuthNoticeResponseSchema,
  ErrorResponseSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { ReleasesService } from './releases.service.js';
@ApiTags('releases')
@UseGuards(AuthGuard)
@Controller()
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 422, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class ReleasesController {
  constructor(@Inject(ReleasesService) private readonly service: ReleasesService) {}
  @Post('me/personas/:id/releases')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'createOwnRelease' })
  @ApiOkResponse({ standardSchema: SubmissionResponseSchema })
  @SerializeOptions({ schema: SubmissionResponseSchema })
  create(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
    @Body({ schema: CreateReleaseSchema }) input: z.infer<typeof CreateReleaseSchema>,
  ) {
    return this.service.create(request, response, id, input);
  }
  @Get('me/personas/:id/releases')
  @ApiOperation({ operationId: 'getOwnSubmissions' })
  @ApiOkResponse({ standardSchema: SubmissionListResponseSchema })
  @SerializeOptions({ schema: SubmissionListResponseSchema })
  own(
    @Req() request: Request,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
    @Query({ schema: PaginationSchema }) query: z.infer<typeof PaginationSchema>,
  ) {
    return this.service.own(request, id, query.page);
  }
  @Get('me/submissions/:id/pending-hint')
  @ApiOperation({ operationId: 'getOwnSubmissionPendingHint' })
  @ApiOkResponse({ standardSchema: SubmissionPendingHintResponseSchema })
  @ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
  @SerializeOptions({ schema: SubmissionPendingHintResponseSchema })
  pendingHint(
    @Req() request: Request,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
  ) {
    return this.service.pendingHint(request, id);
  }
  @Post('me/submissions/:id/withdraw')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOperation({ operationId: 'withdrawOwnSubmission' })
  @ApiOkResponse({ standardSchema: SubmissionResponseSchema })
  @SerializeOptions({ schema: SubmissionResponseSchema })
  withdraw(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
    @Body({ schema: WithdrawSubmissionSchema }) input: z.infer<typeof WithdrawSubmissionSchema>,
  ) {
    return this.service.withdraw(request, response, id, input.expectedRevision, input.reason);
  }
  @Post('me/personas/:id/restore-submission')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOperation({ operationId: 'restoreOwnSubmissionDraft' })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  restore(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
    @Body({ schema: RestoreSubmissionSchema }) input: z.infer<typeof RestoreSubmissionSchema>,
  ) {
    return this.service.restore(request, response, id, input);
  }
  @Get('admin/moderation/submissions')
  @ApiOperation({ operationId: 'getSubmissionReviewQueue' })
  @ApiOkResponse({ standardSchema: SubmissionListResponseSchema })
  @SerializeOptions({ schema: SubmissionListResponseSchema })
  queue(
    @Req() request: Request,
    @Query({ schema: ReviewQueueSchema }) query: z.infer<typeof ReviewQueueSchema>,
  ) {
    return this.service.queue(request, query.status, query.page);
  }
  @Get('admin/moderation/submissions/:id')
  @ApiOperation({ operationId: 'getSubmissionReviewDetail' })
  @ApiOkResponse({ standardSchema: ReviewDetailResponseSchema })
  @SerializeOptions({ schema: ReviewDetailResponseSchema })
  detail(
    @Req() request: Request,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
  ) {
    return this.service.detail(request, id);
  }
  @Post('admin/moderation/submissions/:id/review')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'reviewSubmission' })
  @ApiOkResponse({ standardSchema: SubmissionResponseSchema })
  @SerializeOptions({ schema: SubmissionResponseSchema })
  review(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
    @Body({ schema: ReviewRequestSchema }) input: z.infer<typeof ReviewRequestSchema>,
  ) {
    return this.service.review(request, response, id, input);
  }
  @Post('me/personas/:id/visibility')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOperation({ operationId: 'setOwnPersonaVisibility' })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  visibility(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
    @Body({ schema: VisibilityRequestSchema }) input: z.infer<typeof VisibilityRequestSchema>,
  ) {
    return this.service.visibility(request, response, id, input.visibility, input.reason);
  }
  @Post('me/personas/:id/rollback')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOperation({ operationId: 'selectOwnPublicRelease' })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  rollback(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
    @Body({ schema: RollbackRequestSchema }) input: z.infer<typeof RollbackRequestSchema>,
  ) {
    return this.service.rollback(request, response, id, input.releaseId, input.reason);
  }
  @Post('me/personas/:id/releases/:releaseId/state')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOperation({ operationId: 'changeReleaseState' })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  state(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: ReleasePathSchema }) path: z.infer<typeof ReleasePathSchema>,
    @Body({ schema: ReleaseActionSchema }) input: z.infer<typeof ReleaseActionSchema>,
  ) {
    return this.service.releaseAction(
      request,
      response,
      path.id,
      path.releaseId,
      input.action,
      input.reason,
    );
  }
  @Get('personas')
  @ApiOperation({ operationId: 'listPublicPersonas' })
  @ApiOkResponse({ standardSchema: PublicPersonaListResponseSchema })
  @SerializeOptions({ schema: PublicPersonaListResponseSchema })
  list(
    @Query({ schema: PublicPersonaQuerySchema }) query: z.infer<typeof PublicPersonaQuerySchema>,
  ) {
    return this.service.list(query);
  }
  @Get('personas/:id')
  @ApiOperation({ operationId: 'getPublicPersona' })
  @ApiOkResponse({ standardSchema: PublicReleaseResponseSchema })
  @SerializeOptions({ schema: PublicReleaseResponseSchema })
  current(@Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>) {
    return this.service.current(id);
  }
  @Get('personas/:id/releases')
  @ApiOperation({ operationId: 'getPublicReleaseHistory' })
  @ApiOkResponse({ standardSchema: PublicReleaseListResponseSchema })
  @SerializeOptions({ schema: PublicReleaseListResponseSchema })
  history(
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
    @Query({ schema: PaginationSchema }) query: z.infer<typeof PaginationSchema>,
  ) {
    return this.service.history(id, query.page);
  }
  @Get('personas/:id/releases/:releaseId')
  @ApiOperation({ operationId: 'getPublicRelease' })
  @ApiOkResponse({ standardSchema: PublicReleaseResponseSchema })
  @SerializeOptions({ schema: PublicReleaseResponseSchema })
  release(
    @Param({ schema: ReleasePathSchema }) { id, releaseId }: z.infer<typeof ReleasePathSchema>,
  ) {
    return this.service.release(id, releaseId);
  }
  @Get('public/assets/:id')
  @ApiOperation({ operationId: 'readPublicImage' })
  @ApiOkResponse({ content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } } })
  publicImage(
    @Req() request: Request,
    @Res() response: Response,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
  ) {
    return this.service.image(request, response, id, 'public');
  }
  @Get('moderation/assets/:id')
  @ApiOperation({ operationId: 'readModerationImage' })
  @ApiOkResponse({ content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } } })
  reviewImage(
    @Req() request: Request,
    @Res() response: Response,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
  ) {
    return this.service.image(request, response, id, 'moderation');
  }
}
