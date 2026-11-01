CREATE TABLE "ranking_boards" (
	"generation_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"window" varchar(8) NOT NULL,
	"platform" varchar(16) NOT NULL,
	"entry_count" integer NOT NULL,
	"capped" boolean NOT NULL,
	CONSTRAINT "ranking_boards_generation_id_kind_window_platform_pk" PRIMARY KEY("generation_id","kind","window","platform"),
	CONSTRAINT "ranking_board_shape" CHECK ("ranking_boards"."entry_count" BETWEEN 0 AND 1000 AND "ranking_boards"."platform" IN ('all','maibot','astrbot') AND (
    ("ranking_boards"."kind"='hot' AND "ranking_boards"."window"='7d') OR ("ranking_boards"."kind"='downloads' AND "ranking_boards"."window" IN ('7d','30d','all')) OR
    ("ranking_boards"."kind"='new' AND "ranking_boards"."window"='30d') OR ("ranking_boards"."kind"='updated' AND "ranking_boards"."window"='all')))
);
--> statement-breakpoint
CREATE TABLE "ranking_entries" (
	"generation_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"window" varchar(8) NOT NULL,
	"platform" varchar(16) NOT NULL,
	"position" integer NOT NULL,
	"persona_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"score" double precision NOT NULL,
	"eligible_exports" bigint NOT NULL,
	CONSTRAINT "ranking_entries_generation_id_kind_window_platform_position_pk" PRIMARY KEY("generation_id","kind","window","platform","position"),
	CONSTRAINT "ranking_entry_bounds" CHECK ("ranking_entries"."position" BETWEEN 1 AND 1000 AND "ranking_entries"."score" >= 0 AND "ranking_entries"."score" < 9007199254740992 AND "ranking_entries"."eligible_exports" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "ranking_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_key" varchar(96) NOT NULL,
	"algorithm" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(64),
	CONSTRAINT "ranking_generation_shape" CHECK ("ranking_generations"."attempts" >= 0 AND "ranking_generations"."algorithm"='exports-v1' AND (
    ("ranking_generations"."status"='pending' AND "ranking_generations"."generated_at" IS NULL AND "ranking_generations"."error_code" IS NULL) OR
    ("ranking_generations"."status"='failed' AND "ranking_generations"."generated_at" IS NULL AND "ranking_generations"."error_code" IS NOT NULL) OR
    ("ranking_generations"."status"='completed' AND "ranking_generations"."generated_at" IS NOT NULL AND "ranking_generations"."error_code" IS NULL)))
);
--> statement-breakpoint
ALTER TABLE "ranking_boards" ADD CONSTRAINT "ranking_boards_generation_id_ranking_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."ranking_generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_entries" ADD CONSTRAINT "ranking_entry_board_fk" FOREIGN KEY ("generation_id","kind","window","platform") REFERENCES "public"."ranking_boards"("generation_id","kind","window","platform") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_entries" ADD CONSTRAINT "ranking_entry_release_owner_fk" FOREIGN KEY ("persona_id","release_id") REFERENCES "public"."persona_releases"("persona_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ranking_board_persona_unique" ON "ranking_entries" USING btree ("generation_id","kind","window","platform","persona_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ranking_request_unique" ON "ranking_generations" USING btree ("request_key");--> statement-breakpoint
CREATE INDEX "ranking_latest_completed_idx" ON "ranking_generations" USING btree ("generated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "ranking_generations"."status"='completed';