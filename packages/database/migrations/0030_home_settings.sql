CREATE TABLE "site_setting_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" varchar(2000) NOT NULL,
	"before_value" jsonb NOT NULL,
	"after_value" jsonb NOT NULL,
	"from_revision" integer NOT NULL,
	"to_revision" integer NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_setting_records_revision_valid" CHECK ("site_setting_records"."from_revision">0 AND "site_setting_records"."to_revision"="site_setting_records"."from_revision"+1),
	CONSTRAINT "site_setting_records_values_object" CHECK (jsonb_typeof("site_setting_records"."before_value")='object' AND jsonb_typeof("site_setting_records"."after_value")='object'),
	CONSTRAINT "site_setting_records_reason_not_empty" CHECK (char_length("site_setting_records"."reason")>0)
);
--> statement-breakpoint
ALTER TABLE "site_setting_records" ADD CONSTRAINT "site_setting_records_key_site_settings_key_fk" FOREIGN KEY ("key") REFERENCES "public"."site_settings"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_setting_records" ADD CONSTRAINT "site_setting_records_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_setting_records_revision_unique" ON "site_setting_records" USING btree ("key","to_revision");--> statement-breakpoint
CREATE INDEX "site_setting_records_created_idx" ON "site_setting_records" USING btree ("key","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
CREATE TRIGGER site_setting_records_append_only
BEFORE UPDATE OR DELETE ON public.site_setting_records
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='personamarket_app') THEN
    REVOKE UPDATE,DELETE ON public.site_setting_records FROM personamarket_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO public.site_settings(key,value)
VALUES ('home','{"heroNote":"把想象写进故事，让每一次对话都有温度","sections":[{"key":"featured","enabled":true},{"key":"recent","enabled":true},{"key":"announcements","enabled":true},{"key":"creation","enabled":true}],"featuredCount":4,"recentCount":4,"announcementCount":3,"navigation":["rankings","publish","guides","announcements"]}'::jsonb)
ON CONFLICT (key) DO NOTHING;
