CREATE TABLE "mail_deliveries" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(16) NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"error_code" varchar(32),
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "mail_delivery_bounds" CHECK ("mail_deliveries"."attempts" BETWEEN 1 AND 5 AND "mail_deliveries"."payload_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "mail_delivery_shape" CHECK ((
    ("mail_deliveries"."status"='sending' AND "mail_deliveries"."error_code" IS NULL AND "mail_deliveries"."completed_at" IS NULL) OR
    ("mail_deliveries"."status"='sent' AND "mail_deliveries"."error_code" IS NULL AND "mail_deliveries"."completed_at" IS NOT NULL) OR
    ("mail_deliveries"."status" IN ('failed','uncertain') AND "mail_deliveries"."error_code" IS NOT NULL AND "mail_deliveries"."error_code" IN (
      'MAIL_SEND_FAILED','MAIL_RESULT_UNCERTAIN','MAIL_RECEIPT_UNCERTAIN','MAIL_PAYLOAD_INVALID','MAIL_NOT_CONFIGURED'
    ) AND "mail_deliveries"."completed_at" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "mail_deliveries" ADD CONSTRAINT "mail_deliveries_event_id_outbox_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_delivery_failure_idx" ON "mail_deliveries" USING btree ("status","updated_at");
--> statement-breakpoint
CREATE FUNCTION public.guard_mail_delivery_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'sending' OR NEW.attempts<>1 OR NOT EXISTS(
      SELECT 1 FROM public.outbox_events WHERE id=NEW.event_id AND topic='auth.email'
    ) THEN
      RAISE EXCEPTION 'INVALID_MAIL_DELIVERY_START' USING ERRCODE='23514';
    END IF;
  ELSE
    IF ROW(NEW.event_id,NEW.payload_hash,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.event_id,OLD.payload_hash,OLD.created_at)
      OR OLD.status IN ('sent','uncertain') THEN
      RAISE EXCEPTION 'MAIL_DELIVERY_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    IF (OLD.status='sending' AND (
      NEW.status NOT IN ('sent','failed','uncertain') OR NEW.attempts<>OLD.attempts
    )) OR (OLD.status='failed' AND (
      NEW.status<>'sending' OR NEW.attempts<>OLD.attempts+1
    )) THEN
      RAISE EXCEPTION 'INVALID_MAIL_DELIVERY_TRANSITION' USING ERRCODE='23514';
    END IF;
    IF NEW.status='sent' AND NOT EXISTS(
      SELECT 1 FROM public.processed_events WHERE consumer='auth-email' AND event_id=NEW.event_id
    ) THEN
      RAISE EXCEPTION 'MAIL_RECEIPT_REQUIRED' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER mail_delivery_transition_guard BEFORE INSERT OR UPDATE ON public.mail_deliveries
FOR EACH ROW EXECUTE FUNCTION public.guard_mail_delivery_transition();
--> statement-breakpoint
CREATE TRIGGER mail_delivery_delete_guard BEFORE DELETE ON public.mail_deliveries
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
REVOKE DELETE ON public.mail_deliveries FROM personamarket_app;
--> statement-breakpoint
CREATE FUNCTION public.guard_started_mail_payload() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF ROW(NEW.topic,NEW.payload) IS DISTINCT FROM ROW(OLD.topic,OLD.payload)
    AND EXISTS(SELECT 1 FROM public.mail_deliveries WHERE event_id=OLD.id) THEN
    RAISE EXCEPTION 'STARTED_MAIL_PAYLOAD_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER started_mail_payload_guard BEFORE UPDATE OF topic,payload ON public.outbox_events
FOR EACH ROW EXECUTE FUNCTION public.guard_started_mail_payload();
