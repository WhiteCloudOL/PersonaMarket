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
  AnnouncementIdSchema,
  AnnouncementSitemapResponseSchema,
  AnnouncementActionParamsSchema,
  AnnouncementWriteSchema,
  AnnouncementActionSchema,
  AdminAnnouncementsQuerySchema,
  AnnouncementRecordsQuerySchema,
  PublicAnnouncementsQuerySchema,
  PublicAnnouncementResponseSchema,
  PublicAnnouncementsResponseSchema,
  AdminAnnouncementResponseSchema,
  AdminAnnouncementsResponseSchema,
  AnnouncementRecordsResponseSchema,
  ErrorResponseSchema,
  announcementEtag,
} from '@personamarket/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { AnnouncementsService } from './announcements.service.js';

@Controller('announcements')
@ApiTags('announcements')
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class AnnouncementsController {
  constructor(@Inject(AnnouncementsService) readonly service: AnnouncementsService) {}
  @Get()
  @ApiOperation({ operationId: 'listPublicAnnouncements' })
  @ApiOkResponse({ standardSchema: PublicAnnouncementsResponseSchema })
  @SerializeOptions({ schema: PublicAnnouncementsResponseSchema })
  list(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query({ schema: PublicAnnouncementsQuerySchema })
    input: z.infer<typeof PublicAnnouncementsQuerySchema>,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.service.listPublic(request, input);
  }
  @Get(':id')
  @ApiOperation({ operationId: 'getPublicAnnouncement' })
  @ApiOkResponse({ standardSchema: PublicAnnouncementResponseSchema })
  @SerializeOptions({ schema: PublicAnnouncementResponseSchema })
  read(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: AnnouncementIdSchema }) input: z.infer<typeof AnnouncementIdSchema>,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.service.readPublic(request, input.id);
  }
}

@Controller('site/announcement-sitemap')
@ApiTags('announcements')
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class AnnouncementSitemapController {
  constructor(@Inject(AnnouncementsService) readonly service: AnnouncementsService) {}
  @Get()
  @ApiOperation({ operationId: 'getAnnouncementSitemap' })
  @ApiOkResponse({ standardSchema: AnnouncementSitemapResponseSchema })
  @SerializeOptions({ schema: AnnouncementSitemapResponseSchema })
  sitemap(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.service.sitemap(request);
  }
}

@Controller('admin/announcements')
@UseGuards(AuthGuard)
@ApiTags('announcement-management')
@ApiHeader({
  name: 'X-Expected-Account',
  required: false,
  description: '仅核对实际登录账号，不授予权限',
})
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class AdminAnnouncementsController {
  constructor(@Inject(AnnouncementsService) readonly service: AnnouncementsService) {}
  private async reply(response: Response, result: ReturnType<AnnouncementsService['create']>) {
    const body = await result;
    response.setHeader('ETag', announcementEtag(body.data.id, body.data.revision));
    response.setHeader('Cache-Control', 'no-store');
    return body;
  }
  @Get()
  @ApiOperation({ operationId: 'listAdminAnnouncements' })
  @ApiOkResponse({ standardSchema: AdminAnnouncementsResponseSchema })
  @SerializeOptions({ schema: AdminAnnouncementsResponseSchema })
  list(
    @Req() request: Request,
    @Query({ schema: AdminAnnouncementsQuerySchema })
    input: z.infer<typeof AdminAnnouncementsQuerySchema>,
  ) {
    return this.service.list(request, input);
  }
  @Get(':id')
  @ApiOperation({ operationId: 'getAdminAnnouncement' })
  @ApiOkResponse({ standardSchema: AdminAnnouncementResponseSchema })
  @SerializeOptions({ schema: AdminAnnouncementResponseSchema })
  read(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: AnnouncementIdSchema }) input: z.infer<typeof AnnouncementIdSchema>,
  ) {
    return this.reply(response, this.service.detail(request, input.id));
  }
  @Get(':id/records')
  @ApiOperation({ operationId: 'getAdminAnnouncementRecords' })
  @ApiOkResponse({ standardSchema: AnnouncementRecordsResponseSchema })
  @SerializeOptions({ schema: AnnouncementRecordsResponseSchema })
  records(
    @Req() request: Request,
    @Param({ schema: AnnouncementIdSchema }) input: z.infer<typeof AnnouncementIdSchema>,
    @Query({ schema: AnnouncementRecordsQuerySchema })
    query: z.infer<typeof AnnouncementRecordsQuerySchema>,
  ) {
    return this.service.records(request, input.id, query);
  }
  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: 'createAdminAnnouncement' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminAnnouncementResponseSchema })
  @SerializeOptions({ schema: AdminAnnouncementResponseSchema })
  create(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body({ schema: AnnouncementWriteSchema }) input: z.infer<typeof AnnouncementWriteSchema>,
  ) {
    return this.reply(response, this.service.create(request, response, input));
  }
  @Patch(':id')
  @ApiOperation({ operationId: 'updateAdminAnnouncement' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOkResponse({ standardSchema: AdminAnnouncementResponseSchema })
  @SerializeOptions({ schema: AdminAnnouncementResponseSchema })
  update(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: AnnouncementIdSchema }) target: z.infer<typeof AnnouncementIdSchema>,
    @Body({ schema: AnnouncementWriteSchema }) input: z.infer<typeof AnnouncementWriteSchema>,
  ) {
    return this.reply(response, this.service.edit(request, response, target.id, input));
  }
  @Post(':id/:action')
  @HttpCode(200)
  @ApiOperation({ operationId: 'changeAdminAnnouncementState' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOkResponse({ standardSchema: AdminAnnouncementResponseSchema })
  @SerializeOptions({ schema: AdminAnnouncementResponseSchema })
  action(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: AnnouncementActionParamsSchema })
    target: z.infer<typeof AnnouncementActionParamsSchema>,
    @Body({ schema: AnnouncementActionSchema }) input: z.infer<typeof AnnouncementActionSchema>,
  ) {
    return this.reply(
      response,
      this.service.action(request, response, target.id, target.action, input),
    );
  }
}
