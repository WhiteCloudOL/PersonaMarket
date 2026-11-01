import { Inject, Injectable } from '@nestjs/common';
import { PublicBrandSchema, type PublicConfigResponse } from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { PublicConfigRepository } from './public-config.repository.js';

@Injectable()
export class PublicConfigService {
  constructor(
    @Inject(PublicConfigRepository) private readonly repository: PublicConfigRepository,
  ) {}
  async read(): Promise<PublicConfigResponse> {
    let row: Awaited<ReturnType<PublicConfigRepository['readBrand']>>;
    try {
      row = await this.repository.readBrand();
    } catch (cause) {
      throw new BusinessError('SERVICE_UNAVAILABLE', '暂时无法读取站点配置，请稍后重试', {
        cause,
      });
    }
    if (!row) throw new BusinessError('SERVICE_UNAVAILABLE', '站点尚未完成初始化');
    const result = PublicBrandSchema.safeParse(row.value);
    if (!result.success)
      throw new BusinessError('INVALID_RESPONSE', '站点配置暂时不可用', { cause: result.error });
    return { data: result.data, meta: { revision: row.revision } };
  }
}
