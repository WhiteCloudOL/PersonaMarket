import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  Inject,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  SerializeOptions,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiResponse,
  ApiHeader,
  ApiBody,
  ApiConsumes,
} from '@nestjs/swagger';
import {
  AssetUploadParamsSchema,
  AssetResponseSchema,
  AssetListResponseSchema,
  AssetJobResponseSchema,
  ImportImageSchema,
  PersonaIdSchema,
  ErrorResponseSchema,
  PERSONA_AVATAR_MAX_BYTES,
} from '@personamarket/contracts';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { AssetsService } from './assets.service.js';
import { UploadGuard } from './upload.guard.js';
import { BusinessError } from '@personamarket/server';
const imageUploadBody = {
  required: true,
  schema: {
    type: 'object' as const,
    properties: { file: { type: 'string' as const, format: 'binary' } },
    required: ['file'],
  },
};
function uploadedBytes(file: unknown) {
  const result = z.object({ buffer: z.instanceof(Buffer) }).safeParse(file);
  if (!result.success) throw new BusinessError('INVALID_INPUT', '请选择需要上传的图片');
  return result.data.buffer;
}
@ApiTags('assets')
@UseGuards(AuthGuard)
@Controller()
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 413, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class AssetsController {
  constructor(@Inject(AssetsService) private readonly service: AssetsService) {}
  @Get('me/assets')
  @ApiOperation({ operationId: 'listOwnAssets' })
  @ApiOkResponse({ standardSchema: AssetListResponseSchema })
  @SerializeOptions({ schema: AssetListResponseSchema })
  list(@Req() request: Request) {
    return this.service.list(request);
  }
  @Post('me/assets/import-url')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOperation({ operationId: 'importOwnImageUrl' })
  @ApiOkResponse({ standardSchema: AssetJobResponseSchema })
  @SerializeOptions({ schema: AssetJobResponseSchema })
  queue(
    @Req() request: Request,
    @Body({ schema: ImportImageSchema }) input: z.infer<typeof ImportImageSchema>,
  ) {
    return this.service.queue(request, input.url);
  }
  @Get('me/asset-jobs/:id')
  @ApiOperation({ operationId: 'getOwnImageImportJob' })
  @ApiOkResponse({ standardSchema: AssetJobResponseSchema })
  @SerializeOptions({ schema: AssetJobResponseSchema })
  job(
    @Req() request: Request,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
  ) {
    return this.service.job(request, id);
  }
  @Post('me/assets/upload/:purpose')
  @UseGuards(UploadGuard)
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'X-Expected-Account', required: false })
  @ApiConsumes('multipart/form-data')
  @ApiBody(imageUploadBody)
  @ApiOperation({ operationId: 'uploadOwnImage' })
  @ApiOkResponse({ standardSchema: AssetResponseSchema })
  @SerializeOptions({ schema: AssetResponseSchema })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5242880, files: 1, fields: 0, parts: 1 } }),
  )
  upload(
    @Req() request: Request,
    @Param({ schema: AssetUploadParamsSchema })
    { purpose }: z.infer<typeof AssetUploadParamsSchema>,
    @UploadedFile() file: unknown,
  ) {
    return this.service.upload(request, purpose, uploadedBytes(file));
  }
  @Post('me/assets/upload-persona-avatar')
  @UseGuards(UploadGuard)
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'X-Expected-Account', required: true })
  @ApiConsumes('multipart/form-data')
  @ApiBody(imageUploadBody)
  @ApiOperation({ operationId: 'uploadPersonaAvatar' })
  @ApiOkResponse({ standardSchema: AssetResponseSchema })
  @SerializeOptions({ schema: AssetResponseSchema })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PERSONA_AVATAR_MAX_BYTES, files: 1, fields: 0, parts: 1 },
    }),
  )
  uploadPersonaAvatar(@Req() request: Request, @UploadedFile() file: unknown) {
    return this.service.upload(request, 'persona-avatar', uploadedBytes(file));
  }
  @Get('me/assets/:id')
  @ApiOperation({ operationId: 'readOwnImage' })
  @ApiOkResponse({ content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } } })
  read(
    @Req() request: Request,
    @Res() response: Response,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
  ) {
    return this.service.read(request, response, id);
  }
}
