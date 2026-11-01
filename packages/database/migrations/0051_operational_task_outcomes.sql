CREATE TABLE storage_cleanup_runs (
  event_id uuid PRIMARY KEY REFERENCES outbox_events(id),
  request_id uuid NOT NULL REFERENCES outbox_events(id),
  storage_key varchar(40) NOT NULL,
  manual_round integer NOT NULL DEFAULT 0,
  outcome varchar(16) NOT NULL DEFAULT 'pending',
  execution_attempts integer NOT NULL DEFAULT 0,
  error_code varchar(32), checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT storage_cleanup_run_shape CHECK (
    storage_key ~ '^[a-f0-9]{32}[.]webp$' AND manual_round BETWEEN 0 AND 3 AND execution_attempts>=0
    AND outcome IN ('pending','deleted','missing','protected','failed')
    AND ((outcome='pending' AND checked_at IS NULL AND error_code IS NULL)
      OR (outcome IN ('deleted','missing','protected') AND checked_at IS NOT NULL AND error_code IS NULL)
      OR (outcome='failed' AND checked_at IS NOT NULL AND error_code='STORAGE_CLEANUP_FAILED')))
);
--> statement-breakpoint
CREATE INDEX storage_cleanup_request_idx ON storage_cleanup_runs(request_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX storage_cleanup_request_round_unique ON storage_cleanup_runs(request_id,manual_round);
--> statement-breakpoint
CREATE TABLE mail_task_contexts (
  event_id uuid PRIMARY KEY REFERENCES outbox_events(id),
  purpose varchar(24) NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  token_id uuid REFERENCES auth_tokens(id) ON DELETE SET NULL,
  source_id uuid, source_type varchar(24) NOT NULL, recipient_hash varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mail_task_context_shape CHECK(purpose IN ('email_verify','password_reset','email_change','security_notice','review_notice') AND source_type IN ('account','persona','profile_submission','auth_audit') AND recipient_hash ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE operational_task_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(8) NOT NULL, task_id uuid NOT NULL,
  action varchar(16) NOT NULL, event_id uuid,
  actor_id uuid NOT NULL REFERENCES users(id),
  expected_version varchar(64) NOT NULL, reason varchar(500) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT operational_task_action_shape CHECK(kind IN ('storage','mail') AND action IN ('retry','acknowledge')
    AND (action<>'retry' OR (kind='storage' AND event_id IS NOT NULL))
    AND expected_version ~ '^[a-f0-9]{64}$' AND char_length(btrim(reason)) BETWEEN 5 AND 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX operational_task_action_version_unique ON operational_task_actions(kind,task_id,expected_version);
--> statement-breakpoint
CREATE INDEX operational_task_action_task_idx ON operational_task_actions(kind,task_id,created_at);
