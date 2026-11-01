CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "first_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "persona_public_projection" ADD COLUMN "search_release_id" uuid;--> statement-breakpoint
ALTER TABLE "persona_public_projection" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "persona_public_projection" ADD COLUMN "publisher_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "persona_public_projection" ADD COLUMN "author_names" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "persona_public_projection" ADD COLUMN "tag_names" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "persona_public_projection" ADD COLUMN "model_names" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "persona_public_projection" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "persona_public_projection" ADD COLUMN "tag_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "persona_public_projection" ADD COLUMN "platform" varchar(16);--> statement-breakpoint
ALTER TABLE "persona_public_projection" ADD COLUMN "origin_type" varchar(16);--> statement-breakpoint
ALTER TABLE "persona_public_projection" ADD COLUMN "redistribution" varchar(32);--> statement-breakpoint
ALTER TABLE "persona_public_projection" ADD COLUMN "dialogue_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "personas_first_published_idx" ON "personas" USING btree ("first_published_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "projection_search_trgm_idx" ON "persona_public_projection" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "projection_tags_idx" ON "persona_public_projection" USING gin ("tag_ids");--> statement-breakpoint
CREATE INDEX "projection_platform_category_idx" ON "persona_public_projection" USING btree ("platform","category_id");--> statement-breakpoint
ALTER TABLE "persona_public_projection" ADD CONSTRAINT "projection_search_bounds" CHECK (char_length("persona_public_projection"."search_text")<=40000 AND "persona_public_projection"."dialogue_count" BETWEEN 0 AND 100 AND cardinality("persona_public_projection"."tag_ids")<=8 AND cardinality("persona_public_projection"."tag_names")<=8);--> statement-breakpoint
ALTER TABLE "persona_public_projection" ADD CONSTRAINT "projection_search_ready" CHECK ("persona_public_projection"."search_release_id" IS NULL OR ("persona_public_projection"."category_id" IS NOT NULL AND "persona_public_projection"."platform" IS NOT NULL AND "persona_public_projection"."origin_type" IS NOT NULL AND "persona_public_projection"."redistribution" IS NOT NULL));
