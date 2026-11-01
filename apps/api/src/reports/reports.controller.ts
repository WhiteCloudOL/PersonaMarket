import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  CreateReportSchema,
  ReportIdSchema,
  OwnReportsQuerySchema,
  AdminReportsQuerySchema,
  ReportRecordsQuerySchema,
  AdminReportActionSchema,
  OwnReportResponseSchema,
  OwnReportsResponseSchema,
  OwnReportRecordsResponseSchema,
  AdminReportResponseSchema,
  AdminReportsResponseSchema,
  AdminReportRecordsResponseSchema,
  ErrorResponseSchema,
  reportEtag,
  type CreateReport,
  type OwnReportsQuery,
  type AdminReportsQuery,
  type ReportRecordsQuery,
  type AdminReportAction,
} from '@personamarket/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { ReportsService } from './reports.service.js';

@Controller('reports')
@UseGuards(AuthGuard)
@ApiTags('reports')
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class ReportsController {
  constructor(@Inject(ReportsService) readonly service: ReportsService) {}
  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: 'createReport' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'X-Expected-Account', required: false })
  @ApiOkResponse({ standardSchema: OwnReportResponseSchema })
  @SerializeOptions({ schema: OwnReportResponseSchema })
  create(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body({ schema: CreateReportSchema }) input: CreateReport,
  ) {
    return this.service.create(request, response, input);
  }
}

@Controller('me/reports')
@UseGuards(AuthGuard)
@ApiTags('own-reports')
@ApiHeader({ name: 'X-Expected-Account', required: false })
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class OwnReportsController {
  constructor(@Inject(ReportsService) readonly service: ReportsService) {}
  @Get(':id/avatar')
  @ApiOperation({ operationId: 'getOwnReportAvatar' })
  @ApiOkResponse({
    description: '私有头像举报证据',
    content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
  })
  avatar(
    @Req() request: Request,
    @Res() response: Response,
    @Param({ schema: ReportIdSchema }) { id }: { id: string },
  ) {
    return this.service.avatar(request, response, id, false);
  }
  @Get()
  @ApiOperation({ operationId: 'listOwnReports' })
  @ApiOkResponse({ standardSchema: OwnReportsResponseSchema })
  @SerializeOptions({ schema: OwnReportsResponseSchema })
  list(@Req() request: Request, @Query({ schema: OwnReportsQuerySchema }) input: OwnReportsQuery) {
    return this.service.ownList(request, input);
  }
  @Get(':id')
  @ApiOperation({ operationId: 'getOwnReport' })
  @ApiOkResponse({ standardSchema: OwnReportResponseSchema })
  @SerializeOptions({ schema: OwnReportResponseSchema })
  read(@Req() request: Request, @Param({ schema: ReportIdSchema }) { id }: { id: string }) {
    return this.service.own(request, id);
  }
  @Get(':id/records')
  @ApiOperation({ operationId: 'getOwnReportRecords' })
  @ApiOkResponse({ standardSchema: OwnReportRecordsResponseSchema })
  @SerializeOptions({ schema: OwnReportRecordsResponseSchema })
  records(
    @Req() request: Request,
    @Param({ schema: ReportIdSchema }) { id }: { id: string },
    @Query({ schema: ReportRecordsQuerySchema }) input: ReportRecordsQuery,
  ) {
    return this.service.ownRecords(request, id, input);
  }
}

@Controller('admin/reports')
@UseGuards(AuthGuard)
@ApiTags('report-management')
@ApiHeader({ name: 'X-Expected-Account', required: false })
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class AdminReportsController {
  constructor(@Inject(ReportsService) readonly service: ReportsService) {}
  @Get(':id/avatar')
  @ApiOperation({ operationId: 'getAdminReportAvatar' })
  @ApiOkResponse({
    description: '私有头像举报证据',
    content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
  })
  avatar(
    @Req() request: Request,
    @Res() response: Response,
    @Param({ schema: ReportIdSchema }) { id }: { id: string },
  ) {
    return this.service.avatar(request, response, id, true);
  }
  private async reply<T extends { data: { id: string; revision: number } }>(
    response: Response,
    task: Promise<T>,
  ) {
    const result = await task;
    response.setHeader('ETag', reportEtag(result.data.id, result.data.revision));
    return result;
  }
  @Get()
  @ApiOperation({ operationId: 'listAdminReports' })
  @ApiOkResponse({ standardSchema: AdminReportsResponseSchema })
  @SerializeOptions({ schema: AdminReportsResponseSchema })
  list(
    @Req() request: Request,
    @Query({ schema: AdminReportsQuerySchema }) input: AdminReportsQuery,
  ) {
    return this.service.adminList(request, input);
  }
  @Get(':id')
  @ApiOperation({ operationId: 'getAdminReport' })
  @ApiOkResponse({ standardSchema: AdminReportResponseSchema })
  @SerializeOptions({ schema: AdminReportResponseSchema })
  read(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: ReportIdSchema }) { id }: { id: string },
  ) {
    return this.reply(response, this.service.admin(request, id));
  }
  @Get(':id/records')
  @ApiOperation({ operationId: 'getAdminReportRecords' })
  @ApiOkResponse({ standardSchema: AdminReportRecordsResponseSchema })
  @SerializeOptions({ schema: AdminReportRecordsResponseSchema })
  records(
    @Req() request: Request,
    @Param({ schema: ReportIdSchema }) { id }: { id: string },
    @Query({ schema: ReportRecordsQuerySchema }) input: ReportRecordsQuery,
  ) {
    return this.service.adminRecords(request, id, input);
  }
  @Post(':id/actions')
  @HttpCode(200)
  @ApiOperation({ operationId: 'processReport' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminReportResponseSchema })
  @SerializeOptions({ schema: AdminReportResponseSchema })
  act(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: ReportIdSchema }) { id }: { id: string },
    @Body({ schema: AdminReportActionSchema }) input: AdminReportAction,
  ) {
    return this.reply(response, this.service.act(request, response, id, input));
  }
}
