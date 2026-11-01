import { z } from 'zod';
import { TimestampSchema } from './common.js';

const amount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const queues = z.strictObject({ releases: amount, comments: amount, profiles: amount });
export const StorageObservationSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ready'),
    checkedAt: TimestampSchema,
    files: amount,
    bytes: amount,
  }),
  z.strictObject({
    status: z.literal('partial'),
    checkedAt: TimestampSchema,
    files: amount,
    bytes: amount,
  }),
  z.strictObject({
    status: z.literal('unavailable'),
    checkedAt: TimestampSchema,
    files: z.null(),
    bytes: z.null(),
  }),
]);
export const QueueObservationSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ready'),
    checkedAt: TimestampSchema,
    failed: amount,
    waiting: amount,
    active: amount,
    delayed: amount,
  }),
  z.strictObject({
    status: z.literal('unavailable'),
    checkedAt: TimestampSchema,
    failed: z.null(),
    waiting: z.null(),
    active: z.null(),
    delayed: z.null(),
  }),
]);
export const AdminOverviewDataSchema = z.discriminatedUnion('role', [
  z.strictObject({ role: z.literal('moderator'), asOf: TimestampSchema, queues }),
  z.strictObject({
    role: z.literal('admin'),
    asOf: TimestampSchema,
    windowStart: TimestampSchema,
    queues: queues.extend({ reports: amount }),
    catalog: z.strictObject({
      publicPersonas: amount,
      activeUsers: amount,
      newPublicPersonas7d: amount,
      newActiveUsers7d: amount,
      publishedReleases7d: amount,
    }),
    interactions: z.strictObject({ likes7d: amount, favorites7d: amount, comments7d: amount }),
    tasks: z.strictObject({
      dispatchFailed: amount,
      emailDispatchFailed: amount,
      notificationFailed: amount,
      imageImportFailed: amount,
      rankingFailed: amount,
    }),
    observations: z.strictObject({
      storage: StorageObservationSchema,
      queue: QueueObservationSchema,
    }),
  }),
]);
export const AdminOverviewResponseSchema = z.strictObject({ data: AdminOverviewDataSchema });
export type AdminOverview = z.infer<typeof AdminOverviewDataSchema>;
export type StorageObservation = z.infer<typeof StorageObservationSchema>;
export type QueueObservation = z.infer<typeof QueueObservationSchema>;
