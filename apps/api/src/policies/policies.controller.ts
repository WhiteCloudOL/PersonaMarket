import {
  Body,
  Controller,
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
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  PublicPoliciesResponseSchema,
  PublicPolicyResponseSchema,
  PolicyParamsSchema,
  PolicyReadQuerySchema,
  PolicySubmissionParamsSchema,
  PolicyWriteSchema,
  SubmitPolicySchema,
  WithdrawPolicySchema,
  ReviewPolicySchema,
  UnpublishPolicySchema,
  ActivatePolicySchema,
  AdminPoliciesResponseSchema,
  AdminPolicyResponseSchema,
  PolicySubmissionsQuerySchema,
  PolicySubmissionsResponseSchema,
  PolicySubmissionResponseSchema,
  PolicyRecordsQuerySchema,
  PolicyRecordsResponseSchema,
  PolicyRecordResponseSchema,
  ErrorResponseSchema,
  policyEtag,
  type PolicySlug,
} from '@personamarket/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { PoliciesService } from './policies.service.js';

@Controller('policies')
@ApiTags('policies')
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class PublicPoliciesController {
  constructor(@Inject(PoliciesService) readonly service: PoliciesService) {}

  @Get()
  @ApiOperation({ operationId: 'getPublicPolicies' })
  @ApiOkResponse({ standardSchema: PublicPoliciesResponseSchema })
  @SerializeOptions({ schema: PublicPoliciesResponseSchema })
  list(@Req() request: Request) {
    return this.service.publicList(request);
  }

  @Get(':slug')
  @ApiOperation({ operationId: 'getPublicPolicy' })
  @ApiOkResponse({ standardSchema: PublicPolicyResponseSchema })
  @ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
  @SerializeOptions({ schema: PublicPolicyResponseSchema })
  read(
    @Req() request: Request,
    @Param({ schema: PolicyParamsSchema }) { slug }: z.infer<typeof PolicyParamsSchema>,
    @Query({ schema: PolicyReadQuerySchema }) input: z.infer<typeof PolicyReadQuerySchema>,
  ) {
    return this.service.publicRead(request, slug, input);
  }
}

