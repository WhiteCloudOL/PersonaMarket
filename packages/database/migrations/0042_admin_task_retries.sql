CREATE TABLE "admin_task_retries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(16) NOT NULL,
	"task_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"previous_event_id" uuid,
	"actor_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"expected_version" varchar(64) NOT NULL,
	"reason" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "admin_task_retry_bounds" CHECK ("admin_task_retries"."attempt" BETWEEN 1 AND 3 AND "admin_task_retries"."expected_version" ~ '^[a-f0-9]{64}$' AND char_length(btrim("admin_task_retries"."reason")) BETWEEN 5 AND 500),
	CONSTRAINT "admin_task_retry_identity" CHECK ("admin_task_retries"."source" IN ('dispatch','image','market_image','ranking','notification','mail','queue') AND ("admin_task_retries"."previous_event_id" IS NULL OR "admin_task_retries"."previous_event_id"<>"admin_task_retries"."event_id"))
);
--> statement-breakpoint
ALTER TABLE "admin_task_retries" ADD CONSTRAINT "admin_task_retries_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_task_retry_attempt_unique" ON "admin_task_retries" USING btree ("source","task_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_task_retry_version_unique" ON "admin_task_retries" USING btree ("source","task_id","expected_version");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_task_retry_event_unique" ON "admin_task_retries" USING btree ("event_id");
--> statement-breakpoint
CREATE TRIGGER admin_task_retry_update_guard BEFORE UPDATE ON public.admin_task_retries
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
CREATE TRIGGER admin_task_retry_delete_guard BEFORE DELETE ON public.admin_task_retries
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
REVOKE UPDATE,DELETE ON public.admin_task_retries FROM personamarket_app;
