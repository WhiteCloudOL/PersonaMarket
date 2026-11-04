import { eq } from 'drizzle-orm';
import { siteSettings, type Database } from '@personamarket/database';
import {
  MediaSettingsSchema,
  mediaSourceHostname,
  type MediaSettings,
} from '@personamarket/contracts';
import { BusinessError } from './errors.js';
import { checkedImageUrl } from './remote-image.js';

type Reader = Pick<Database['db'], 'select'>;
export async function readMediaSettings(reader: Reader, lock = false) {
  const query = reader.select().from(siteSettings).where(eq(siteSettings.key, 'media'));
  const [row] = await (lock ? query.for('share') : query);
  if (!row) throw new BusinessError('SERVICE_UNAVAILABLE', '文件与图片设置尚未完成初始化');
  const result = MediaSettingsSchema.safeParse(row.value);
  if (!result.success)
    throw new BusinessError('SERVICE_UNAVAILABLE', '文件与图片设置暂时不可用，请联系管理员', {
      cause: result.error,
    });
  return result.data;
}

export function assertMediaRemote(settings: MediaSettings, value: string) {
  if (!settings.remoteImportsEnabled)
    throw new BusinessError('FORBIDDEN', '管理员已关闭在线图片导入');
  let target: URL;
  try {
    target = checkedImageUrl(value);
  } catch (cause) {
    if (cause instanceof BusinessError) throw cause;
    throw new BusinessError('INVALID_INPUT', '图片地址无法读取，请核对公网 HTTPS 地址', { cause });
  }
  const hostname = mediaSourceHostname(target.hostname);
  if (
    settings.sourceDomains.length &&
    !settings.sourceDomains.some(
      (domain) => hostname !== undefined && mediaSourceHostname(domain) === hostname,
    )
  )
    throw new BusinessError('FORBIDDEN', '此图片来源域不在当前允许范围内');
  return target;
}

export type MediaImageSource =
  { kind: 'local' | 'persona-avatar' } | { kind: 'remote'; urls: readonly string[] };
export function assertMediaImageSize(settings: MediaSettings, inputBytes: number) {
  if (!Number.isSafeInteger(inputBytes) || inputBytes <= 0 || inputBytes > 5242880)
    throw new BusinessError('INVALID_INPUT', '图片不能为空且需要在 5 MiB 以内');
  if (inputBytes > settings.maxImageKiB * 1024)
    throw new BusinessError('INVALID_INPUT', '图片超过当前大小限制，请减少图片大小后重试');
}
export function assertMediaImage(
  settings: MediaSettings,
  inputBytes: number,
  source: MediaImageSource = { kind: 'local' },
) {
  if (source.kind !== 'persona-avatar') assertMediaImageSize(settings, inputBytes);
  if (source.kind !== 'remote') {
    if (!settings.uploadsEnabled) throw new BusinessError('FORBIDDEN', '管理员已关闭本地图片上传');
  } else {
    if (!source.urls.length)
      throw new BusinessError('INVALID_INPUT', '在线图片缺少可核对的来源地址');
    for (const url of source.urls) assertMediaRemote(settings, url);
  }
}
