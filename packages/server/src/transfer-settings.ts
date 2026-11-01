import { eq } from 'drizzle-orm';
import { siteSettings, type Database } from '@personamarket/database';
import {
  TransferSettingsSchema,
  defaultTransferSettings,
  type TransferSettings,
} from '@personamarket/contracts';
import { BusinessError } from './errors.js';

type Reader = Pick<Database['db'], 'select'>;
/** 写入导入结果的事务持有共享锁，与设置更新串行化 */
export async function readTransferSettings(reader: Reader, lock = false) {
  const query = reader.select().from(siteSettings).where(eq(siteSettings.key, 'transfer'));
  const [row] = await (lock ? query.for('share') : query);
  if (!row) throw new BusinessError('SERVICE_UNAVAILABLE', '导入导出设置尚未完成初始化');
  const parsed = TransferSettingsSchema.safeParse(row.value);
  if (!parsed.success)
    throw new BusinessError('SERVICE_UNAVAILABLE', '导入导出设置暂时不可用，请联系管理员', {
      cause: parsed.error,
    });
  return parsed.data;
}

export function assertTransferImport(
  settings: TransferSettings,
  format: string,
  inputBytes: number | null,
) {
  if (!settings.importFormats.some((enabled) => enabled === format))
    throw new BusinessError('UNSUPPORTED_FORMAT', '管理员已关闭此导入格式，请选择其他格式');
  const archive = format === 'market-zip';
  const maximum = archive
    ? settings.maxImportArchiveMiB * 1024 * 1024
    : settings.maxImportFileKiB * 1024;
  const original = archive
    ? defaultTransferSettings.maxImportArchiveMiB * 1024 * 1024
    : defaultTransferSettings.maxImportFileKiB * 1024;
  if (inputBytes !== null && inputBytes > original)
    throw new BusinessError('UNSUPPORTED_FORMAT', '导入文件超过固定大小上限，请减少内容后重试');
  // 历史预览没有原始字节数，收紧后不能凭解析后的正文猜测文件大小
  if (inputBytes === null && maximum < original)
    throw new BusinessError('CONFLICT', '文件限制已收紧，旧预览缺少原始大小，请重新选择文件预览');
  if (
    inputBytes !== null &&
    (!Number.isSafeInteger(inputBytes) || inputBytes < 0 || inputBytes > maximum)
  )
    throw new BusinessError(
      'INVALID_INPUT',
      archive
        ? '导入包超过当前大小限制，请减少内容后重试'
        : '导入文件超过当前大小限制，请减少内容后重试',
    );
}
