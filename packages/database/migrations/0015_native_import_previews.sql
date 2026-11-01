CREATE TABLE "persona_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"format" varchar(32) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"confirmation_hash" varchar(64),
	"result_persona_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_payload_bounded" CHECK (octet_length("persona_imports"."payload"::text)<=2097152),
	CONSTRAINT "import_result_consistent" CHECK (("persona_imports"."consumed_at" IS NULL AND "persona_imports"."result_persona_id" IS NULL AND "persona_imports"."confirmation_hash" IS NULL) OR ("persona_imports"."consumed_at" IS NOT NULL AND "persona_imports"."result_persona_id" IS NOT NULL AND "persona_imports"."confirmation_hash" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "persona_imports" ADD CONSTRAINT "persona_imports_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_imports" ADD CONSTRAINT "persona_imports_result_persona_id_personas_id_fk" FOREIGN KEY ("result_persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "imports_owner_expiry_idx" ON "persona_imports" USING btree ("owner_id","expires_at");