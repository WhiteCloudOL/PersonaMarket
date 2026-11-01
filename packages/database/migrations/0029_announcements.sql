CREATE TABLE "announcement_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" varchar(16) NOT NULL,
	"reason" varchar(2000) NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_records_action_valid" CHECK ("announcement_records"."action" IN ('created','edited','published','withdrawn','archived','restored')),
	CONSTRAINT "announcement_records_after_object" CHECK (jsonb_typeof("announcement_records"."after_state")='object'),
	CONSTRAINT "announcement_records_before_valid" CHECK (("announcement_records"."action"='created' AND "announcement_records"."before_state" IS NULL) OR ("announcement_records"."action"<>'created' AND "announcement_records"."before_state" IS NOT NULL AND jsonb_typeof("announcement_records"."before_state")='object'))
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(160) NOT NULL,
	"summary" varchar(300) NOT NULL,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"published_snapshot" jsonb,
	"first_published_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_status_valid" CHECK ("announcements"."status" IN ('draft','published','withdrawn','archived')),
	CONSTRAINT "announcements_revision_positive" CHECK ("announcements"."revision">0),
	CONSTRAINT "announcements_body_bounded" CHECK (char_length("announcements"."body") BETWEEN 1 AND 20000),
	CONSTRAINT "announcements_title_not_empty" CHECK (char_length("announcements"."title")>=1),
	CONSTRAINT "announcements_snapshot_valid" CHECK (("announcements"."published_snapshot" IS NULL AND "announcements"."first_published_at" IS NULL AND "announcements"."published_at" IS NULL AND "announcements"."status"<>'published') OR ("announcements"."published_snapshot" IS NOT NULL AND jsonb_typeof("announcements"."published_snapshot")='object' AND "announcements"."first_published_at" IS NOT NULL AND "announcements"."published_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "announcement_records" ADD CONSTRAINT "announcement_records_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_records" ADD CONSTRAINT "announcement_records_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_records_created_idx" ON "announcement_records" USING btree ("announcement_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "announcements_status_updated_idx" ON "announcements" USING btree ("status","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "announcements_published_idx" ON "announcements" USING btree ("published_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "announcements"."status"='published';
--> statement-breakpoint
CREATE TRIGGER announcement_records_append_only
BEFORE UPDATE OR DELETE ON public.announcement_records
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='personamarket_app') THEN
    REVOKE UPDATE,DELETE ON public.announcement_records FROM personamarket_app;
  END IF;
END $$;
