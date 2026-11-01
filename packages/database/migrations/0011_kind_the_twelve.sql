CREATE TABLE "idempotency_keys" (
	"actor_id" uuid NOT NULL,
	"operation" varchar(100) NOT NULL,
	"key" uuid NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"result_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_actor_id_operation_key_pk" PRIMARY KEY("actor_id","operation","key")
);
--> statement-breakpoint
CREATE TABLE "moderation_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" uuid NOT NULL,
	"submission_id" uuid,
	"actor_id" uuid NOT NULL,
	"action" varchar(64) NOT NULL,
	"reason" text NOT NULL,
	"self_review" boolean DEFAULT false NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_public_projection" (
	"persona_id" uuid PRIMARY KEY NOT NULL,
	"release_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"readme_text" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" uuid NOT NULL,
	"version" varchar(32) NOT NULL,
	"major" integer NOT NULL,
	"minor" integer NOT NULL,
	"patch" integer NOT NULL,
	"lifecycle" varchar(16) DEFAULT 'UNPUBLISHED' NOT NULL,
	"approved_submission_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_version_valid" CHECK ("persona_releases"."major" BETWEEN 0 AND 999999 AND "persona_releases"."minor" BETWEEN 0 AND 999999 AND "persona_releases"."patch" BETWEEN 0 AND 999999 AND "persona_releases"."version"="persona_releases"."major"::text||'.'||"persona_releases"."minor"::text||'.'||"persona_releases"."patch"::text),
	CONSTRAINT "release_lifecycle_valid" CHECK ("persona_releases"."lifecycle" IN ('UNPUBLISHED','PUBLISHED','WITHDRAWN','BLOCKED')),
	CONSTRAINT "release_published_shape" CHECK (("persona_releases"."published_at" IS NULL AND "persona_releases"."approved_submission_id" IS NULL AND "persona_releases"."lifecycle"='UNPUBLISHED') OR ("persona_releases"."published_at" IS NOT NULL AND "persona_releases"."approved_submission_id" IS NOT NULL AND "persona_releases"."lifecycle"<>'UNPUBLISHED'))
);
--> statement-breakpoint
CREATE TABLE "release_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"publication" jsonb NOT NULL,
	"changelog" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_status_valid" CHECK ("release_submissions"."status" IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
	CONSTRAINT "submission_bounds" CHECK ("release_submissions"."attempt_number">0 AND "release_submissions"."revision">0 AND octet_length("release_submissions"."snapshot"::text)<=4194304 AND char_length("release_submissions"."changelog") BETWEEN 1 AND 5000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "release_persona_id_unique" ON "persona_releases" USING btree ("persona_id","id");
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_records" ADD CONSTRAINT "moderation_records_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_records" ADD CONSTRAINT "moderation_records_submission_id_release_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."release_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_records" ADD CONSTRAINT "moderation_records_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_public_projection" ADD CONSTRAINT "persona_public_projection_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_public_projection" ADD CONSTRAINT "projection_release_owner_fk" FOREIGN KEY ("persona_id","release_id") REFERENCES "public"."persona_releases"("persona_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_releases" ADD CONSTRAINT "persona_releases_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_submissions" ADD CONSTRAINT "release_submissions_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_submissions" ADD CONSTRAINT "release_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_submissions" ADD CONSTRAINT "submission_release_owner_fk" FOREIGN KEY ("persona_id","release_id") REFERENCES "public"."persona_releases"("persona_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_persona_idx" ON "moderation_records" USING btree ("persona_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "release_persona_version_unique" ON "persona_releases" USING btree ("persona_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_attempt_unique" ON "release_submissions" USING btree ("release_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_persona_id_release_unique" ON "release_submissions" USING btree ("persona_id","id","release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_pending_per_persona" ON "release_submissions" USING btree ("persona_id") WHERE "release_submissions"."status"='PENDING';--> statement-breakpoint
CREATE INDEX "submission_queue_idx" ON "release_submissions" USING btree ("status","created_at");