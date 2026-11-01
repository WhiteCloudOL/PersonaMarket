import { sql } from 'drizzle-orm';
import type { AdminTaskQuery, AdminTaskPath } from '@personamarket/contracts';
import type { FailedQueueSample } from '@personamarket/server';
import {
  retainedFailureCtes,
  mailFailureRows,
  retainedFailureRows,
} from './retained-failure-query.js';

/** 业务当前状态优先；同一通知/图片/排行不再按Outbox失败重复计数 */
export function taskFailureQuery(
  input: AdminTaskQuery,
  samples: FailedQueueSample[] = [],
  target?: AdminTaskPath,
) {
  return sql`WITH ${retainedFailureCtes(samples)}, event_state AS NOT MATERIALIZED (
    SELECT o.*,delivered_at IS NULL AND attempts>=5
      AND (lease_until IS NULL OR lease_until<=now()) AS dispatch_failed
    FROM outbox_events o
  ), image_events AS MATERIALIZED (
    SELECT DISTINCT ON (lower(payload->>'jobId')) * FROM event_state WHERE topic='asset.import'
    ORDER BY lower(payload->>'jobId'),created_at DESC,id DESC
  ), market_events AS MATERIALIZED (
    SELECT DISTINCT ON (lower(payload->>'assetId')) * FROM event_state WHERE topic='market.image'
    ORDER BY lower(payload->>'assetId'),created_at DESC,id DESC
  ), ranking_events AS MATERIALIZED (
    SELECT o.* FROM event_state o JOIN ranking_generations g ON g.current_event_id=o.id
    WHERE o.topic='rankings.refresh'
    UNION ALL
    SELECT o.* FROM event_state o JOIN ranking_generations g ON lower(o.payload->>'generationId')=g.id::text
    WHERE o.topic='rankings.refresh' AND g.current_event_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM event_state other WHERE other.topic='rankings.refresh'
        AND lower(other.payload->>'generationId')=g.id::text AND other.id<>o.id)
  ), failures AS (
    ${mailFailureRows()}
    UNION ALL
    SELECT 'image' AS source,j.id,'images' AS category,
      CASE WHEN o.dispatch_failed AND q.event_id IS NULL THEN 'dispatch' ELSE 'execution' END AS stage,
      CASE WHEN o.dispatch_failed AND q.event_id IS NULL THEN 'DISPATCH_FAILED' ELSE 'IMAGE_IMPORT_FAILED' END AS error_code,
      q.attempts AS execution_attempts,o.attempts AS dispatch_attempts,
      j.created_at,o.id AS event_id,
      jsonb_build_object('state',j.status,'error',j.error_code,'event',o.id,
        'attempts',o.attempts,'lease',o.lease_until,'delivered',o.delivered_at,
        'payloadHash',md5(o.payload::text),'queueAttempts',q.attempts,'queueFinished',q.finished_at) AS facts
    FROM asset_jobs j LEFT JOIN image_events o ON lower(o.payload->>'jobId')=j.id::text
    LEFT JOIN queue_retained q ON q.event_id=o.id
    WHERE j.status='failed' OR (j.status IN ('pending','processing') AND (o.dispatch_failed OR q.event_id IS NOT NULL))
    UNION ALL
    SELECT 'market_image',j.id,'images',
      CASE WHEN o.dispatch_failed AND q.event_id IS NULL THEN 'dispatch' ELSE 'execution' END,
      CASE WHEN o.dispatch_failed AND q.event_id IS NULL THEN 'DISPATCH_FAILED' ELSE 'IMAGE_IMPORT_FAILED' END,
      q.attempts,o.attempts,p.created_at,o.id,
      jsonb_build_object('state',j.status,'preview',p.state,'expiry',p.expires_at,
        'consumed',p.consumed_at,'event',o.id,'attempts',o.attempts,'lease',o.lease_until,
        'delivered',o.delivered_at,'payloadHash',md5(o.payload::text),
        'queueAttempts',q.attempts,'queueFinished',q.finished_at)
    FROM market_import_assets j JOIN market_imports p ON p.id=j.preview_id
    LEFT JOIN market_events o ON lower(o.payload->>'assetId')=j.id::text
    LEFT JOIN queue_retained q ON q.event_id=o.id
    WHERE j.status='failed' OR (j.status IN ('pending','queued','processing') AND (o.dispatch_failed OR q.event_id IS NOT NULL))
    UNION ALL
    SELECT 'ranking',j.id,'rankings',
      CASE WHEN o.dispatch_failed AND q.event_id IS NULL THEN 'dispatch' ELSE 'execution' END,
      CASE WHEN o.dispatch_failed AND q.event_id IS NULL THEN 'DISPATCH_FAILED' ELSE 'RANKING_BUILD_FAILED' END,
      CASE WHEN j.current_event_id IS NULL THEN q.attempts ELSE r.execution_attempts END,o.attempts,j.requested_at,o.id,
      jsonb_build_object('state',j.status,'error',j.error_code,'algorithm',j.algorithm,
        'executionAttempts',r.execution_attempts,'current',j.current_event_id,'runState',r.state,
        'round',r.manual_round,'terminal',r.terminal_proof,'event',o.id,'attempts',o.attempts,
        'lease',o.lease_until,'delivered',o.delivered_at,'payloadHash',md5(o.payload::text),
        'queueAttempts',q.attempts,'queueFinished',q.finished_at)
    FROM ranking_generations j LEFT JOIN ranking_events o ON
      (j.current_event_id IS NOT NULL AND o.id=j.current_event_id) OR
      (j.current_event_id IS NULL AND lower(o.payload->>'generationId')=j.id::text)
    LEFT JOIN ranking_generation_runs r ON r.generation_id=j.id AND r.event_id=j.current_event_id
    LEFT JOIN queue_retained q ON q.event_id=o.id
    WHERE j.status='failed' OR (j.status='pending' AND (o.dispatch_failed OR q.event_id IS NOT NULL))
    UNION ALL
    SELECT 'notification',j.id,'notifications',
      CASE WHEN o.dispatch_failed AND q.event_id IS NULL THEN 'dispatch' ELSE 'execution' END,
      CASE WHEN o.dispatch_failed AND q.event_id IS NULL THEN 'DISPATCH_FAILED' ELSE 'NOTIFICATION_DELIVERY_FAILED' END,
      CASE WHEN q.event_id IS NOT NULL THEN q.attempts WHEN o.dispatch_failed THEN NULL::integer ELSE j.attempts END,
      o.attempts,j.created_at,o.id,
      jsonb_build_object('state',j.status,'revision',j.revision,'error',j.error_code,
        'recordedAttempts',j.attempts,'event',o.id,'attempts',o.attempts,
        'lease',o.lease_until,'delivered',o.delivered_at,'payloadHash',md5(o.payload::text),
        'queueAttempts',q.attempts,'queueFinished',q.finished_at)
    FROM notifications j JOIN event_state o ON o.id=j.event_id
    LEFT JOIN queue_retained q ON q.event_id=o.id
    WHERE j.status='failed' OR (j.status='queued' AND (o.dispatch_failed OR q.event_id IS NOT NULL))
    UNION ALL
    ${retainedFailureRows()}
    UNION ALL
    SELECT 'dispatch',o.id,
      CASE WHEN o.topic='auth.email' THEN 'mail'
        WHEN o.topic IN ('asset.import','market.image') THEN 'images'
        WHEN o.topic='rankings.refresh' THEN 'rankings'
        WHEN o.topic='notification.deliver' THEN 'notifications'
        WHEN o.topic='storage.cleanup' THEN 'storage'
        WHEN o.topic IN ('system.bootstrap','system.probe') THEN 'system' ELSE 'unknown' END,
      'dispatch','DISPATCH_FAILED',NULL::integer,o.attempts,o.created_at,o.id,
      jsonb_build_object('topic',o.topic,'attempts',o.attempts,'lease',o.lease_until,
        'delivered',o.delivered_at,'payloadHash',md5(o.payload::text))
    FROM event_state o WHERE o.dispatch_failed
      AND NOT EXISTS(SELECT 1 FROM queue_retained q WHERE q.event_id=o.id)
      AND NOT(o.topic='auth.email' AND EXISTS(SELECT 1 FROM mail_deliveries m WHERE m.event_id=o.id))
      AND NOT (o.topic='asset.import' AND EXISTS(SELECT 1 FROM asset_jobs j WHERE j.id::text=lower(o.payload->>'jobId')))
      AND NOT (o.topic='market.image' AND EXISTS(SELECT 1 FROM market_import_assets j WHERE j.id::text=lower(o.payload->>'assetId')))
      AND NOT (o.topic='rankings.refresh' AND EXISTS(SELECT 1 FROM ranking_generations j WHERE j.id::text=lower(o.payload->>'generationId')))
      AND NOT (o.topic='notification.deliver' AND EXISTS(SELECT 1 FROM notifications j WHERE j.id::text=lower(o.payload->>'notificationId')))
  ), filtered AS MATERIALIZED (
    SELECT * FROM failures WHERE (${input.category}='all' OR category=${input.category})
      AND (${input.stage}='all' OR stage=${input.stage})
      ${target ? sql`AND source=${target.source} AND id=${target.id}::uuid` : sql``}
  ), page AS (
    SELECT * FROM filtered ORDER BY created_at DESC,source,id DESC
    LIMIT 20 OFFSET ${(input.page - 1) * 20}
  ) SELECT now() AS observed_at,(SELECT count(*) FROM filtered) AS total,
    (SELECT count(*) FROM queue_samples)-(SELECT count(*) FROM queue_matched) AS unmatched,
    coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY created_at DESC,source,id DESC) FROM page p),'[]'::jsonb) AS items`;
}
