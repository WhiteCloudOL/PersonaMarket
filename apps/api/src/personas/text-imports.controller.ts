import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
  PayloadTooLargeException,
  Req,
  Res,
  Query,
  SerializeOptions,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiHeader,
  ApiOperation,
  ApiOkResponse,
  ApiResponse,
  ApiBody,
  ApiConsumes,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { Request, Response } from 'express';
import {
  IMPORT_TEXT_MAX_BYTES,
  TextImportFileQuerySchema,
  TextImportSourceResponseSchema,
  TextMappedPreviewRequestSchema,
  ImportPreviewResponseSchema,
  ErrorResponseSchema,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { AuthGuard } from '../auth/auth.guard.js';
import { ImportsService } from './imports.service.js';
import { TextImportUploadGuard } from './text-import-upload.guard.js';
import { MarketImportUploadLease } from './market-import-upload.js';

@ApiTags('imports')
@ApiHeader({ name: 'X-CSRF-Token', required: true })
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 413, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 422, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
@UseGuards(AuthGuard)
@Controller('me/persona-imports/text')
export class TextImportsController {
  constructor(@Inject(ImportsService) readonly service: ImportsService) {}
  @Post('source/file')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(TextImportUploadGuard)
  @UseInterceptors(
    MarketImportUploadLease,
    FileInterceptor('file', {
      limits: { fileSize: IMPORT_TEXT_MAX_BYTES + 1, files: 1, fields: 0, parts: 1 },
    }),
  )
  @ApiOperation({ operationId: 'readPersonaTextFile' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '最大4MiB的TXT或Markdown，仅返回私有原文供手动映射',
        },
      },
      required: ['file'],
    },
  })
  @ApiOkResponse({ standardSchema: TextImportSourceResponseSchema })
  @SerializeOptions({ schema: TextImportSourceResponseSchema })
  async source(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query({ schema: TextImportFileQuerySchema }) query: z.infer<typeof TextImportFileQuerySchema>,
    @UploadedFile() file: unknown,
  ) {
    const parsed = z
      .object({ buffer: z.instanceof(Buffer), originalname: z.string() })
      .safeParse(file);
    if (!parsed.success) throw new BusinessError('INVALID_INPUT', '请选择纯文本或 Markdown 文件');
    if (parsed.data.buffer.byteLength > IMPORT_TEXT_MAX_BYTES) throw new PayloadTooLargeException();
    const controller = new AbortController();
    const abort = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.once('close', abort);
    if (request.aborted) controller.abort();
    try {
      return await this.service.textSource(
        request,
        parsed.data.buffer,
        parsed.data.originalname,
        query,
        controller.signal,
      );
    } finally {
      response.off('close', abort);
    }
  }
  @Post('preview')
  @HttpCode(200)
  @ApiOperation({ operationId: 'previewMappedPersonaImport' })
  @ApiOkResponse({ standardSchema: ImportPreviewResponseSchema })
  @SerializeOptions({ schema: ImportPreviewResponseSchema })
  preview(
    @Req() request: Request,
    @Body({ schema: TextMappedPreviewRequestSchema })
    input: z.infer<typeof TextMappedPreviewRequestSchema>,
  ) {
    return this.service.previewMappedText(request, input);
  }
}
