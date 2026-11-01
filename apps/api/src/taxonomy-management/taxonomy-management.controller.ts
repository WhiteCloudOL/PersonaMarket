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
  type Type,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CreateTaxonomyEntrySchema,
  ErrorResponseSchema,
  TaxonomyActionSchema,
  TaxonomyEntryIdSchema,
  TaxonomyManagementDetailResponseSchema,
  TaxonomyManagementListResponseSchema,
  TaxonomyManagementPaginationSchema,
  TaxonomyManagementQuerySchema,
  TaxonomyManagementRecordsResponseSchema,
  UpdateTaxonomyEntrySchema,
  taxonomyEntryEtag,
  type TaxonomyKind,
} from '@personamarket/contracts';
import type { z } from 'zod';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { TaxonomyManagementService } from './taxonomy-management.service.js';

// 两类目录使用相同契约和权限，注册独立REST路径及唯一OpenAPI operationId
function taxonomyController(
  kind: TaxonomyKind,
  path: string,
  singular: string,
  plural: string,
): Type<unknown> {
  @Controller(path)
  @ApiTags('taxonomy-management')
  @UseGuards(AuthGuard)
  @ApiHeader({
    name: 'X-Expected-Account',
    required: false,
    description: '仅核对实际会话，不授予身份或权限',
  })
  @ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
  @ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
  @ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
  @ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
  @ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
  @ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
  @ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
  @ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
  class TaxonomyController {
    constructor(@Inject(TaxonomyManagementService) readonly service: TaxonomyManagementService) {}
    private reply(
      response: Response,
      result: z.infer<typeof TaxonomyManagementDetailResponseSchema>,
    ) {
      response.setHeader('ETag', taxonomyEntryEtag(kind, result.data.id, result.data.revision));
      return result;
    }
    @Get()
    @ApiOperation({ operationId: 'listAdmin' + plural })
    @ApiOkResponse({ standardSchema: TaxonomyManagementListResponseSchema })
    @SerializeOptions({ schema: TaxonomyManagementListResponseSchema })
    list(
      @Req() request: Request,
      @Query({ schema: TaxonomyManagementQuerySchema })
      input: z.infer<typeof TaxonomyManagementQuerySchema>,
    ) {
      return this.service.list(request, kind, input);
    }
    @Get(':id')
    @ApiOperation({ operationId: 'getAdmin' + singular })
    @ApiOkResponse({ standardSchema: TaxonomyManagementDetailResponseSchema })
    @SerializeOptions({ schema: TaxonomyManagementDetailResponseSchema })
    async detail(
      @Req() request: Request,
      @Res({ passthrough: true }) response: Response,
      @Param({ schema: TaxonomyEntryIdSchema }) { id }: z.infer<typeof TaxonomyEntryIdSchema>,
    ) {
      return this.reply(response, await this.service.detail(request, kind, id));
    }
    @Get(':id/records')
    @ApiOperation({ operationId: 'getAdmin' + singular + 'Records' })
    @ApiOkResponse({ standardSchema: TaxonomyManagementRecordsResponseSchema })
    @SerializeOptions({ schema: TaxonomyManagementRecordsResponseSchema })
    records(
      @Req() request: Request,
      @Param({ schema: TaxonomyEntryIdSchema }) { id }: z.infer<typeof TaxonomyEntryIdSchema>,
      @Query({ schema: TaxonomyManagementPaginationSchema })
      input: z.infer<typeof TaxonomyManagementPaginationSchema>,
    ) {
      return this.service.records(request, kind, id, input);
    }
    @Post()
    @HttpCode(200)
    @ApiOperation({ operationId: 'createAdmin' + singular })
    @ApiHeader({ name: 'X-CSRF-Token', required: true })
    @ApiHeader({ name: 'Idempotency-Key', required: true })
    @ApiOkResponse({ standardSchema: TaxonomyManagementDetailResponseSchema })
    @SerializeOptions({ schema: TaxonomyManagementDetailResponseSchema })
    async create(
      @Req() request: Request,
      @Res({ passthrough: true }) response: Response,
      @Body({ schema: CreateTaxonomyEntrySchema }) input: z.infer<typeof CreateTaxonomyEntrySchema>,
    ) {
      return this.reply(response, await this.service.create(request, response, kind, input));
    }
    @Patch(':id')
    @ApiOperation({ operationId: 'updateAdmin' + singular })
    @ApiHeader({ name: 'X-CSRF-Token', required: true })
    @ApiHeader({ name: 'If-Match', required: true })
    @ApiHeader({ name: 'Idempotency-Key', required: true })
    @ApiOkResponse({ standardSchema: TaxonomyManagementDetailResponseSchema })
    @SerializeOptions({ schema: TaxonomyManagementDetailResponseSchema })
    async update(
      @Req() request: Request,
      @Res({ passthrough: true }) response: Response,
      @Param({ schema: TaxonomyEntryIdSchema }) { id }: z.infer<typeof TaxonomyEntryIdSchema>,
      @Body({ schema: UpdateTaxonomyEntrySchema }) input: z.infer<typeof UpdateTaxonomyEntrySchema>,
    ) {
      return this.reply(response, await this.service.update(request, response, kind, id, input));
    }
    @Delete(':id')
    @HttpCode(200)
    @ApiOperation({ operationId: 'archiveAdmin' + singular })
    @ApiHeader({ name: 'X-CSRF-Token', required: true })
    @ApiHeader({ name: 'If-Match', required: true })
    @ApiHeader({ name: 'Idempotency-Key', required: true })
    @ApiOkResponse({ standardSchema: TaxonomyManagementDetailResponseSchema })
    @SerializeOptions({ schema: TaxonomyManagementDetailResponseSchema })
    async archive(
      @Req() request: Request,
      @Res({ passthrough: true }) response: Response,
      @Param({ schema: TaxonomyEntryIdSchema }) { id }: z.infer<typeof TaxonomyEntryIdSchema>,
      @Body({ schema: TaxonomyActionSchema }) input: z.infer<typeof TaxonomyActionSchema>,
    ) {
      return this.reply(
        response,
        await this.service.action(request, response, kind, id, 'archived', input),
      );
    }
    @Post(':id/restore')
    @HttpCode(200)
    @ApiOperation({ operationId: 'restoreAdmin' + singular })
    @ApiHeader({ name: 'X-CSRF-Token', required: true })
    @ApiHeader({ name: 'If-Match', required: true })
    @ApiHeader({ name: 'Idempotency-Key', required: true })
    @ApiOkResponse({ standardSchema: TaxonomyManagementDetailResponseSchema })
    @SerializeOptions({ schema: TaxonomyManagementDetailResponseSchema })
    async restore(
      @Req() request: Request,
      @Res({ passthrough: true }) response: Response,
      @Param({ schema: TaxonomyEntryIdSchema }) { id }: z.infer<typeof TaxonomyEntryIdSchema>,
      @Body({ schema: TaxonomyActionSchema }) input: z.infer<typeof TaxonomyActionSchema>,
    ) {
      return this.reply(
        response,
        await this.service.action(request, response, kind, id, 'restored', input),
      );
    }
  }
  return TaxonomyController;
}

export const AdminCategoriesController = taxonomyController(
  'category',
  'admin/categories',
  'Category',
  'Categories',
);
export const AdminTagsController = taxonomyController('tag', 'admin/tags', 'Tag', 'Tags');
