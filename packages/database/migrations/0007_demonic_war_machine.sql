CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_drafts" (
	"persona_id" uuid PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_revision_positive" CHECK ("persona_drafts"."revision">0),
	CONSTRAINT "draft_payload_bounded" CHECK (octet_length("persona_drafts"."payload"::text)<=4194304)
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"platform" varchar(16) NOT NULL,
	"owner_visibility" varchar(16) DEFAULT 'listed' NOT NULL,
	"moderation_state" varchar(16) DEFAULT 'normal' NOT NULL,
	"published_release_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persona_platform_valid" CHECK ("personas"."platform" IN ('maibot','astrbot')),
	CONSTRAINT "persona_visibility_valid" CHECK ("personas"."owner_visibility" IN ('listed','hidden')),
	CONSTRAINT "persona_moderation_valid" CHECK ("personas"."moderation_state" IN ('normal','blocked'))
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "persona_drafts" ADD CONSTRAINT "persona_drafts_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "personas_owner_updated_idx" ON "personas" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "personas_id_owner_unique" ON "personas" USING btree ("id","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_unique" ON "tags" USING btree ("name");