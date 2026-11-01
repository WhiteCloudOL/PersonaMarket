import { eq } from 'drizzle-orm';
import { siteSettings, type Database } from '@personamarket/database';
import {
  SystemSettingsResponseSchema,
  defaultSystemSettings,
  type SystemSettingsResponse,
} from '@personamarket/contracts';
import { BusinessError } from './errors.js';

type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
export type StorageExecution = 'request' | 'background';
/** 只表示独立System配置缺失/非法；不吞掉数据库或身份服务错误。 */
export class SystemConfigurationUnavailableError extends BusinessError {
  constructor(cause?: unknown) {
    super('SERVICE_UNAVAILABLE', '维护配置暂时不可用，请稍后重试', {
      cause,
      retryAfterSeconds: 60,
    });
  }
}
function response(row: typeof siteSettings.$inferSelect | undefined): SystemSettingsResponse {
  if (!row) throw new SystemConfigurationUnavailableError();
  const parsed = SystemSettingsResponseSchema.safeParse({
    data: row.value,
    defaults: defaultSystemSettings,
    meta: { revision: row.revision },
  });
  if (!parsed.success) throw new SystemConfigurationUnavailableError(parsed.error);
  return parsed.data;
}
function assertAvailable(settings: SystemSettingsResponse) {
  if (settings.data.maintenanceEnabled)
    throw new BusinessError(
      'MAINTENANCE_MODE',
      settings.data.maintenanceMessage || '站点维护中，暂时无法保存更改，请稍后重试',
      { retryAfterSeconds: 60 },
    );
}
export async function readSystemSettings(database: Database): Promise<SystemSettingsResponse> {
  const [row] = await database.db
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.key, 'system'))
    .limit(1);
  return response(row);
}
/** 仅减少昂贵请求准备；最终业务事务仍必须取得共享门禁。 */
export async function assertOrdinaryRequestAllowed(database: Database): Promise<void> {
  assertAvailable(await readSystemSettings(database));
}
/** 与System切换的排他锁形成提交边界；不能按调用者角色绕过。 */
export async function assertOrdinaryWriteAllowed(tx: Transaction): Promise<void> {
  const [row] = await tx
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.key, 'system'))
    .limit(1)
    .for('share');
  assertAvailable(response(row));
}
