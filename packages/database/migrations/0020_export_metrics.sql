CREATE TABLE "export_daily_metrics" (
	"persona_id" uuid NOT NULL,
	"day" date NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"ranking_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "export_daily_metrics_persona_id_day_pk" PRIMARY KEY("persona_id","day"),
	CONSTRAINT "export_daily_counts_valid" CHECK ("export_daily_metrics"."total_count" >= 0 AND "export_daily_metrics"."ranking_count" BETWEEN 0 AND "export_daily_metrics"."total_count")
);
--> statement-breakpoint
CREATE TABLE "export_subject_days" (
	"persona_id" uuid NOT NULL,
	"day" date NOT NULL,
	"subject_hash" varchar(64) NOT NULL,
	"ranking_eligible" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "export_subject_days_persona_id_day_subject_hash_pk" PRIMARY KEY("persona_id","day","subject_hash"),
	CONSTRAINT "export_subject_hash_valid" CHECK ("export_subject_days"."subject_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "export_version_daily_metrics" (
	"persona_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"day" date NOT NULL,
	"format" varchar(32) NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"ranking_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "export_version_daily_metrics_release_id_day_format_pk" PRIMARY KEY("release_id","day","format"),
	CONSTRAINT "export_version_daily_counts_valid" CHECK ("export_version_daily_metrics"."total_count" >= 0 AND "export_version_daily_metrics"."ranking_count" BETWEEN 0 AND "export_version_daily_metrics"."total_count"),
	CONSTRAINT "export_version_daily_format_valid" CHECK ("export_version_daily_metrics"."format" IN ('text','markdown','maibot-toml','astrbot-json','market-json','market-zip'))
);
--> statement-breakpoint
CREATE TABLE "export_version_subject_days" (
	"persona_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"day" date NOT NULL,
	"format" varchar(32) NOT NULL,
	"subject_hash" varchar(64) NOT NULL,
	CONSTRAINT "export_version_subject_days_release_id_day_format_subject_hash_pk" PRIMARY KEY("release_id","day","format","subject_hash"),
	CONSTRAINT "export_version_subject_hash_valid" CHECK ("export_version_subject_days"."subject_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "export_version_subject_format_valid" CHECK ("export_version_subject_days"."format" IN ('text','markdown','maibot-toml','astrbot-json','market-json','market-zip'))
);
--> statement-breakpoint
ALTER TABLE "export_daily_metrics" ADD CONSTRAINT "export_daily_metrics_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_subject_days" ADD CONSTRAINT "export_subject_days_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_version_daily_metrics" ADD CONSTRAINT "export_version_daily_owner_fk" FOREIGN KEY ("persona_id","release_id") REFERENCES "public"."persona_releases"("persona_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_version_subject_days" ADD CONSTRAINT "export_version_subject_owner_fk" FOREIGN KEY ("persona_id","release_id") REFERENCES "public"."persona_releases"("persona_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_daily_window_idx" ON "export_daily_metrics" USING btree ("day","persona_id");--> statement-breakpoint
CREATE INDEX "export_subject_expiry_idx" ON "export_subject_days" USING btree ("day");--> statement-breakpoint
CREATE INDEX "export_version_subject_expiry_idx" ON "export_version_subject_days" USING btree ("day");