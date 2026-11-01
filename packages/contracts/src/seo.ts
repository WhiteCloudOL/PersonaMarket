import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common.js';

export const SITEMAP_PAGE_SIZE = 1000;
// 一个静态页分片也占用sitemap索引的一项，整个索引不超过50000项
export const SITEMAP_MAX_PAGES = 49999;
export const PublicSitemapQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(SITEMAP_MAX_PAGES).default(1),
});
export type PublicSitemapQuery = z.infer<typeof PublicSitemapQuerySchema>;
export const PublicSitemapIndexResponseSchema = z.strictObject({
  data: z.strictObject({
    total: z
      .number()
      .int()
      .nonnegative()
      .max(SITEMAP_PAGE_SIZE * SITEMAP_MAX_PAGES),
    pageSize: z.literal(SITEMAP_PAGE_SIZE),
    pages: z.number().int().nonnegative().max(SITEMAP_MAX_PAGES),
  }),
});
export const PublicSitemapEntriesResponseSchema = z.strictObject({
  data: z
    .array(z.strictObject({ personaId: IdSchema, publishedAt: TimestampSchema }))
    .max(SITEMAP_PAGE_SIZE),
});
