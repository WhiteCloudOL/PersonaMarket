-- 旧批次不猜填current事件、终态、次数或过去执行时间；新业务流程显式记录。
ALTER TABLE public.ranking_generations ADD COLUMN current_event_id uuid;
--> statement-breakpoint
CREATE TABLE public.ranking_generation_runs (
  generation_id uuid NOT NULL REFERENCES public.ranking_generations(id) ON DELETE CASCADE,
  event_id uuid PRIMARY KEY REFERENCES public.outbox_events(id),
  manual_round integer NOT NULL,
  origin varchar(24) NOT NULL,
  state varchar(16) NOT NULL DEFAULT 'pending',
  execution_attempts integer,
  automatic_attempt_limit integer NOT NULL DEFAULT 5,
  last_attempted_at timestamptz,
  last_error_code varchar(64),
  terminal_proof varchar(40),
  terminal_observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ranking_run_identity_shape CHECK (manual_round BETWEEN 0 AND 3 AND automatic_attempt_limit BETWEEN 1 AND 100 AND ((manual_round=0 AND origin IN ('created','legacy_adopted')) OR (manual_round>0 AND origin='manual_retry'))),
  CONSTRAINT ranking_run_result_shape CHECK ((
    (state='pending' AND execution_attempts IS NULL AND last_attempted_at IS NULL AND last_error_code IS NULL AND terminal_proof IS NULL AND terminal_observed_at IS NULL) OR
    (state='retrying' AND execution_attempts>=1 AND last_attempted_at IS NOT NULL AND last_error_code IS NOT NULL AND terminal_proof IS NULL AND terminal_observed_at IS NULL) OR
    (state='completed' AND execution_attempts>=1 AND last_attempted_at IS NOT NULL AND last_error_code IS NULL AND terminal_proof='worker_completed' AND terminal_observed_at IS NOT NULL) OR
    (state='failed' AND last_error_code IS NOT NULL AND terminal_observed_at IS NOT NULL AND (
      (terminal_proof='dispatch_exhausted' AND execution_attempts IS NULL AND last_attempted_at IS NULL) OR
      (terminal_proof IN ('worker_final_failure','legacy_retained_final_failure') AND execution_attempts>=automatic_attempt_limit AND last_attempted_at IS NOT NULL)
    ))) IS TRUE)
);
--> statement-breakpoint
CREATE UNIQUE INDEX ranking_run_round_unique ON public.ranking_generation_runs(generation_id,manual_round);
CREATE UNIQUE INDEX ranking_run_generation_event_unique ON public.ranking_generation_runs(generation_id,event_id);
--> statement-breakpoint
ALTER TABLE public.ranking_generations ADD CONSTRAINT ranking_current_run_fk
  FOREIGN KEY(id,current_event_id) REFERENCES public.ranking_generation_runs(generation_id,event_id) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION public.guard_ranking_run_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF ROW(NEW.generation_id,NEW.event_id,NEW.manual_round,NEW.origin,NEW.automatic_attempt_limit,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.generation_id,OLD.event_id,OLD.manual_round,OLD.origin,OLD.automatic_attempt_limit,OLD.created_at) THEN
    RAISE EXCEPTION 'RANKING_RUN_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF OLD.state IN ('completed','failed') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'RANKING_RUN_TERMINAL_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF OLD.execution_attempts IS NOT NULL AND (NEW.execution_attempts IS NULL OR NEW.execution_attempts<OLD.execution_attempts) THEN
    RAISE EXCEPTION 'RANKING_RUN_ATTEMPTS_MONOTONIC' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ranking_run_identity_guard BEFORE UPDATE ON public.ranking_generation_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_ranking_run_identity();
--> statement-breakpoint
CREATE FUNCTION public.check_ranking_manual_run() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.manual_round>0 AND NOT EXISTS(SELECT 1 FROM public.admin_task_retries r
    WHERE r.source='ranking' AND r.task_id=NEW.generation_id AND r.event_id=NEW.event_id AND r.attempt=NEW.manual_round) THEN
    RAISE EXCEPTION 'RANKING_MANUAL_RUN_RECORD_REQUIRED' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ranking_manual_run_record AFTER INSERT ON public.ranking_generation_runs
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_ranking_manual_run();
--> statement-breakpoint
CREATE FUNCTION public.guard_ranking_current_run() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE old_round integer; old_state text; new_round integer;
BEGIN
  IF NEW.current_event_id IS NOT DISTINCT FROM OLD.current_event_id THEN RETURN NEW; END IF;
  IF NEW.current_event_id IS NULL OR OLD.status='completed' THEN
    RAISE EXCEPTION 'RANKING_CURRENT_RUN_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  SELECT manual_round INTO new_round FROM public.ranking_generation_runs WHERE generation_id=NEW.id AND event_id=NEW.current_event_id;
  IF OLD.current_event_id IS NULL THEN
    IF new_round IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'RANKING_BASELINE_RUN_REQUIRED' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT manual_round,state INTO old_round,old_state FROM public.ranking_generation_runs WHERE generation_id=OLD.id AND event_id=OLD.current_event_id;
    IF old_state IS DISTINCT FROM 'failed' OR new_round IS DISTINCT FROM old_round+1 OR NEW.status<>'pending' THEN
      RAISE EXCEPTION 'RANKING_CURRENT_RUN_TRANSITION' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ranking_current_run_guard BEFORE UPDATE ON public.ranking_generations
FOR EACH ROW EXECUTE FUNCTION public.guard_ranking_current_run();
