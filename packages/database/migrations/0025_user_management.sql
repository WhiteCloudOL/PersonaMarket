CREATE TABLE "user_management_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"action" varchar(32) NOT NULL,
	"reason" text NOT NULL,
	"from_role" varchar(16) NOT NULL,
	"to_role" varchar(16) NOT NULL,
	"from_status" varchar(16) NOT NULL,
	"to_status" varchar(16) NOT NULL,
	"from_security_version" integer NOT NULL,
	"to_security_version" integer NOT NULL,
	"scope" varchar(32) NOT NULL,
	"affected_personas" integer DEFAULT 0 NOT NULL,
	"revoked_sessions" integer DEFAULT 0 NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_management_reason_bounded" CHECK (char_length("user_management_records"."reason") BETWEEN 1 AND 2000 AND "user_management_records"."reason" ~ '[^[:space:]]'),
	CONSTRAINT "user_management_versions_valid" CHECK ("user_management_records"."from_security_version" > 0 AND "user_management_records"."to_security_version" >= "user_management_records"."from_security_version"),
	CONSTRAINT "user_management_counts_valid" CHECK ("user_management_records"."affected_personas" >= 0 AND "user_management_records"."revoked_sessions" >= 0),
	CONSTRAINT "user_management_roles_valid" CHECK ("user_management_records"."from_role" IN ('user','moderator','admin') AND "user_management_records"."to_role" IN ('user','moderator','admin')),
	CONSTRAINT "user_management_status_valid" CHECK ("user_management_records"."from_status" IN ('active','banned','deactivated') AND "user_management_records"."to_status" IN ('active','banned','deactivated')),
	CONSTRAINT "user_management_scope_valid" CHECK ("user_management_records"."scope" IN ('account_only','account_and_personas') AND ("user_management_records"."scope"='account_only' OR "user_management_records"."action"='ban') AND ("user_management_records"."affected_personas"=0 OR "user_management_records"."scope"='account_and_personas')),
	CONSTRAINT "user_management_action_valid" CHECK (
      ("user_management_records"."action"='set_role' AND "user_management_records"."from_status"="user_management_records"."to_status")
      OR ("user_management_records"."action"='ban' AND "user_management_records"."from_status"='active' AND "user_management_records"."to_status"='banned' AND "user_management_records"."from_role"="user_management_records"."to_role")
      OR ("user_management_records"."action"='restore' AND "user_management_records"."from_status"='banned' AND "user_management_records"."to_status"='active' AND "user_management_records"."from_role"="user_management_records"."to_role")
      OR ("user_management_records"."action"='revoke_sessions' AND "user_management_records"."from_status"="user_management_records"."to_status" AND "user_management_records"."from_role"="user_management_records"."to_role")
    )
);
--> statement-breakpoint
ALTER TABLE "user_management_records" ADD CONSTRAINT "user_management_records_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_management_records" ADD CONSTRAINT "user_management_records_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_management_target_created_idx" ON "user_management_records" USING btree ("target_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "user_management_actor_created_idx" ON "user_management_records" USING btree ("actor_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "users_created_idx" ON "users" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "users_role_status_created_idx" ON "users" USING btree ("role","status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE TRIGGER user_management_records_append_only
BEFORE UPDATE OR DELETE ON public.user_management_records
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='personamarket_app') THEN
    REVOKE UPDATE,DELETE ON public.user_management_records FROM personamarket_app;
  END IF;
END $$;
