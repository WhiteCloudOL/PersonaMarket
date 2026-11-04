CREATE TABLE "email_verification_codes" (
	"scope_hash" varchar(64) PRIMARY KEY NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"event_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "email_verification_codes_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "email_verification_codes" ADD CONSTRAINT "email_verification_codes_event_id_outbox_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_verification_codes_expiry_idx" ON "email_verification_codes" USING btree ("expires_at");