CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"review_email" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "notification_preferences_revision_positive" CHECK ("notification_preferences"."revision">0)
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_valid";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_target_shape";--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_valid" CHECK ("notifications"."kind" IN ('release_approved','release_rejected','comment_approved','comment_rejected','comment_state','comment_reply','persona_state','report_updated','account_security','admin_notice'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_target_shape" CHECK (jsonb_typeof("notifications"."target")='object' AND "notifications"."target" ? 'type' AND jsonb_typeof("notifications"."target"->'type')='string' AND octet_length("notifications"."target"::text)<=2000 AND (
    ("notifications"."kind" IN ('release_approved','release_rejected','persona_state') AND "notifications"."target"->>'type'='own_persona') OR
    ("notifications"."kind" IN ('comment_approved','comment_rejected','comment_state') AND "notifications"."target"->>'type'='own_comment') OR
    ("notifications"."kind"='comment_reply' AND "notifications"."target"->>'type'='public_comment') OR
    ("notifications"."kind"='report_updated' AND "notifications"."target"->>'type'='own_report') OR
    ("notifications"."kind"='account_security' AND "notifications"."target"->>'type'='account') OR
    ("notifications"."kind"='admin_notice' AND "notifications"."target"->>'type'='none')));
--> statement-breakpoint
CREATE FUNCTION public.guard_notification_preferences() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>1 THEN
      RAISE EXCEPTION 'NOTIFICATION_PREFERENCES_INITIAL_REVISION' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'NOTIFICATION_PREFERENCES_REVISION_CONFLICT' USING ERRCODE='23514';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER notification_preferences_revision_guard BEFORE INSERT OR UPDATE ON public.notification_preferences
FOR EACH ROW EXECUTE FUNCTION public.guard_notification_preferences();
--> statement-breakpoint
CREATE TRIGGER notification_preferences_delete_guard BEFORE DELETE ON public.notification_preferences
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
REVOKE DELETE ON public.notification_preferences FROM personamarket_app;
