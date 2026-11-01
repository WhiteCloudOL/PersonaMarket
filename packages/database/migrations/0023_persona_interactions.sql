-- New community settings preserve every existing customized group
INSERT INTO site_settings(key,value) VALUES ('community','{"likesEnabled":true,"favoritesEnabled":true}'::jsonb) ON CONFLICT(key) DO NOTHING;
--> statement-breakpoint
CREATE TABLE "persona_favorites" (
	"user_id" uuid NOT NULL,
	"persona_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"first_added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persona_favorites_user_id_persona_id_pk" PRIMARY KEY("user_id","persona_id"),
	CONSTRAINT "persona_favorites_timestamps" CHECK ("persona_favorites"."updated_at" >= "persona_favorites"."first_added_at")
);
--> statement-breakpoint
CREATE TABLE "persona_likes" (
	"user_id" uuid NOT NULL,
	"persona_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"first_added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persona_likes_user_id_persona_id_pk" PRIMARY KEY("user_id","persona_id"),
	CONSTRAINT "persona_likes_timestamps" CHECK ("persona_likes"."updated_at" >= "persona_likes"."first_added_at")
);
--> statement-breakpoint
ALTER TABLE "persona_favorites" ADD CONSTRAINT "persona_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_favorites" ADD CONSTRAINT "persona_favorites_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_likes" ADD CONSTRAINT "persona_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_likes" ADD CONSTRAINT "persona_likes_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "persona_favorites_active_persona_idx" ON "persona_favorites" USING btree ("persona_id") WHERE "persona_favorites"."active";--> statement-breakpoint
CREATE INDEX "persona_favorites_user_saved_idx" ON "persona_favorites" USING btree ("user_id","first_added_at" DESC NULLS LAST,"persona_id" DESC NULLS LAST) WHERE "persona_favorites"."active";--> statement-breakpoint
CREATE INDEX "persona_likes_active_persona_idx" ON "persona_likes" USING btree ("persona_id") WHERE "persona_likes"."active";
