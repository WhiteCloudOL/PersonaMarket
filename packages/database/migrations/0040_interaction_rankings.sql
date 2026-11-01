ALTER TABLE "ranking_boards" DROP CONSTRAINT "ranking_board_shape";--> statement-breakpoint
ALTER TABLE "ranking_entries" DROP CONSTRAINT "ranking_entry_bounds";--> statement-breakpoint
ALTER TABLE "ranking_generations" DROP CONSTRAINT "ranking_generation_shape";--> statement-breakpoint
ALTER TABLE "ranking_entries" ADD COLUMN "eligible_likes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ranking_entries" ADD COLUMN "eligible_favorites" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "persona_favorites_ranking_idx" ON "persona_favorites" USING btree ("persona_id","first_added_at","user_id") WHERE "persona_favorites"."active";--> statement-breakpoint
CREATE INDEX "persona_likes_ranking_idx" ON "persona_likes" USING btree ("persona_id","first_added_at","user_id") WHERE "persona_likes"."active";--> statement-breakpoint
ALTER TABLE "ranking_boards" ADD CONSTRAINT "ranking_board_shape" CHECK ("ranking_boards"."entry_count" BETWEEN 0 AND 1000 AND "ranking_boards"."platform" IN ('all','maibot','astrbot') AND (
    ("ranking_boards"."kind"='hot' AND "ranking_boards"."window"='7d') OR ("ranking_boards"."kind" IN ('likes','favorites','downloads') AND "ranking_boards"."window" IN ('7d','30d','all')) OR
    ("ranking_boards"."kind"='new' AND "ranking_boards"."window"='30d') OR ("ranking_boards"."kind"='updated' AND "ranking_boards"."window"='all')));--> statement-breakpoint
ALTER TABLE "ranking_entries" ADD CONSTRAINT "ranking_entry_bounds" CHECK ("ranking_entries"."position" BETWEEN 1 AND 1000 AND "ranking_entries"."score" >= 0 AND "ranking_entries"."score" < 9007199254740992 AND "ranking_entries"."eligible_exports" BETWEEN 0 AND 9007199254740991 AND "ranking_entries"."eligible_likes" BETWEEN 0 AND 9007199254740991 AND "ranking_entries"."eligible_favorites" BETWEEN 0 AND 9007199254740991);--> statement-breakpoint
ALTER TABLE "ranking_generations" ADD CONSTRAINT "ranking_generation_shape" CHECK ("ranking_generations"."attempts" >= 0 AND "ranking_generations"."algorithm" IN ('exports-v1','interactions-v1') AND (
    ("ranking_generations"."status"='pending' AND "ranking_generations"."generated_at" IS NULL AND "ranking_generations"."error_code" IS NULL) OR
    ("ranking_generations"."status"='failed' AND "ranking_generations"."generated_at" IS NULL AND "ranking_generations"."error_code" IS NOT NULL) OR
    ("ranking_generations"."status"='completed' AND "ranking_generations"."generated_at" IS NOT NULL AND "ranking_generations"."error_code" IS NULL)));
--> statement-breakpoint
-- 首次关系是窗口排行的事实来源，取消只更新active，不能改时间、换归属或删后重加
CREATE FUNCTION public.guard_interaction_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF ROW(NEW.user_id,NEW.persona_id,NEW.first_added_at)
    IS DISTINCT FROM ROW(OLD.user_id,OLD.persona_id,OLD.first_added_at) THEN
    RAISE EXCEPTION 'INTERACTION_FIRST_RELATION_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER persona_like_identity_guard BEFORE UPDATE ON public.persona_likes
FOR EACH ROW EXECUTE FUNCTION public.guard_interaction_identity();
--> statement-breakpoint
CREATE TRIGGER persona_favorite_identity_guard BEFORE UPDATE ON public.persona_favorites
FOR EACH ROW EXECUTE FUNCTION public.guard_interaction_identity();
--> statement-breakpoint
CREATE TRIGGER persona_like_delete_guard BEFORE DELETE ON public.persona_likes
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
CREATE TRIGGER persona_favorite_delete_guard BEFORE DELETE ON public.persona_favorites
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
REVOKE DELETE ON public.persona_likes,public.persona_favorites FROM personamarket_app;
--> statement-breakpoint
CREATE FUNCTION public.guard_ranking_algorithm_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF ROW(NEW.id,NEW.request_key,NEW.algorithm)
    IS DISTINCT FROM ROW(OLD.id,OLD.request_key,OLD.algorithm) THEN
    RAISE EXCEPTION 'RANKING_ALGORITHM_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ranking_algorithm_identity_guard BEFORE UPDATE ON public.ranking_generations
FOR EACH ROW EXECUTE FUNCTION public.guard_ranking_algorithm_identity();
--> statement-breakpoint
-- 旧导出快照仍可处理和读取，但不能被换标签伪装成新互动榜
CREATE FUNCTION public.guard_ranking_board_algorithm() RETURNS trigger
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
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ranking_board_algorithm_guard BEFORE INSERT OR UPDATE ON public.ranking_boards
FOR EACH ROW EXECUTE FUNCTION public.guard_ranking_board_algorithm();
