ALTER TABLE "reports" DROP CONSTRAINT "reports_target_shape";--> statement-breakpoint
ALTER TABLE "reports" DROP CONSTRAINT "reports_title_bounded";--> statement-breakpoint
ALTER TABLE "reports" DROP CONSTRAINT "reports_snapshot_shape";--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "persona_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "release_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "profile_user_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "profile_submission_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_profile_submission_owner_fk" FOREIGN KEY ("profile_user_id","profile_submission_id") REFERENCES "public"."profile_submissions"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_shape" CHECK (("reports"."type"='persona' AND "reports"."persona_id" IS NOT NULL AND "reports"."release_id" IS NOT NULL AND "reports"."target_id"="reports"."persona_id" AND "reports"."target_revision_id"="reports"."release_id" AND "reports"."comment_id" IS NULL AND "reports"."comment_revision_id" IS NULL AND "reports"."profile_user_id" IS NULL AND "reports"."profile_submission_id" IS NULL) OR ("reports"."type"='comment' AND "reports"."persona_id" IS NOT NULL AND "reports"."release_id" IS NOT NULL AND "reports"."comment_id" IS NOT NULL AND "reports"."comment_revision_id" IS NOT NULL AND "reports"."target_id"="reports"."comment_id" AND "reports"."target_revision_id"="reports"."comment_revision_id" AND "reports"."profile_user_id" IS NULL AND "reports"."profile_submission_id" IS NULL) OR ("reports"."type"='profile' AND "reports"."profile_user_id" IS NOT NULL AND "reports"."profile_submission_id" IS NOT NULL AND "reports"."reported_user_id"="reports"."profile_user_id" AND "reports"."target_id"="reports"."profile_user_id" AND "reports"."target_revision_id"="reports"."profile_submission_id" AND "reports"."persona_id" IS NULL AND "reports"."release_id" IS NULL AND "reports"."comment_id" IS NULL AND "reports"."comment_revision_id" IS NULL));--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_title_bounded" CHECK (char_length("reports"."target_title") BETWEEN (CASE WHEN "reports"."type"='profile' THEN 1 ELSE 2 END) AND 80 AND "reports"."target_title" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_snapshot_shape" CHECK (jsonb_typeof("reports"."snapshot")='object' AND "reports"."snapshot" ? 'type' AND "reports"."snapshot" ? 'title' AND jsonb_typeof("reports"."snapshot"->'type')='string' AND jsonb_typeof("reports"."snapshot"->'title')='string' AND "reports"."snapshot"->>'type'="reports"."type" AND "reports"."snapshot"->>'title'="reports"."target_title" AND octet_length("reports"."snapshot"::text)<=(CASE WHEN "reports"."type"='profile' THEN 32768 ELSE 16000 END));
--> statement-breakpoint
-- 保留旧举报的冻结与处置约束，扩展获批资料引用
CREATE OR REPLACE FUNCTION public.guard_report_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.reporter_id,NEW.reported_user_id,NEW.type,NEW.target_id,NEW.target_revision_id,
    NEW.profile_user_id,NEW.profile_submission_id,NEW.persona_id,NEW.release_id,NEW.comment_id,NEW.comment_revision_id,NEW.target_title,
    NEW.reason,NEW.details,NEW.snapshot,NEW.content_hash,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.reporter_id,OLD.reported_user_id,OLD.type,OLD.target_id,OLD.target_revision_id,
    OLD.profile_user_id,OLD.profile_submission_id,OLD.persona_id,OLD.release_id,OLD.comment_id,OLD.comment_revision_id,OLD.target_title,
    OLD.reason,OLD.details,OLD.snapshot,OLD.content_hash,OLD.created_at) THEN
    RAISE EXCEPTION 'REPORT_EVIDENCE_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'REPORT_REVISION_STEP' USING ERRCODE='23514';
  END IF;
  IF (OLD.status IN ('resolved','dismissed') AND NEW.status<>OLD.status)
    OR (OLD.status='processing' AND NEW.status='pending') THEN
    RAISE EXCEPTION 'REPORT_TRANSITION_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_report_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  operation public.report_actions;
  target public.reports;
  action text;
  outcome jsonb;
  valid boolean;
