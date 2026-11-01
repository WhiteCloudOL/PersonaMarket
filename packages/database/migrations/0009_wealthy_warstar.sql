CREATE TABLE "asset_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"asset_id" uuid,
	"error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_job_status_valid" CHECK ("asset_jobs"."status" IN ('pending','processing','ready','failed'))
);
--> statement-breakpoint
CREATE TABLE "asset_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"persona_id" uuid NOT NULL,
	"resource_type" varchar(16) NOT NULL,
	"resource_id" uuid NOT NULL,
	"purpose" varchar(16) NOT NULL,
	CONSTRAINT "asset_reference_type" CHECK ("asset_references"."resource_type" IN ('draft','submission') AND "asset_references"."purpose" IN ('content','evidence'))
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"purpose" varchar(16) NOT NULL,
	"storage_key" varchar(64) NOT NULL,
	"mime" varchar(64) NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_purpose_valid" CHECK ("assets"."purpose" IN ('content','evidence')),
	CONSTRAINT "asset_size_valid" CHECK ("assets"."bytes" BETWEEN 1 AND 5242880 AND "assets"."width">0 AND "assets"."height">0 AND "assets"."width"::bigint*"assets"."height"<=40000000)
);
--> statement-breakpoint
ALTER TABLE "asset_jobs" ADD CONSTRAINT "asset_jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_jobs" ADD CONSTRAINT "asset_jobs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_references" ADD CONSTRAINT "asset_references_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_job_owner_idx" ON "asset_jobs" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_reference_unique" ON "asset_references" USING btree ("asset_id","resource_type","resource_id","purpose");--> statement-breakpoint
CREATE INDEX "asset_reference_resource_idx" ON "asset_references" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_storage_key_unique" ON "assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "assets_owner_idx" ON "assets" USING btree ("owner_id");