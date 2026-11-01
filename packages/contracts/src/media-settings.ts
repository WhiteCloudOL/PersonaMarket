import { z } from 'zod';
import {
  HomeSettingsWriteSchema,
  HomeSettingsResponseSchema,
  HomeSettingsRecordsResponseSchema,
  HomeSettingsRecordsQuerySchema,
} from './home-settings.js';

/** 只解析设置中的域名；实际下载仍逐跳执行公网地址与连接检查 */
export function mediaSourceHostname(value: string): string | undefined {
  const domain = value.trim();
  if (
    !domain ||
    /\s/u.test(domain) ||
    ['/', '\\', ':', '@', '?', '#', '%', '*', '[', ']'].some((character) =>
      domain.includes(character),
    )
  )
    return undefined;
  try {
    const hostname = new URL('https://' + domain).hostname.replace(/\.$/u, '').toLowerCase();
    const labels = hostname.split('.');
    if (
      hostname.length > 253 ||
      labels.length < 2 ||
      /^(?:\d+\.){3}\d+$/u.test(hostname) ||
      labels.some((label) => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/u.test(label))
    )
      return undefined;
    return hostname;
  } catch {
    return undefined;
  }
}

export const MediaSourceDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .refine(
    (value) => mediaSourceHostname(value) !== undefined,
    '仅填写域名，不含协议、端口、路径、IP 或通配符',
  );
export const MediaSettingsSchema = z.strictObject({
  uploadsEnabled: z.boolean(),
  remoteImportsEnabled: z.boolean(),
  maxImageKiB: z.number().int().min(64).max(5120),
  maxImagesPerAccount: z.number().int().min(1).max(100),
  maxReadmeImages: z.number().int().min(0).max(20),
  maxStorageMiBPerAccount: z.number().int().min(1).max(100),
  maxConcurrentImports: z.number().int().min(1).max(3),
  sourceDomains: z
    .array(MediaSourceDomainSchema)
    .max(50)
    .refine(
      (domains) => new Set(domains.map(mediaSourceHostname)).size === domains.length,
      '来源域不能重复，大小写、尾点与国际化域名视为同一域',
    ),
});
export type MediaSettings = z.infer<typeof MediaSettingsSchema>;
export const defaultMediaSettings: MediaSettings = {
  uploadsEnabled: true,
  remoteImportsEnabled: true,
  maxImageKiB: 5120,
  maxImagesPerAccount: 100,
  maxReadmeImages: 20,
  maxStorageMiBPerAccount: 100,
  maxConcurrentImports: 3,
  sourceDomains: [],
};
export const MediaSettingsWriteSchema = HomeSettingsWriteSchema.extend({
  data: MediaSettingsSchema,
});
export type MediaSettingsWrite = z.infer<typeof MediaSettingsWriteSchema>;
export const MediaSettingsResponseSchema = HomeSettingsResponseSchema.extend({
  data: MediaSettingsSchema,
  defaults: MediaSettingsSchema,
});
export type MediaSettingsResponse = z.infer<typeof MediaSettingsResponseSchema>;
export const PublicMediaSettingsResponseSchema = z.strictObject({
  data: MediaSettingsSchema,
  meta: z.strictObject({ revision: z.number().int().positive() }),
});
export const MediaSettingsRecordsQuerySchema = HomeSettingsRecordsQuerySchema;
export type MediaSettingsRecordsQuery = z.infer<typeof MediaSettingsRecordsQuerySchema>;
export const MediaSettingsRecordsResponseSchema = HomeSettingsRecordsResponseSchema.extend({
  data: z
    .array(
      HomeSettingsRecordsResponseSchema.shape.data.element.extend({
        before: MediaSettingsSchema,
        after: MediaSettingsSchema,
      }),
    )
    .max(20),
});
export const mediaSettingsEtag = (revision: number) => '"media-' + revision + '"';
