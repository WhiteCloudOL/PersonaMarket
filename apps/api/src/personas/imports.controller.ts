import {
  Body,
  Controller,
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
import {
  ImportPreviewRequestSchema,
  ImportPreviewResponseSchema,
  ImportConfirmRequestSchema,
  DraftResponseSchema,
  ErrorResponseSchema,
  NativeImportFileQuerySchema,
  NATIVE_IMPORT_MAX_BYTES,
} from '@personamarket/contracts';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { BusinessError } from '@personamarket/server';
import { AuthGuard } from '../auth/auth.guard.js';
import { ImportsService } from './imports.service.js';
import { NativeImportUploadGuard } from './native-import-upload.guard.js';
import { MarketImportUploadLease } from './market-import-upload.js';
@ApiTags('imports')
@ApiHeader({ name: 'X-CSRF-Token', required: true })
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
@Controller('me/persona-imports')
export class ImportsController {
  constructor(@Inject(ImportsService) readonly service: ImportsService) {}
  @Post('preview')
  @HttpCode(200)
  @ApiOperation({ operationId: 'previewNativePersonaImport' })
  @ApiOkResponse({ standardSchema: ImportPreviewResponseSchema })
  @SerializeOptions({ schema: ImportPreviewResponseSchema })
  preview(
    @Req() request: Request,
    @Body({ schema: ImportPreviewRequestSchema }) input: z.infer<typeof ImportPreviewRequestSchema>,
  ) {
    return this.service.preview(request, input);
  }
  @Post('preview/file')
  @HttpCode(200)
  @UseGuards(NativeImportUploadGuard)
  @UseInterceptors(
    MarketImportUploadLease,
    FileInterceptor('file', {
      // Busboy达到fileSize即截断并报错，额外1字节哨兵才能接受恰好4MiB的文件
      limits: { fileSize: NATIVE_IMPORT_MAX_BYTES + 1, files: 1, fields: 0, parts: 1 },
    }),
  )
  @ApiOperation({ operationId: 'previewNativePersonaFile' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '最大4MiB的原生文件，支持UTF-8、GBK/GB18030和UTF-16',
        },
      },
      required: ['file'],
    },
  })
  @ApiOkResponse({ standardSchema: ImportPreviewResponseSchema })
  @SerializeOptions({ schema: ImportPreviewResponseSchema })
  async previewFile(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query({ schema: NativeImportFileQuerySchema })
    { format, encoding }: z.infer<typeof NativeImportFileQuerySchema>,
    @UploadedFile() file: unknown,
  ) {
    const parsed = z
      .object({ buffer: z.instanceof(Buffer), originalname: z.string() })
      .safeParse(file);
    if (!parsed.success) throw new BusinessError('INVALID_INPUT', '请选择原生人设文件');
    if (parsed.data.buffer.byteLength > NATIVE_IMPORT_MAX_BYTES)
      throw new PayloadTooLargeException();
    const controller = new AbortController();
    const abort = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.once('close', abort);
    if (request.aborted) controller.abort();
    try {
      return await this.service.previewFile(
        request,
        parsed.data.buffer,
        parsed.data.originalname,
        format,
        encoding,
        controller.signal,
      );
    } finally {
      response.off('close', abort);
    }
  }
  @Post('confirm')
  @HttpCode(200)
  @ApiOperation({ operationId: 'confirmNativePersonaImport' })
  @ApiOkResponse({ standardSchema: DraftResponseSchema })
  @SerializeOptions({ schema: DraftResponseSchema })
  confirm(
    @Req() request: Request,
    @Body({ schema: ImportConfirmRequestSchema }) input: z.infer<typeof ImportConfirmRequestSchema>,
  ) {
    return this.service.confirm(request, input);
  }
}
