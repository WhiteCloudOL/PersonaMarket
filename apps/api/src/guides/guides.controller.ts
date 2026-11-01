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
  PublicGuidesResponseSchema,
  PublicGuideResponseSchema,
  GuideSitemapResponseSchema,
  GuideParamsSchema,
  GuideWriteSchema,
  GuideActionParamsSchema,
  GuideActionSchema,
  AdminGuidesQuerySchema,
  AdminGuidesResponseSchema,
  AdminGuideResponseSchema,
  GuideRecordsQuerySchema,
  GuideRecordsResponseSchema,
  ErrorResponseSchema,
  guideEtag,
} from '@personamarket/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { GuidesService } from './guides.service.js';

@Controller('site/guides')
@ApiTags('guides')
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class PublicGuidesController {
  constructor(@Inject(GuidesService) readonly service: GuidesService) {}
  @Get()
  @ApiOperation({ operationId: 'getPublicGuides' })
  @ApiOkResponse({ standardSchema: PublicGuidesResponseSchema })
  @SerializeOptions({ schema: PublicGuidesResponseSchema })
  list(@Req() request: Request) {
    return this.service.publicList(request);
  }
  @Get(':slug')
  @ApiOperation({ operationId: 'getPublicGuide' })
  @ApiOkResponse({ standardSchema: PublicGuideResponseSchema })
  @ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
  @SerializeOptions({ schema: PublicGuideResponseSchema })
  read(
    @Req() request: Request,
    @Param({ schema: GuideParamsSchema }) { slug }: z.infer<typeof GuideParamsSchema>,
  ) {
    return this.service.publicDetail(request, slug);
  }
}
@Controller('site/guide-sitemap')
@ApiTags('guides')
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class GuideSitemapController {
  constructor(@Inject(GuidesService) readonly service: GuidesService) {}
  @Get()
  @ApiOperation({ operationId: 'getGuideSitemap' })
  @ApiOkResponse({ standardSchema: GuideSitemapResponseSchema })
  @SerializeOptions({ schema: GuideSitemapResponseSchema })
  read(@Req() request: Request) {
    return this.service.sitemap(request);
  }
}

@Controller('admin/guides')
@UseGuards(AuthGuard)
@ApiTags('guide-management')
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
export class AdminGuidesController {
  constructor(@Inject(GuidesService) readonly service: GuidesService) {}
  private async reply(response: Response, result: ReturnType<GuidesService['read']>) {
    const body = await result;
    response.setHeader('ETag', guideEtag(body.data.slug, body.data.revision));
    return body;
  }
  @Get()
  @ApiOperation({ operationId: 'listAdminGuides' })
  @ApiOkResponse({ standardSchema: AdminGuidesResponseSchema })
  @SerializeOptions({ schema: AdminGuidesResponseSchema })
  list(
    @Req() request: Request,
    @Query({ schema: AdminGuidesQuerySchema }) input: z.infer<typeof AdminGuidesQuerySchema>,
  ) {
    return this.service.list(request, input);
  }
  @Get(':slug')
  @ApiOperation({ operationId: 'getAdminGuide' })
  @ApiOkResponse({ standardSchema: AdminGuideResponseSchema })
  @SerializeOptions({ schema: AdminGuideResponseSchema })
  read(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: GuideParamsSchema }) { slug }: z.infer<typeof GuideParamsSchema>,
  ) {
    return this.reply(response, this.service.read(request, slug));
  }
  @Get(':slug/records')
  @ApiOperation({ operationId: 'getGuideRecords' })
  @ApiOkResponse({ standardSchema: GuideRecordsResponseSchema })
  @SerializeOptions({ schema: GuideRecordsResponseSchema })
  records(
    @Req() request: Request,
    @Param({ schema: GuideParamsSchema }) { slug }: z.infer<typeof GuideParamsSchema>,
    @Query({ schema: GuideRecordsQuerySchema }) input: z.infer<typeof GuideRecordsQuerySchema>,
  ) {
    return this.service.records(request, slug, input);
  }
  @Patch(':slug')
  @ApiOperation({ operationId: 'updateAdminGuide' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminGuideResponseSchema })
  @SerializeOptions({ schema: AdminGuideResponseSchema })
  update(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: GuideParamsSchema }) { slug }: z.infer<typeof GuideParamsSchema>,
    @Body({ schema: GuideWriteSchema }) input: z.infer<typeof GuideWriteSchema>,
  ) {
    return this.reply(response, this.service.update(request, response, slug, input));
  }
  @Post(':slug/actions/:action')
  @HttpCode(200)
  @ApiOperation({ operationId: 'changeAdminGuideState' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminGuideResponseSchema })
  @SerializeOptions({ schema: AdminGuideResponseSchema })
  action(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: GuideActionParamsSchema })
    { slug, action }: z.infer<typeof GuideActionParamsSchema>,
    @Body({ schema: GuideActionSchema }) input: z.infer<typeof GuideActionSchema>,
  ) {
    return this.reply(response, this.service.action(request, response, slug, action, input));
  }
}