BEGIN
  SELECT * INTO STRICT operation FROM public.report_actions WHERE id=NEW.action_id;
  SELECT * INTO STRICT target FROM public.reports WHERE id=operation.report_id;
  IF operation.action<>'resolved' OR operation.after_status<>'resolved'
    OR NOT (NEW.command ? 'content' OR NEW.command ? 'account') THEN
    RAISE EXCEPTION 'REPORT_RESOLUTION_ACTION_INVALID' USING ERRCODE='23514';
  END IF;
  IF NEW.command ? 'content' THEN
    action := NEW.command->'content'->>'action';
    outcome := NEW.result->'content';
    IF outcome->>'action' IS DISTINCT FROM action
      OR (outcome->>'beforeRevision')::integer IS DISTINCT FROM (NEW.command->'content'->>'expectedRevision')::integer
      OR (outcome->>'afterRevision')::integer IS DISTINCT FROM (outcome->>'beforeRevision')::integer+1 THEN
      RAISE EXCEPTION 'REPORT_RESOLUTION_CONTENT_REVISION_INVALID' USING ERRCODE='23514';
    END IF;
    valid := false;
    IF action='block_persona' AND target.type='persona' AND outcome->>'resourceId'=target.persona_id::text THEN
      SELECT EXISTS(SELECT 1 FROM public.moderation_records m JOIN public.personas p ON p.id=m.persona_id
        WHERE m.id=(outcome->>'recordId')::uuid AND m.persona_id=target.persona_id AND m.action='persona_blocked'
          AND m.actor_id=operation.actor_id AND m.request_id=operation.request_id AND m.reason=NEW.command->>'reason'
          AND p.moderation_state='blocked' AND p.revision=(outcome->>'afterRevision')::integer) INTO valid;
    ELSIF action='block_release' AND target.type='persona' AND outcome->>'resourceId'=target.release_id::text THEN
      SELECT EXISTS(SELECT 1 FROM public.moderation_records m JOIN public.persona_releases r ON r.id=target.release_id
        WHERE m.id=(outcome->>'recordId')::uuid AND m.persona_id=target.persona_id AND m.action='release_block'
          AND m.submission_id=r.approved_submission_id AND m.actor_id=operation.actor_id
          AND m.request_id=operation.request_id AND m.reason=NEW.command->>'reason'
          AND r.lifecycle='BLOCKED' AND r.moderation_revision=(outcome->>'afterRevision')::integer) INTO valid;
    ELSIF action='hide_comment' AND target.type='comment' AND outcome->>'resourceId'=target.comment_id::text THEN
      SELECT EXISTS(SELECT 1 FROM public.comment_moderation_records m JOIN public.comments c ON c.id=m.comment_id
        WHERE m.id=(outcome->>'recordId')::uuid AND c.id=target.comment_id AND m.action='hide'
          AND m.actor_id=operation.actor_id AND m.request_id=operation.request_id AND m.reason=NEW.command->>'reason'
          AND c.visibility='hidden' AND c.revision=(outcome->>'afterRevision')::integer) INTO valid;
    ELSIF action='hide_profile' AND target.type='profile' AND outcome->>'resourceId'=target.profile_user_id::text THEN
      SELECT EXISTS(SELECT 1 FROM public.profile_records m JOIN public.user_profiles p ON p.user_id=m.user_id
        WHERE m.id=(outcome->>'recordId')::uuid AND m.user_id=target.profile_user_id AND m.action='hide'
          AND m.submission_id=target.profile_submission_id AND p.published_submission_id=target.profile_submission_id
          AND m.actor_id=operation.actor_id AND m.request_id=operation.request_id AND m.reason=NEW.command->>'reason'
          AND m.self_review=(m.user_id=operation.actor_id)
          AND m.from_profile_revision=(outcome->>'beforeRevision')::integer
          AND m.to_profile_revision=(outcome->>'afterRevision')::integer
          AND p.visibility='hidden' AND p.revision=(outcome->>'afterRevision')::integer) INTO valid;
    END IF;
    IF valid IS NOT TRUE THEN
      RAISE EXCEPTION 'REPORT_RESOLUTION_CONTENT_TARGET_INVALID' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.result->'content' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'REPORT_RESOLUTION_CONTENT_UNEXPECTED' USING ERRCODE='23514';
  END IF;
  IF NEW.command ? 'account' THEN
    outcome := NEW.result->'account';
    SELECT EXISTS(SELECT 1 FROM public.user_management_records m
      WHERE m.id=(outcome->>'recordId')::uuid AND m.target_id=target.reported_user_id
        AND outcome->>'userId'=target.reported_user_id::text AND m.action='ban'
        AND NEW.command->'account'->>'action'='ban' AND m.scope=NEW.command->'account'->>'scope'
        AND m.actor_id=operation.actor_id AND m.request_id=operation.request_id AND m.reason=NEW.command->>'reason'
        AND m.from_security_version=(NEW.command->'account'->>'expectedSecurityVersion')::integer
        AND m.from_security_version=(outcome->>'beforeSecurityVersion')::integer
        AND m.to_security_version=(outcome->>'afterSecurityVersion')::integer
        AND m.revoked_sessions=(outcome->>'revokedSessions')::integer
        AND m.affected_personas=(outcome->>'affectedPersonas')::integer) INTO valid;
    IF valid IS NOT TRUE THEN
      RAISE EXCEPTION 'REPORT_RESOLUTION_ACCOUNT_TARGET_INVALID' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.result->'account' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'REPORT_RESOLUTION_ACCOUNT_UNEXPECTED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
