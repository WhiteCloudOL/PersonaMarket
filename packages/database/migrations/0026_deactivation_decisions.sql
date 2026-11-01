CREATE TABLE "deactivation_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"decision" varchar(16) NOT NULL,
	"reason" text NOT NULL,
	"from_status" varchar(16) NOT NULL,
	"to_status" varchar(16) NOT NULL,
	"from_security_version" integer NOT NULL,
	"to_security_version" integer NOT NULL,
	"revoked_sessions" integer DEFAULT 0 NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deactivation_decision_reason_bounded" CHECK (char_length("deactivation_decisions"."reason") BETWEEN 1 AND 2000 AND "deactivation_decisions"."reason" ~ '[^[:space:]]'),
	CONSTRAINT "deactivation_decision_counts_valid" CHECK ("deactivation_decisions"."revoked_sessions" >= 0),
	CONSTRAINT "deactivation_decision_versions_positive" CHECK ("deactivation_decisions"."from_security_version" > 0 AND "deactivation_decisions"."to_security_version" > 0),
	CONSTRAINT "deactivation_decision_status_valid" CHECK ("deactivation_decisions"."from_status" IN ('active','banned','deactivated') AND "deactivation_decisions"."to_status" IN ('active','banned','deactivated')),
	CONSTRAINT "deactivation_decision_transition_valid" CHECK (
    ("deactivation_decisions"."decision"='approve' AND "deactivation_decisions"."from_status" IN ('active','banned') AND "deactivation_decisions"."to_status"='deactivated' AND "deactivation_decisions"."to_security_version"="deactivation_decisions"."from_security_version"+1)
    OR ("deactivation_decisions"."decision"='reject' AND "deactivation_decisions"."to_status"="deactivation_decisions"."from_status" AND "deactivation_decisions"."to_security_version"="deactivation_decisions"."from_security_version" AND "deactivation_decisions"."revoked_sessions"=0)
  )
);
--> statement-breakpoint
ALTER TABLE "deactivation_decisions" ADD CONSTRAINT "deactivation_decisions_application_id_deactivation_requests_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."deactivation_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deactivation_decisions" ADD CONSTRAINT "deactivation_decisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deactivation_decision_application_unique" ON "deactivation_decisions" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "deactivation_decision_actor_created_idx" ON "deactivation_decisions" USING btree ("actor_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deactivation_user_created_idx" ON "deactivation_requests" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
CREATE TRIGGER deactivation_decisions_append_only
BEFORE UPDATE OR DELETE ON public.deactivation_decisions
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
CREATE FUNCTION public.freeze_deactivation_request() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.status <> 'pending' OR NEW.status NOT IN ('withdrawn','approved','rejected')
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'deactivation application is immutable' USING ERRCODE='23514';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.freeze_deactivation_request() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER deactivation_request_state_guard BEFORE UPDATE ON public.deactivation_requests
FOR EACH ROW EXECUTE FUNCTION public.freeze_deactivation_request();
--> statement-breakpoint
CREATE TRIGGER deactivation_request_no_delete BEFORE DELETE ON public.deactivation_requests
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
CREATE FUNCTION public.check_deactivation_decision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE target_application_id uuid; application_status text; chosen text;
BEGIN
  IF TG_TABLE_NAME='deactivation_requests' THEN target_application_id := NEW.id;
  ELSE target_application_id := NEW.application_id; END IF;
  SELECT r.status INTO application_status FROM public.deactivation_requests r WHERE r.id=target_application_id;
  SELECT d.decision INTO chosen FROM public.deactivation_decisions d WHERE d.application_id=target_application_id;
  IF (application_status IN ('pending','withdrawn') AND chosen IS NOT NULL)
    OR (application_status='approved' AND chosen IS DISTINCT FROM 'approve')
    OR (application_status='rejected' AND chosen IS DISTINCT FROM 'reject') THEN
    RAISE EXCEPTION 'deactivation application decision mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.check_deactivation_decision() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER deactivation_request_decision_guard AFTER INSERT OR UPDATE ON public.deactivation_requests
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_deactivation_decision();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER deactivation_decision_request_guard AFTER INSERT ON public.deactivation_decisions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_deactivation_decision();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='personamarket_app') THEN
    REVOKE UPDATE,DELETE ON public.deactivation_decisions FROM personamarket_app;
    REVOKE DELETE ON public.deactivation_requests FROM personamarket_app;
  END IF;
END $$;
