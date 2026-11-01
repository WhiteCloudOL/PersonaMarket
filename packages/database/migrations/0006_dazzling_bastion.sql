CREATE TABLE "deactivation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deactivation_status_valid" CHECK ("deactivation_requests"."status" IN ('pending','withdrawn','approved','rejected')),
	CONSTRAINT "deactivation_reason_valid" CHECK (char_length("deactivation_requests"."reason") BETWEEN 1 AND 500 AND btrim("deactivation_requests"."reason")<>'')
);
--> statement-breakpoint
ALTER TABLE "deactivation_requests" ADD CONSTRAINT "deactivation_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deactivation_pending_user_unique" ON "deactivation_requests" USING btree ("user_id") WHERE "deactivation_requests"."status"='pending';