import { sql } from 'drizzle-orm';
import type { FailedQueueSample } from '@personamarket/server';

export function retainedFailureCtes(samples: FailedQueueSample[]) {
  return sql`queue_samples AS MATERIALIZED (
    SELECT * FROM jsonb_to_recordset(${JSON.stringify(samples)}::jsonb) AS q(
      event_id uuid,topic text,reference_key text,reference_id text,
      fingerprint_key text,fingerprint text,schema_version integer,payload_keys text[],
      attempts integer,finished_at timestamptz)
  ), queue_matched AS MATERIALIZED (
    SELECT q.* FROM queue_samples q JOIN outbox_events o ON o.id=q.event_id AND o.topic=q.topic
    WHERE CASE WHEN jsonb_typeof(o.payload)='object'
      THEN o.payload-q.payload_keys='{}'::jsonb ELSE false END
      AND (q.schema_version IS NULL OR o.payload->'schemaVersion'=to_jsonb(q.schema_version))
      AND (q.reference_key IS NULL OR (jsonb_typeof(o.payload->q.reference_key)='string'
        AND lower(o.payload->>q.reference_key)=q.reference_id))
      AND (q.fingerprint_key IS NULL OR (jsonb_typeof(o.payload->q.fingerprint_key)='string'
        AND md5(o.payload->>q.fingerprint_key)=q.fingerprint))
  ), queue_retained AS MATERIALIZED (
    SELECT DISTINCT ON (event_id) * FROM queue_matched ORDER BY event_id,finished_at DESC
  )`;
}

export function mailFailureRows() {
  return sql`SELECT 'mail' AS source,m.event_id AS id,'mail' AS category,
    CASE WHEN m.status='failed' THEN 'execution' ELSE 'uncertain' END AS stage,
    CASE WHEN m.status='sending' THEN 'MAIL_RESULT_UNCERTAIN' ELSE m.error_code END AS error_code,
    m.attempts AS execution_attempts,o.attempts AS dispatch_attempts,
    o.created_at,o.id AS event_id,
    jsonb_build_object('state',m.status,'attempts',m.attempts,'updated',m.updated_at,
      'completed',m.completed_at,'error',m.error_code,'payloadHash',m.payload_hash,
      'dispatch',o.attempts,'finished',q.finished_at) AS facts
    FROM mail_deliveries m JOIN event_state o ON o.id=m.event_id
    LEFT JOIN queue_retained q ON q.event_id=m.event_id
    WHERE m.status IN ('failed','uncertain') OR (m.status='sending' AND
      (q.event_id IS NOT NULL OR m.attempted_at<now()-interval '60 seconds'))`;
}

/** 仅补充没有业务当前状态的失败，消费回执和当前业务状态优先于保留队列历史 */
export function retainedFailureRows() {
  return sql`SELECT CASE WHEN q.topic='auth.email' THEN 'mail' ELSE 'queue' END AS source,
    o.id,CASE WHEN q.topic='auth.email' THEN 'mail'
      WHEN q.topic IN ('asset.import','market.image') THEN 'images'
      WHEN q.topic='rankings.refresh' THEN 'rankings'
      WHEN q.topic='notification.deliver' THEN 'notifications'
      WHEN q.topic='storage.cleanup' THEN 'storage' ELSE 'system' END AS category,
    CASE WHEN q.topic='auth.email' THEN 'uncertain' ELSE 'execution' END AS stage,
    CASE WHEN q.topic='auth.email' THEN 'MAIL_RESULT_UNCERTAIN' ELSE 'QUEUE_EXECUTION_FAILED' END AS error_code,
    q.attempts AS execution_attempts,o.attempts AS dispatch_attempts,o.created_at,o.id AS event_id,
    jsonb_build_object('topic',q.topic,'attempts',q.attempts,'finished',q.finished_at,
      'fingerprint',q.fingerprint,'dispatch',o.attempts) AS facts
    FROM queue_retained q JOIN event_state o ON o.id=q.event_id
    WHERE NOT EXISTS(SELECT 1 FROM processed_events p WHERE p.event_id=q.event_id AND p.consumer=CASE q.topic
      WHEN 'auth.email' THEN 'auth-email' WHEN 'asset.import' THEN 'asset-import'
      WHEN 'market.image' THEN 'market-image' WHEN 'rankings.refresh' THEN 'rankings'
      WHEN 'notification.deliver' THEN 'notifications' WHEN 'storage.cleanup' THEN 'storage-cleanup' ELSE 'system' END)
      AND NOT(q.topic='auth.email' AND EXISTS(SELECT 1 FROM mail_deliveries m WHERE m.event_id=o.id))
      AND NOT(q.topic='asset.import' AND EXISTS(SELECT 1 FROM asset_jobs j WHERE j.id::text=lower(o.payload->>'jobId')))
      AND NOT(q.topic='market.image' AND EXISTS(SELECT 1 FROM market_import_assets j WHERE j.id::text=lower(o.payload->>'assetId')))
      AND NOT(q.topic='rankings.refresh' AND EXISTS(SELECT 1 FROM ranking_generations j WHERE j.id::text=lower(o.payload->>'generationId')))
      AND NOT(q.topic='notification.deliver' AND EXISTS(SELECT 1 FROM notifications j WHERE j.id::text=lower(o.payload->>'notificationId')))`;
}
