CREATE TABLE "report_resolutions" (
	"action_id" uuid PRIMARY KEY NOT NULL,
	"command" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "report_resolution_command_shape" CHECK (jsonb_typeof("report_resolutions"."command")='object' AND "report_resolutions"."command" ? 'reason' AND jsonb_typeof("report_resolutions"."command"->'reason')='string' AND char_length("report_resolutions"."command"->>'reason') BETWEEN 1 AND 2000 AND "report_resolutions"."command"->>'reason' ~ '[^[:space:]]' AND octet_length("report_resolutions"."command"::text)<=16000),
	CONSTRAINT "report_resolution_result_shape" CHECK (jsonb_typeof("report_resolutions"."result")='object' AND "report_resolutions"."result" ? 'content' AND "report_resolutions"."result" ? 'account' AND octet_length("report_resolutions"."result"::text)<=4000)
);
--> statement-breakpoint
ALTER TABLE "persona_releases" ADD COLUMN "moderation_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "report_resolutions" ADD CONSTRAINT "report_resolutions_action_id_report_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."report_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_releases" ADD CONSTRAINT "release_moderation_revision_positive" CHECK ("persona_releases"."moderation_revision">0);
--> statement-breakpoint
-- 独立于不可变发布快照的状态修订号，覆盖封禁/恢复的ABA并发
CREATE FUNCTION public.advance_release_moderation_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.moderation_revision<>1 THEN
      RAISE EXCEPTION 'RELEASE_MODERATION_REVISION_INITIAL' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN
    NEW.moderation_revision := OLD.moderation_revision+1;
  ELSIF NEW.moderation_revision IS DISTINCT FROM OLD.moderation_revision THEN
    RAISE EXCEPTION 'RELEASE_MODERATION_REVISION_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER persona_releases_moderation_revision BEFORE INSERT OR UPDATE ON public.persona_releases
FOR EACH ROW EXECUTE FUNCTION public.advance_release_moderation_revision();
--> statement-breakpoint
CREATE FUNCTION public.guard_report_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
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
--> statement-breakpoint
CREATE TRIGGER report_resolutions_insert_guard BEFORE INSERT ON public.report_resolutions
FOR EACH ROW EXECUTE FUNCTION public.guard_report_resolution();
--> statement-breakpoint
CREATE TRIGGER report_resolutions_append_only BEFORE UPDATE OR DELETE ON public.report_resolutions
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
REVOKE UPDATE,DELETE ON public.report_resolutions FROM personamarket_app;
