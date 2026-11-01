ALTER TABLE "ranking_boards" DROP CONSTRAINT "ranking_board_shape";--> statement-breakpoint
ALTER TABLE "ranking_generations" DROP CONSTRAINT "ranking_generation_shape";--> statement-breakpoint
ALTER TABLE "ranking_generations" ADD COLUMN "settings_revision" integer;--> statement-breakpoint
ALTER TABLE "ranking_generations" ADD COLUMN "definition" jsonb;--> statement-breakpoint
ALTER TABLE "ranking_boards" ADD CONSTRAINT "ranking_board_shape" CHECK ("ranking_boards"."entry_count" BETWEEN 0 AND 1000 AND "ranking_boards"."platform" IN ('all','maibot','astrbot') AND (
    ("ranking_boards"."kind"='hot' AND "ranking_boards"."window"='7d') OR ("ranking_boards"."kind" IN ('likes','favorites','downloads') AND "ranking_boards"."window" IN ('7d','30d','all')) OR
    ("ranking_boards"."kind"='new' AND "ranking_boards"."window" IN ('30d','newcomer')) OR ("ranking_boards"."kind"='updated' AND "ranking_boards"."window"='all')));--> statement-breakpoint
ALTER TABLE "ranking_generations" ADD CONSTRAINT "ranking_definition_shape" CHECK (((("ranking_generations"."algorithm"='interactions-v2' AND "ranking_generations"."settings_revision">=1 AND jsonb_typeof("ranking_generations"."definition")='object'
        AND "ranking_generations"."definition"->'settingsRevision'=to_jsonb("ranking_generations"."settings_revision")
        AND "ranking_generations"."definition"->'halfLifeSeconds'='604800'::jsonb AND jsonb_typeof("ranking_generations"."definition"->'settings')='object')
        OR ("ranking_generations"."algorithm" IN ('exports-v1','interactions-v1') AND "ranking_generations"."settings_revision" IS NULL AND "ranking_generations"."definition" IS NULL))) IS TRUE);--> statement-breakpoint
ALTER TABLE "ranking_generations" ADD CONSTRAINT "ranking_generation_shape" CHECK ("ranking_generations"."attempts" >= 0 AND "ranking_generations"."algorithm" IN ('exports-v1','interactions-v1','interactions-v2') AND (
    ("ranking_generations"."status"='pending' AND "ranking_generations"."generated_at" IS NULL AND "ranking_generations"."error_code" IS NULL) OR
    ("ranking_generations"."status"='failed' AND "ranking_generations"."generated_at" IS NULL AND "ranking_generations"."error_code" IS NOT NULL) OR
    ("ranking_generations"."status"='completed' AND "ranking_generations"."generated_at" IS NOT NULL AND "ranking_generations"."error_code" IS NULL)));
--> statement-breakpoint
INSERT INTO site_settings(key,value,revision) VALUES('rankings','{"weights":{"likes":3,"favorites":4,"exports":1},"refreshMinutes":5,"entryLimit":1000,"newcomerWindowDays":30}'::jsonb,1) ON CONFLICT(key) DO NOTHING;
--> statement-breakpoint
-- 旧批次不填入今日运营配置；新批次在排队时冻结定义与修订
CREATE OR REPLACE FUNCTION public.guard_ranking_algorithm_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF ROW(NEW.id,NEW.request_key,NEW.algorithm,NEW.settings_revision,NEW.definition,NEW.requested_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.request_key,OLD.algorithm,OLD.settings_revision,OLD.definition,OLD.requested_at) THEN
    RAISE EXCEPTION 'RANKING_ALGORITHM_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_ranking_board_algorithm() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE generation_algorithm text;
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.generation_id,NEW.kind,NEW."window",NEW.platform)
    IS DISTINCT FROM ROW(OLD.generation_id,OLD.kind,OLD."window",OLD.platform) THEN
    RAISE EXCEPTION 'RANKING_BOARD_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  SELECT algorithm INTO generation_algorithm FROM public.ranking_generations WHERE id=NEW.generation_id;
  IF generation_algorithm='exports-v1' AND NEW.kind IN ('likes','favorites') THEN
    RAISE EXCEPTION 'RANKING_LEGACY_BOARD_UNSUPPORTED' USING ERRCODE='23514';
  END IF;
  IF generation_algorithm<>'interactions-v2' AND NEW."window"='newcomer' THEN
    RAISE EXCEPTION 'RANKING_CONFIGURED_WINDOW_UNSUPPORTED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
