import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common.js';
import { RankingAlgorithmSchema } from './ranking-algorithm.js';
import { RankingDefinitionSchema } from './ranking-settings.js';
import { RetryAdminTaskSchema } from './admin-tasks.js';

export const RankingRetryBlockedReasonSchema = z.enum([
  'COMPLETED',
  'AUTO_RETRY_PENDING',
  'DISPATCH_LEASE_ACTIVE',
  'CURRENT_EVENT_UNVERIFIABLE',
  'LEGACY_TERMINAL_UNVERIFIABLE',
  'DEFINITION_UNVERIFIABLE',
  'RESULT_INCONSISTENT',
  'MANUAL_LIMIT_REACHED',
  'COOLDOWN_ACTIVE',
]);
export const RankingRunTerminalProofSchema = z.enum([
  'worker_completed',
  'worker_final_failure',
  'dispatch_exhausted',
  'legacy_retained_final_failure',
]);
const count = z.number().int().nonnegative();
export const AdminRankingGenerationSchema = z.strictObject({
  id: IdSchema,
  algorithm: RankingAlgorithmSchema,
  requestedAt: TimestampSchema,
  settingsRevision: z.number().int().positive().nullable(),
  definition: RankingDefinitionSchema.nullable(),
  definitionVerified: z.boolean(),
  businessStatus: z.enum(['pending', 'completed', 'failed']),
  generatedAt: TimestampSchema.nullable(),
  run: z
    .strictObject({
      eventId: IdSchema,
      manualRound: z.number().int().min(0).max(3),
      origin: z.enum(['created', 'legacy_adopted', 'manual_retry']),
      state: z.enum(['pending', 'retrying', 'completed', 'failed']),
      dispatchAttempts: count.nullable(),
      executionAttempts: count.nullable(),
      automaticAttemptLimit: z.number().int().min(1).max(100),
      lastAttemptedAt: TimestampSchema.nullable(),
      lastErrorCode: z.string().max(64).nullable(),
      terminalProof: RankingRunTerminalProofSchema.nullable(),
      terminalObservedAt: TimestampSchema.nullable(),
      currentEventProcessed: z.boolean(),
    })
    .nullable(),
  legacy: z
    .strictObject({
      candidateEventId: IdSchema.nullable(),
      terminalVerified: z.boolean(),
      dispatchAttempts: count.nullable(),
      executionAttempts: count.nullable(),
      observation: z.enum([
        'matched_final',
        'in_progress',
        'missing',
        'unavailable',
        'unverifiable',
      ]),
    })
    .nullable(),
  completion: z.strictObject({
    state: z.enum(['verified', 'legacy_only', 'not_completed', 'unverifiable']),
    expectedBoards: z.union([z.literal(18), z.literal(36), z.literal(39)]),
    actualBoards: count,
  }),
  retry: z.strictObject({
    allowed: z.boolean(),
    blockedReason: RankingRetryBlockedReasonSchema.nullable(),
    recordedManualRound: z.number().int().min(0).max(3),
    maxManualRounds: z.literal(3),
    cooldownSeconds: z.literal(60),
    nextAllowedAt: TimestampSchema.nullable(),
  }),
  version: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type AdminRankingGeneration = z.infer<typeof AdminRankingGenerationSchema>;
const observationMeta = z.strictObject({ observedAt: TimestampSchema });
export const AdminRankingGenerationResponseSchema = z.strictObject({
  data: AdminRankingGenerationSchema,
  meta: observationMeta,
});
export type AdminRankingGenerationResponse = z.infer<typeof AdminRankingGenerationResponseSchema>;
export const RetryAdminRankingGenerationSchema = RetryAdminTaskSchema;
export type RetryAdminRankingGeneration = z.infer<typeof RetryAdminRankingGenerationSchema>;
export const AdminRankingRetryResponseSchema = z.strictObject({
  data: z.strictObject({ generationId: IdSchema, accepted: z.literal(true) }),
  meta: observationMeta,
});
export type AdminRankingRetryResponse = z.infer<typeof AdminRankingRetryResponseSchema>;
export const AdminRankingRetryReceiptResponseSchema = z.strictObject({
  data: z.strictObject({
    generationId: IdSchema,
    recorded: z.boolean(),
    recordedAt: TimestampSchema.nullable(),
  }),
  meta: observationMeta,
});
export type AdminRankingRetryReceiptResponse = z.infer<
  typeof AdminRankingRetryReceiptResponseSchema
>;