@Controller('admin/settings/policies')
@UseGuards(AuthGuard)
@ApiTags('policy-management')
@ApiHeader({
  name: 'X-Expected-Account',
  required: false,
  description: '仅核对实际账号，不授予权限',
})
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class AdminPoliciesController {
  constructor(@Inject(PoliciesService) readonly service: PoliciesService) {}

  private async reply(response: Response, result: ReturnType<PoliciesService['read']>) {
    const body = await result;
    response.setHeader('ETag', policyEtag(body.data.slug, body.data.revision));
    return body;
  }

  private async revisionReply<T extends { meta: { revision: number } }>(
    response: Response,
    slug: PolicySlug,
    result: Promise<T>,
  ) {
    const body = await result;
    response.setHeader('ETag', policyEtag(slug, body.meta.revision));
    return body;
  }

  @Get()
  @ApiOperation({ operationId: 'listAdminPolicies' })
  @ApiOkResponse({ standardSchema: AdminPoliciesResponseSchema })
  @SerializeOptions({ schema: AdminPoliciesResponseSchema })
  list(@Req() request: Request) {
    return this.service.list(request);
  }

  @Get(':slug')
  @ApiOperation({ operationId: 'getAdminPolicy' })
  @ApiOkResponse({ standardSchema: AdminPolicyResponseSchema })
  @SerializeOptions({ schema: AdminPolicyResponseSchema })
  read(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: PolicyParamsSchema }) { slug }: z.infer<typeof PolicyParamsSchema>,
  ) {
    return this.reply(response, this.service.read(request, slug));
  }

  @Patch(':slug')
  @ApiOperation({ operationId: 'updatePolicyDraft' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminPolicyResponseSchema })
  @SerializeOptions({ schema: AdminPolicyResponseSchema })
  write(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: PolicyParamsSchema }) { slug }: z.infer<typeof PolicyParamsSchema>,
    @Body({ schema: PolicyWriteSchema }) input: z.infer<typeof PolicyWriteSchema>,
  ) {
    return this.reply(response, this.service.write(request, response, slug, input));
  }

  @Post(':slug/submissions')
  @HttpCode(200)
  @ApiOperation({ operationId: 'submitPolicy' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminPolicyResponseSchema })
  @SerializeOptions({ schema: AdminPolicyResponseSchema })
  submit(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: PolicyParamsSchema }) { slug }: z.infer<typeof PolicyParamsSchema>,
    @Body({ schema: SubmitPolicySchema }) input: z.infer<typeof SubmitPolicySchema>,
  ) {
    return this.reply(response, this.service.submit(request, response, slug, input));
  }

  @Get(':slug/submissions')
  @ApiOperation({ operationId: 'getPolicySubmissions' })
  @ApiOkResponse({ standardSchema: PolicySubmissionsResponseSchema })
  @SerializeOptions({ schema: PolicySubmissionsResponseSchema })
  submissions(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: PolicyParamsSchema }) { slug }: z.infer<typeof PolicyParamsSchema>,
    @Query({ schema: PolicySubmissionsQuerySchema })
    input: z.infer<typeof PolicySubmissionsQuerySchema>,
  ) {
    return this.revisionReply(response, slug, this.service.submissions(request, slug, input));
  }

  @Get(':slug/submissions/:id')
  @ApiOperation({ operationId: 'getPolicySubmission' })
  @ApiOkResponse({ standardSchema: PolicySubmissionResponseSchema })
  @SerializeOptions({ schema: PolicySubmissionResponseSchema })
  submission(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: PolicySubmissionParamsSchema })
    { slug, id }: z.infer<typeof PolicySubmissionParamsSchema>,
  ) {
    return this.revisionReply(response, slug, this.service.submission(request, slug, id));
  }

  @Post(':slug/submissions/:id/withdraw')
  @HttpCode(200)
  @ApiOperation({ operationId: 'withdrawPolicySubmission' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminPolicyResponseSchema })
  @SerializeOptions({ schema: AdminPolicyResponseSchema })
  withdraw(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: PolicySubmissionParamsSchema })
    { slug, id }: z.infer<typeof PolicySubmissionParamsSchema>,
    @Body({ schema: WithdrawPolicySchema }) input: z.infer<typeof WithdrawPolicySchema>,
  ) {
    return this.reply(response, this.service.withdraw(request, response, slug, id, input));
  }

  @Post(':slug/submissions/:id/review')
  @HttpCode(200)
  @ApiOperation({ operationId: 'reviewPolicySubmission' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminPolicyResponseSchema })
  @SerializeOptions({ schema: AdminPolicyResponseSchema })
  review(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: PolicySubmissionParamsSchema })
    { slug, id }: z.infer<typeof PolicySubmissionParamsSchema>,
    @Body({ schema: ReviewPolicySchema }) input: z.infer<typeof ReviewPolicySchema>,
  ) {
    return this.reply(response, this.service.review(request, response, slug, id, input));
  }

  @Post(':slug/actions/unpublish')
  @HttpCode(200)
  @ApiOperation({ operationId: 'unpublishPolicy' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminPolicyResponseSchema })
  @SerializeOptions({ schema: AdminPolicyResponseSchema })
  unpublish(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: PolicyParamsSchema }) { slug }: z.infer<typeof PolicyParamsSchema>,
    @Body({ schema: UnpublishPolicySchema }) input: z.infer<typeof UnpublishPolicySchema>,
  ) {
    return this.reply(response, this.service.unpublish(request, response, slug, input));
  }

  @Post(':slug/actions/activate')
  @HttpCode(200)
  @ApiOperation({ operationId: 'activatePolicy' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminPolicyResponseSchema })
  @SerializeOptions({ schema: AdminPolicyResponseSchema })
  activate(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: PolicyParamsSchema }) { slug }: z.infer<typeof PolicyParamsSchema>,
    @Body({ schema: ActivatePolicySchema }) input: z.infer<typeof ActivatePolicySchema>,
  ) {
    return this.reply(response, this.service.activate(request, response, slug, input));
  }

  @Get(':slug/records')
  @ApiOperation({ operationId: 'getPolicyRecords' })
  @ApiOkResponse({ standardSchema: PolicyRecordsResponseSchema })
  @SerializeOptions({ schema: PolicyRecordsResponseSchema })
  records(
    @Req() request: Request,
    @Param({ schema: PolicyParamsSchema }) { slug }: z.infer<typeof PolicyParamsSchema>,
    @Query({ schema: PolicyRecordsQuerySchema })
    input: z.infer<typeof PolicyRecordsQuerySchema>,
  ) {
    return this.service.records(request, slug, input);
  }

  @Get(':slug/records/:id')
  @ApiOperation({ operationId: 'getPolicyRecord' })
  @ApiOkResponse({ standardSchema: PolicyRecordResponseSchema })
  @SerializeOptions({ schema: PolicyRecordResponseSchema })
  record(
    @Req() request: Request,
    @Param({ schema: PolicySubmissionParamsSchema })
    { slug, id }: z.infer<typeof PolicySubmissionParamsSchema>,
  ) {
    return this.service.record(request, slug, id);
  }
}
