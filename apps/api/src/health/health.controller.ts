import { Controller, Get, Inject, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthResponseSchema } from '@personamarket/contracts';
import type { Database } from '@personamarket/database';
import { BusinessError, probeRedis, type ServerEnvironment } from '@personamarket/server';
import { DATABASE, ENVIRONMENT } from '../tokens.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENVIRONMENT) private readonly env: ServerEnvironment,
  ) {}
  @Get('live')
  @ApiOperation({ operationId: 'getLiveness', summary: '进程存活检查' })
  @ApiOkResponse({ standardSchema: HealthResponseSchema })
  @SerializeOptions({ schema: HealthResponseSchema })
  live() {
    return { data: { status: 'ok' as const } };
  }

  @Get('ready')
  @ApiOperation({ operationId: 'getReadiness', summary: '必要服务就绪检查' })
  @ApiOkResponse({ standardSchema: HealthResponseSchema })
  @SerializeOptions({ schema: HealthResponseSchema })
  async ready() {
    try {
      const [rows] = await Promise.all([
        this.database.pool.query<{ count: string }>(
          "SELECT count(*) FROM site_settings WHERE key = 'brand'",
        ),
        probeRedis(this.env.REDIS_URL),
      ]);
      if (rows.rows[0]?.count !== '1') throw new Error('BOOTSTRAP_REQUIRED');
      return { data: { status: 'ok' as const } };
    } catch (cause) {
      throw new BusinessError('SERVICE_UNAVAILABLE', '服务暂未就绪', { cause });
    }
  }
}
