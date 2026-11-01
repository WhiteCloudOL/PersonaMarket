CREATE TABLE "persona_curations" (
	"persona_id" uuid PRIMARY KEY NOT NULL,
	"official" boolean DEFAULT false NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"updated_by_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "persona_curations" ADD CONSTRAINT "persona_curations_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_curations" ADD CONSTRAINT "persona_curations_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "persona_curations_official_idx" ON "persona_curations" USING btree ("persona_id") WHERE "persona_curations"."official";--> statement-breakpoint
CREATE INDEX "persona_curations_featured_idx" ON "persona_curations" USING btree ("persona_id") WHERE "persona_curations"."featured";