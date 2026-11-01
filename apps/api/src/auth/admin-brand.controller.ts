import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Req,
  Res,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import {
  ErrorResponseSchema,
  PublicBrandSchema,
  PublicConfigResponseSchema,
} from '@personamarket/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthGuard } from './auth.guard.js';
import { AdminBrandService } from './admin-brand.service.js';
@ApiTags('admin')
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
@UseGuards(AuthGuard)
@Controller('admin/settings/brand')
export class AdminBrandController {
  constructor(@Inject(AdminBrandService) private readonly brand: AdminBrandService) {}
  @Get()
  @ApiOperation({ operationId: 'getAdminBrand', summary: '管理员读取品牌设置' })
  @ApiOkResponse({ standardSchema: PublicConfigResponseSchema })
  @SerializeOptions({ schema: PublicConfigResponseSchema })
  async get(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.brand.read(request);
    response.setHeader('ETag', `"brand-${result.meta.revision}"`);
    return result;
  }
  @Patch()
  @ApiOperation({ operationId: 'updateAdminBrand', summary: '通过乐观锁更新品牌设置' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOkResponse({ standardSchema: PublicConfigResponseSchema })
  @SerializeOptions({ schema: PublicConfigResponseSchema })
  async patch(
    @Body({ schema: PublicBrandSchema.strict() }) input: z.infer<typeof PublicBrandSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.brand.update(input, request, response);
    response.setHeader('ETag', `"brand-${result.meta.revision}"`);
    return result;
  }
}
