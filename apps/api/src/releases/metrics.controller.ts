import { Controller, Get, Inject, Param, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ErrorResponseSchema,
  PersonaIdSchema,
  PublicPersonaMetricsResponseSchema,
  PublicStatisticsResponseSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { MetricsService } from './metrics.service.js';

@ApiTags('discovery')
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
@Controller()
export class MetricsController {
  constructor(@Inject(MetricsService) readonly service: MetricsService) {}
  @Get('public/statistics')
  @ApiOperation({ operationId: 'getPublicStatistics' })
  @ApiOkResponse({ standardSchema: PublicStatisticsResponseSchema })
  @SerializeOptions({ schema: PublicStatisticsResponseSchema })
  summary() {
    return this.service.summary();
  }
  @Get('personas/:id/metrics')
  @ApiOperation({ operationId: 'getPublicPersonaMetrics' })
  @ApiOkResponse({ standardSchema: PublicPersonaMetricsResponseSchema })
  @SerializeOptions({ schema: PublicPersonaMetricsResponseSchema })
  persona(@Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>) {
    return this.service.persona(id);
  }
}
