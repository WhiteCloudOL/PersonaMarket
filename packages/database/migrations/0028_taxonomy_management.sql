CREATE TABLE "taxonomy_management_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(16) NOT NULL,
	"entity_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" varchar(16) NOT NULL,
	"reason" varchar(2000) NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "taxonomy_management_kind_valid" CHECK ("taxonomy_management_records"."kind" IN ('category','tag')),
	CONSTRAINT "taxonomy_management_action_valid" CHECK ("taxonomy_management_records"."action" IN ('created','updated','archived','restored')),
	CONSTRAINT "taxonomy_management_after_object" CHECK (jsonb_typeof("taxonomy_management_records"."after_state")='object'),
	CONSTRAINT "taxonomy_management_before_valid" CHECK (("taxonomy_management_records"."action"='created' AND "taxonomy_management_records"."before_state" IS NULL) OR ("taxonomy_management_records"."action"<>'created' AND "taxonomy_management_records"."before_state" IS NOT NULL AND jsonb_typeof("taxonomy_management_records"."before_state")='object'))
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "taxonomy_management_records" ADD CONSTRAINT "taxonomy_management_records_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "taxonomy_management_entity_created_idx" ON "taxonomy_management_records" USING btree ("kind","entity_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_casefold_unique" ON "categories" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "categories_state_order_idx" ON "categories" USING btree ("active","sort_order","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_casefold_unique" ON "tags" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "tags_state_order_idx" ON "tags" USING btree ("active","sort_order","id");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_revision_positive" CHECK ("categories"."revision">0);--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_sort_order_bounded" CHECK ("categories"."sort_order" BETWEEN -10000 AND 10000);--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_archived_inactive" CHECK ("categories"."archived_at" IS NULL OR NOT "categories"."active");--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_revision_positive" CHECK ("tags"."revision">0);--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_sort_order_bounded" CHECK ("tags"."sort_order" BETWEEN -10000 AND 10000);--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_archived_inactive" CHECK ("tags"."archived_at" IS NULL OR NOT "tags"."active");--> statement-breakpoint
CREATE TRIGGER taxonomy_management_records_append_only
BEFORE UPDATE OR DELETE ON public.taxonomy_management_records
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='personamarket_app') THEN
    REVOKE UPDATE,DELETE ON public.taxonomy_management_records FROM personamarket_app;
  END IF;
END $$;
