CREATE TABLE "report_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" varchar(16) NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"private_note" text DEFAULT '' NOT NULL,
	"before_status" varchar(16),
	"after_status" varchar(16) NOT NULL,
	"from_revision" integer NOT NULL,
	"to_revision" integer NOT NULL,
	"self_review" boolean DEFAULT false NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_actions_action_valid" CHECK ("report_actions"."action" IN ('submitted','accepted','resolved','dismissed','noted')),
	CONSTRAINT "report_actions_status_valid" CHECK (("report_actions"."before_status" IS NULL OR "report_actions"."before_status" IN ('pending','processing','resolved','dismissed')) AND "report_actions"."after_status" IN ('pending','processing','resolved','dismissed')),
	CONSTRAINT "report_actions_revision_step" CHECK ("report_actions"."from_revision">=0 AND "report_actions"."to_revision"="report_actions"."from_revision"+1),
	CONSTRAINT "report_actions_transition" CHECK (("report_actions"."action"='submitted' AND "report_actions"."before_status" IS NULL AND "report_actions"."after_status"='pending') OR ("report_actions"."action"='accepted' AND "report_actions"."before_status"='pending' AND "report_actions"."after_status"='processing') OR ("report_actions"."action"='resolved' AND "report_actions"."before_status" IN ('pending','processing') AND "report_actions"."after_status"='resolved') OR ("report_actions"."action"='dismissed' AND "report_actions"."before_status" IN ('pending','processing') AND "report_actions"."after_status"='dismissed') OR ("report_actions"."action"='noted' AND "report_actions"."before_status"="report_actions"."after_status")),
	CONSTRAINT "report_actions_text_bounded" CHECK (char_length("report_actions"."message")<=2000 AND char_length("report_actions"."private_note")<=5000),
	CONSTRAINT "report_actions_shape" CHECK (("report_actions"."action"='submitted' AND "report_actions"."before_status" IS NULL AND "report_actions"."after_status"='pending' AND "report_actions"."from_revision"=0 AND NOT "report_actions"."self_review") OR ("report_actions"."action"<>'submitted' AND "report_actions"."before_status" IS NOT NULL AND "report_actions"."from_revision">0 AND (("report_actions"."action"='noted' AND ("report_actions"."message" ~ '[^[:space:]]' OR "report_actions"."private_note" ~ '[^[:space:]]')) OR ("report_actions"."action"<>'noted' AND "report_actions"."message" ~ '[^[:space:]]'))))
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reported_user_id" uuid NOT NULL,
	"type" varchar(16) NOT NULL,
	"target_id" uuid NOT NULL,
	"target_revision_id" uuid NOT NULL,
	"persona_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"comment_id" uuid,
	"comment_revision_id" uuid,
	"target_title" varchar(80) NOT NULL,
	"reason" varchar(32) NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_target_shape" CHECK (("reports"."type"='persona' AND "reports"."target_id"="reports"."persona_id" AND "reports"."target_revision_id"="reports"."release_id" AND "reports"."comment_id" IS NULL AND "reports"."comment_revision_id" IS NULL) OR ("reports"."type"='comment' AND "reports"."comment_id" IS NOT NULL AND "reports"."comment_revision_id" IS NOT NULL AND "reports"."target_id"="reports"."comment_id" AND "reports"."target_revision_id"="reports"."comment_revision_id")),
	CONSTRAINT "reports_status_valid" CHECK ("reports"."status" IN ('pending','processing','resolved','dismissed')),
	CONSTRAINT "reports_reason_valid" CHECK ("reports"."reason" IN ('copyright','inappropriate','spam','other')),
	CONSTRAINT "reports_revision_positive" CHECK ("reports"."revision">0),
	CONSTRAINT "reports_details_bounded" CHECK (char_length("reports"."details")<=5000),
	CONSTRAINT "reports_title_bounded" CHECK (char_length("reports"."target_title") BETWEEN 2 AND 80 AND "reports"."target_title" ~ '[^[:space:]]'),
	CONSTRAINT "reports_snapshot_shape" CHECK (jsonb_typeof("reports"."snapshot")='object' AND "reports"."snapshot" ? 'type' AND "reports"."snapshot" ? 'title' AND jsonb_typeof("reports"."snapshot"->'type')='string' AND jsonb_typeof("reports"."snapshot"->'title')='string' AND "reports"."snapshot"->>'type'="reports"."type" AND "reports"."snapshot"->>'title'="reports"."target_title" AND octet_length("reports"."snapshot"::text)<=16000),
	CONSTRAINT "reports_hash_valid" CHECK ("reports"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "report_actions" ADD CONSTRAINT "report_actions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_actions" ADD CONSTRAINT "report_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_user_id_users_id_fk" FOREIGN KEY ("reported_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_release_owner_fk" FOREIGN KEY ("persona_id","release_id") REFERENCES "public"."persona_releases"("persona_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_comment_persona_fk" FOREIGN KEY ("persona_id","comment_id") REFERENCES "public"."comments"("persona_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_comment_revision_fk" FOREIGN KEY ("comment_id","comment_revision_id") REFERENCES "public"."comment_revisions"("comment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_actions_revision_unique" ON "report_actions" USING btree ("report_id","to_revision");--> statement-breakpoint
CREATE INDEX "report_actions_history_idx" ON "report_actions" USING btree ("report_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "reports_active_actor_target_unique" ON "reports" USING btree ("reporter_id","type","target_id","target_revision_id") WHERE "reports"."status" IN ('pending','processing');--> statement-breakpoint
CREATE INDEX "reports_reporter_created_idx" ON "reports" USING btree ("reporter_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reports_queue_created_idx" ON "reports" USING btree ("status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reports_target_recent_idx" ON "reports" USING btree ("reporter_id","type","target_id","target_revision_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE FUNCTION public.guard_report_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.reporter_id,NEW.reported_user_id,NEW.type,NEW.target_id,NEW.target_revision_id,
    NEW.persona_id,NEW.release_id,NEW.comment_id,NEW.comment_revision_id,NEW.target_title,
    NEW.reason,NEW.details,NEW.snapshot,NEW.content_hash,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.reporter_id,OLD.reported_user_id,OLD.type,OLD.target_id,OLD.target_revision_id,
    OLD.persona_id,OLD.release_id,OLD.comment_id,OLD.comment_revision_id,OLD.target_title,
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
CREATE TRIGGER reports_update_guard BEFORE UPDATE ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.guard_report_update();
--> statement-breakpoint
CREATE TRIGGER reports_delete_guard BEFORE DELETE ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
CREATE TRIGGER report_actions_append_only BEFORE UPDATE OR DELETE ON public.report_actions
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
REVOKE DELETE ON public.reports FROM personamarket_app;
--> statement-breakpoint
REVOKE UPDATE,DELETE ON public.report_actions FROM personamarket_app;
