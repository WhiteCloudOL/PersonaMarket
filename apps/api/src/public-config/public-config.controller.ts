import { Controller, Get, Inject, Res, SerializeOptions } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseSchema, PublicConfigResponseSchema } from '@personamarket/contracts';
import type { Response } from 'express';
import { PublicConfigService } from './public-config.service.js';

@ApiTags('public')
@Controller('public/config')
export class PublicConfigController {
  constructor(@Inject(PublicConfigService) private readonly service: PublicConfigService) {}
  @Get()
  @ApiOperation({ operationId: 'getPublicConfig', summary: '读取公开站点配置' })
  @ApiOkResponse({ description: '公开配置', standardSchema: PublicConfigResponseSchema })
  @ApiServiceUnavailableResponse({ standardSchema: ErrorResponseSchema })
  @SerializeOptions({ schema: PublicConfigResponseSchema })
  async read(@Res({ passthrough: true }) response: Response) {
    const result = await this.service.read();
    response.setHeader('ETag', `"brand-${result.meta.revision}"`);
    return result;
  }
}
