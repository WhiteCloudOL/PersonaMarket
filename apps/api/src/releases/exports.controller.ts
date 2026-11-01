import { Controller, Get, Inject, Param, Query, Req, Res, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ReleasePathSchema,
  ExportQuerySchema,
  ExportPreviewResponseSchema,
  ErrorResponseSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import type { Request, Response } from 'express';
import { ExportsService } from './exports.service.js';
@ApiTags('exports')
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 422, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@Controller('personas/:id/releases/:releaseId')
export class ExportsController {
  constructor(@Inject(ExportsService) readonly service: ExportsService) {}
  @Get('export-preview')
  @ApiOperation({ operationId: 'previewPublicExport' })
  @ApiOkResponse({ standardSchema: ExportPreviewResponseSchema })
  @SerializeOptions({ schema: ExportPreviewResponseSchema })
  preview(
    @Req() request: Request,
    @Param({ schema: ReleasePathSchema }) { id, releaseId }: z.infer<typeof ReleasePathSchema>,
    @Query({ schema: ExportQuerySchema }) { format }: z.infer<typeof ExportQuerySchema>,
  ) {
    return this.service.prepare(request, id, releaseId, format);
  }
  @Get('export')
  @ApiOperation({ operationId: 'downloadPublicExport' })
  @ApiOkResponse({
    content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
  })
  download(
    @Req() request: Request,
    @Res() response: Response,
    @Param({ schema: ReleasePathSchema }) { id, releaseId }: z.infer<typeof ReleasePathSchema>,
    @Query({ schema: ExportQuerySchema }) { format }: z.infer<typeof ExportQuerySchema>,
  ) {
    return this.service.download(request, response, id, releaseId, format);
  }
}
