CREATE TABLE "market_import_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preview_id" uuid NOT NULL,
	"package_key" uuid NOT NULL,
	"storage_key" varchar(64) NOT NULL,
	"source_url" text,
	"expected_mime" varchar(64) NOT NULL,
	"expected_bytes" integer NOT NULL,
	"expected_hash" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"bytes" integer,
	"width" integer,
	"height" integer,
	"sha256" varchar(64),
	CONSTRAINT "market_import_asset_status_valid" CHECK ("market_import_assets"."status" IN ('pending','queued','processing','ready','failed')),
	CONSTRAINT "market_import_asset_expected_valid" CHECK ("market_import_assets"."expected_bytes" BETWEEN 1 AND 5242880 AND "market_import_assets"."expected_mime" IN ('image/png','image/jpeg','image/webp') AND "market_import_assets"."expected_hash" ~ '^[a-f0-9]{64}$' AND "market_import_assets"."storage_key" ~ '^[a-f0-9]{32}[.]webp$'),
	CONSTRAINT "market_import_asset_ready_valid" CHECK ("market_import_assets"."status"<>'ready' OR ("market_import_assets"."bytes" IS NOT NULL AND "market_import_assets"."width" IS NOT NULL AND "market_import_assets"."height" IS NOT NULL AND "market_import_assets"."sha256" IS NOT NULL AND "market_import_assets"."bytes" BETWEEN 1 AND 5242880 AND "market_import_assets"."width">0 AND "market_import_assets"."height">0 AND "market_import_assets"."width"::bigint*"market_import_assets"."height"<=40000000 AND "market_import_assets"."sha256" ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
CREATE TABLE "market_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"format" varchar(32) NOT NULL,
	"state" varchar(16) NOT NULL,
	"filename" varchar(160) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"document" jsonb NOT NULL,
	"confirmation_hash" varchar(64),
	"result_persona_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_import_format_valid" CHECK ("market_imports"."format" IN ('market-json','market-zip')),
	CONSTRAINT "market_import_state_valid" CHECK ("market_imports"."state" IN ('processing','ready','failed')),
	CONSTRAINT "market_import_document_bounded" CHECK (octet_length("market_imports"."document"::text)<=4259840),
	CONSTRAINT "market_import_result_consistent" CHECK (("market_imports"."consumed_at" IS NULL AND "market_imports"."result_persona_id" IS NULL AND "market_imports"."confirmation_hash" IS NULL) OR ("market_imports"."consumed_at" IS NOT NULL AND "market_imports"."result_persona_id" IS NOT NULL AND "market_imports"."confirmation_hash" IS NOT NULL AND "market_imports"."state"='ready'))
);
--> statement-breakpoint
ALTER TABLE "market_import_assets" ADD CONSTRAINT "market_import_assets_preview_id_market_imports_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."market_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_imports" ADD CONSTRAINT "market_imports_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_imports" ADD CONSTRAINT "market_imports_result_persona_id_personas_id_fk" FOREIGN KEY ("result_persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "market_import_asset_key_unique" ON "market_import_assets" USING btree ("preview_id","package_key");--> statement-breakpoint
CREATE UNIQUE INDEX "market_import_storage_key_unique" ON "market_import_assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "market_import_owner_expiry_idx" ON "market_imports" USING btree ("owner_id","expires_at");