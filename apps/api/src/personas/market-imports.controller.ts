import {
  Body,
  Delete,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Query,
  Post,
  Req,
  Res,
  SerializeOptions,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  MarketImportIdSchema,
  MarketImportImageParamsSchema,
  MarketImportPreviewResponseSchema,
  MarketImportImageListResponseSchema,
  MarketImportDiscardResponseSchema,
  MarketImportConfirmSchema,
  DraftResponseSchema,
  ErrorResponseSchema,
  MARKET_ARCHIVE_MAX_BYTES,
  MarketImportFileQuerySchema,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { AuthGuard } from '../auth/auth.guard.js';
import { MarketImportsService } from './market-imports.service.js';
import { MarketImportUploadGuard, MarketImportUploadLease } from './market-import-upload.js';
import { UploadGuard } from '../assets/upload.guard.js';

@ApiTags('imports')
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 413, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 422, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
@UseGuards(AuthGuard)
@Controller('me/market-imports')
export class MarketImportsController {
  constructor(@Inject(MarketImportsService) readonly service: MarketImportsService) {}
  @Post('preview')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @HttpCode(200)
  @UseGuards(MarketImportUploadGuard)
  @UseInterceptors(
    MarketImportUploadLease,
    FileInterceptor('file', {
      limits: { fileSize: MARKET_ARCHIVE_MAX_BYTES, files: 1, fields: 0, parts: 1 },
    }),
  )
  @ApiOperation({ operationId: 'previewMarketPersonaImport' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOkResponse({ standardSchema: MarketImportPreviewResponseSchema })
  @SerializeOptions({ schema: MarketImportPreviewResponseSchema })
  async preview(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query({ schema: MarketImportFileQuerySchema })
    { encoding }: z.infer<typeof MarketImportFileQuerySchema>,
    @UploadedFile() file: unknown,
  ) {
    const parsed = z
      .object({ buffer: z.instanceof(Buffer), originalname: z.string() })
      .safeParse(file);
    if (!parsed.success) throw new BusinessError('INVALID_INPUT', '请选择通用JSON或完整ZIP文件');
    const controller = new AbortController();
    const abort = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.once('close', abort);
    if (request.aborted) controller.abort();
    try {
      return await this.service.preview(
        request,
        parsed.data.buffer,
        parsed.data.originalname,
        controller.signal,
        encoding,
      );
    } finally {
      response.off('close', abort);
    }
  }
  @Get(':id')
  @ApiOperation({ operationId: 'getMarketPersonaImport' })
  @ApiOkResponse({ standardSchema: MarketImportPreviewResponseSchema })
  @SerializeOptions({ schema: MarketImportPreviewResponseSchema })
  read(
    @Req() request: Request,
    @Param({ schema: MarketImportIdSchema }) { id }: z.infer<typeof MarketImportIdSchema>,
  ) {
    return this.service.read(request, id);
  }
  @Post(':id/images/:assetId/import-url')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @HttpCode(200)
  @ApiOperation({ operationId: 'confirmMarketImportImageUrl' })
  @ApiOkResponse({ standardSchema: MarketImportImageListResponseSchema })
  @SerializeOptions({ schema: MarketImportImageListResponseSchema })
  queueImage(
    @Req() request: Request,
    @Param({ schema: MarketImportImageParamsSchema })
    { id, assetId }: z.infer<typeof MarketImportImageParamsSchema>,
  ) {
    return this.service.queueImage(request, id, assetId);
  }
  @Get(':id/images')
  @ApiOperation({ operationId: 'listMarketImportImages' })
  @ApiOkResponse({ standardSchema: MarketImportImageListResponseSchema })
  @SerializeOptions({ schema: MarketImportImageListResponseSchema })
  imageList(
    @Req() request: Request,
    @Param({ schema: MarketImportIdSchema }) { id }: z.infer<typeof MarketImportIdSchema>,
  ) {
    return this.service.imageList(request, id);
  }
  @Get(':id/images/:assetId')
  @ApiOperation({ operationId: 'readMarketImportImage' })
  @ApiOkResponse({ content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } } })
  image(
    @Req() request: Request,
    @Res() response: Response,
    @Param({ schema: MarketImportImageParamsSchema })
    { id, assetId }: z.infer<typeof MarketImportImageParamsSchema>,
  ) {
    return this.service.image(request, response, id, assetId);
  }
  @Post(':id/images/:assetId/upload')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @UseGuards(UploadGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5242880, files: 1, fields: 0, parts: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({ operationId: 'uploadMarketImportImage' })
  @ApiOkResponse({ standardSchema: MarketImportImageListResponseSchema })
  @SerializeOptions({ schema: MarketImportImageListResponseSchema })
  uploadImage(
    @Req() request: Request,
    @Param({ schema: MarketImportImageParamsSchema })
    { id, assetId }: z.infer<typeof MarketImportImageParamsSchema>,
    @UploadedFile() file: unknown,
  ) {
    const parsed = z.object({ buffer: z.instanceof(Buffer) }).safeParse(file);
    if (!parsed.success) throw new BusinessError('INVALID_INPUT', '请选择与清单一致的源图片');
    return this.service.uploadImage(request, id, assetId, parsed.data.buffer);
  }
  @Post('confirm')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @HttpCode(200)
  @ApiOperation({ operationId: 'confirmMarketPersonaImport' })
  @ApiOkResponse({ standardSchema: DraftResponseSchema })
  @SerializeOptions({ schema: DraftResponseSchema })
  confirm(
    @Req() request: Request,
    @Body({ schema: MarketImportConfirmSchema }) input: z.infer<typeof MarketImportConfirmSchema>,
  ) {
    return this.service.confirm(request, input);
  }
  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ operationId: 'discardMarketPersonaImport' })
  @ApiOkResponse({ standardSchema: MarketImportDiscardResponseSchema })
  @SerializeOptions({ schema: MarketImportDiscardResponseSchema })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  discard(
    @Req() request: Request,
    @Param({ schema: MarketImportIdSchema }) { id }: z.infer<typeof MarketImportIdSchema>,
  ) {
    return this.service.discard(request, id);
  }
}
