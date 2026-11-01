CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"actor_id" uuid,
	"source_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"title" varchar(120) NOT NULL,
	"message" text NOT NULL,
	"target" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(32),
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"last_attempted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_kind_valid" CHECK ("notifications"."kind" IN ('release_approved','release_rejected','comment_approved','comment_rejected','comment_reply','persona_state','report_updated','account_security','admin_notice')),
	CONSTRAINT "notifications_text_bounded" CHECK (char_length("notifications"."title") BETWEEN 2 AND 120 AND "notifications"."title" ~ '[^[:space:]]' AND char_length("notifications"."message") BETWEEN 1 AND 2000 AND "notifications"."message" ~ '[^[:space:]]'),
	CONSTRAINT "notifications_actor_shape" CHECK ("notifications"."kind"<>'admin_notice' OR "notifications"."actor_id" IS NOT NULL),
	CONSTRAINT "notifications_target_shape" CHECK (jsonb_typeof("notifications"."target")='object' AND "notifications"."target" ? 'type' AND jsonb_typeof("notifications"."target"->'type')='string' AND octet_length("notifications"."target"::text)<=2000 AND (
    ("notifications"."kind" IN ('release_approved','release_rejected','persona_state') AND "notifications"."target"->>'type'='own_persona') OR
    ("notifications"."kind" IN ('comment_approved','comment_rejected') AND "notifications"."target"->>'type'='own_comment') OR
    ("notifications"."kind"='comment_reply' AND "notifications"."target"->>'type'='public_comment') OR
    ("notifications"."kind"='report_updated' AND "notifications"."target"->>'type'='own_report') OR
    ("notifications"."kind"='account_security' AND "notifications"."target"->>'type'='account') OR
    ("notifications"."kind"='admin_notice' AND "notifications"."target"->>'type'='none'))),
	CONSTRAINT "notifications_delivery_shape" CHECK ("notifications"."revision">0 AND "notifications"."attempts" BETWEEN 0 AND 5 AND ("notifications"."error_code" IS NULL OR "notifications"."error_code" IN ('DELIVERY_FAILED','TARGET_UNAVAILABLE')) AND (
    ("notifications"."status"='queued' AND "notifications"."delivered_at" IS NULL AND "notifications"."completed_at" IS NULL AND "notifications"."read_at" IS NULL) OR
    ("notifications"."status"='delivered' AND "notifications"."delivered_at" IS NOT NULL AND "notifications"."completed_at" IS NOT NULL AND "notifications"."error_code" IS NULL AND "notifications"."attempts">0) OR
    ("notifications"."status"='skipped' AND "notifications"."delivered_at" IS NULL AND "notifications"."completed_at" IS NOT NULL AND "notifications"."read_at" IS NULL AND "notifications"."error_code"='TARGET_UNAVAILABLE' AND "notifications"."attempts">0) OR
    ("notifications"."status"='failed' AND "notifications"."delivered_at" IS NULL AND "notifications"."completed_at" IS NOT NULL AND "notifications"."read_at" IS NULL AND "notifications"."error_code"='DELIVERY_FAILED' AND "notifications"."attempts">0)))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_outbox_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_business_event_unique" ON "notifications" USING btree ("recipient_id","kind","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_outbox_unique" ON "notifications" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "notifications_inbox_idx" ON "notifications" USING btree ("recipient_id","delivered_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "notifications"."status"='delivered';--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("recipient_id") WHERE "notifications"."status"='delivered' AND "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_admin_notice_idx" ON "notifications" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "notifications"."kind"='admin_notice';
--> statement-breakpoint
CREATE FUNCTION public.guard_notification_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE retrying boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'queued' OR NEW.revision<>1 OR NEW.attempts<>0 OR NEW.error_code IS NOT NULL
      OR NEW.last_attempted_at IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.delivered_at IS NOT NULL OR NEW.read_at IS NOT NULL THEN
      RAISE EXCEPTION 'NOTIFICATION_MUST_START_QUEUED' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.recipient_id,NEW.actor_id,NEW.source_id,NEW.kind,NEW.title,NEW.message,NEW.target,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.recipient_id,OLD.actor_id,OLD.source_id,OLD.kind,OLD.title,OLD.message,OLD.target,OLD.created_at) THEN
    RAISE EXCEPTION 'NOTIFICATION_CONTENT_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  retrying := OLD.status='failed' AND NEW.status='queued' AND NEW.event_id<>OLD.event_id AND NEW.revision=OLD.revision+1
    AND NEW.attempts=0 AND NEW.error_code IS NULL AND NEW.last_attempted_at IS NULL AND NEW.completed_at IS NULL
    AND NEW.delivered_at IS NULL AND NEW.read_at IS NULL;
  IF NOT retrying THEN
    IF NEW.event_id<>OLD.event_id OR NEW.revision<>OLD.revision OR NEW.attempts<OLD.attempts THEN
      RAISE EXCEPTION 'NOTIFICATION_DELIVERY_REVISION' USING ERRCODE='23514';
    END IF;
    IF OLD.status<>'queued' AND ROW(NEW.status,NEW.attempts,NEW.error_code,NEW.last_attempted_at,NEW.completed_at,NEW.delivered_at)
      IS DISTINCT FROM ROW(OLD.status,OLD.attempts,OLD.error_code,OLD.last_attempted_at,OLD.completed_at,OLD.delivered_at) THEN
      RAISE EXCEPTION 'NOTIFICATION_DELIVERY_TERMINAL' USING ERRCODE='23514';
    END IF;
  END IF;
  IF (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at)
    OR (NEW.read_at IS NOT NULL AND OLD.status<>'delivered') THEN
    RAISE EXCEPTION 'NOTIFICATION_READ_MONOTONIC' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER notifications_mutation_guard BEFORE INSERT OR UPDATE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.guard_notification_mutation();
--> statement-breakpoint
CREATE TRIGGER notifications_delete_guard BEFORE DELETE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
REVOKE DELETE ON public.notifications FROM personamarket_app;
--> statement-breakpoint
CREATE INDEX notifications_queued_idx ON public.notifications(created_at,id) WHERE status='queued';
--> statement-breakpoint
CREATE INDEX notifications_failed_idx ON public.notifications(created_at,id) WHERE status='failed';
