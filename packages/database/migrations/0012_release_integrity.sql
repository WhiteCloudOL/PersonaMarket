-- 冻结版本与审计记录，并以延迟约束检查同一事务的公开指针。
ALTER TABLE personas ADD CONSTRAINT persona_current_release_fk FOREIGN KEY(id,published_release_id) REFERENCES persona_releases(persona_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE persona_releases ADD CONSTRAINT release_approved_submission_fk FOREIGN KEY(persona_id,approved_submission_id,id) REFERENCES release_submissions(persona_id,id,release_id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX one_approved_submission_per_release ON release_submissions(release_id) WHERE status='APPROVED';
--> statement-breakpoint
CREATE FUNCTION freeze_submission_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.persona_id,NEW.release_id,NEW.submitted_by,NEW.attempt_number,NEW.snapshot,NEW.publication,NEW.changelog,NEW.content_hash,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.persona_id,OLD.release_id,OLD.submitted_by,OLD.attempt_number,OLD.snapshot,OLD.publication,OLD.changelog,OLD.content_hash,OLD.created_at) THEN
    RAISE EXCEPTION 'submission content is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status<>'PENDING' OR NEW.status NOT IN ('APPROVED','REJECTED','WITHDRAWN') OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'invalid submission transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER freeze_submission BEFORE UPDATE ON release_submissions FOR EACH ROW EXECUTE FUNCTION freeze_submission_content();
--> statement-breakpoint
CREATE FUNCTION freeze_release_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.persona_id,NEW.version,NEW.major,NEW.minor,NEW.patch,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.persona_id,OLD.version,OLD.major,OLD.minor,OLD.patch,OLD.created_at)
    OR (OLD.published_at IS NOT NULL AND (NEW.published_at,NEW.approved_submission_id) IS DISTINCT FROM (OLD.published_at,OLD.approved_submission_id)) THEN
    RAISE EXCEPTION 'release identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER freeze_release BEFORE UPDATE ON persona_releases FOR EACH ROW EXECUTE FUNCTION freeze_release_identity();
--> statement-breakpoint
CREATE FUNCTION check_persona_current_release() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE current_id uuid;
BEGIN
  SELECT published_release_id INTO current_id FROM public.personas WHERE id=NEW.id;
  IF current_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.persona_releases r JOIN public.release_submissions s ON s.id=r.approved_submission_id AND s.persona_id=r.persona_id AND s.release_id=r.id WHERE r.id=current_id AND r.persona_id=NEW.id AND r.lifecycle='PUBLISHED' AND s.status='APPROVED') THEN
    RAISE EXCEPTION 'invalid public pointer' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER persona_pointer_guard AFTER INSERT OR UPDATE ON personas DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_persona_current_release();
--> statement-breakpoint
CREATE FUNCTION check_release_approval() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.persona_releases r WHERE r.id=NEW.id AND r.published_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.release_submissions s WHERE s.id=r.approved_submission_id AND s.persona_id=r.persona_id AND s.release_id=r.id AND s.status='APPROVED')) THEN
    RAISE EXCEPTION 'release requires approval' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.personas p JOIN public.persona_releases r ON r.id=p.published_release_id WHERE r.id=NEW.id AND r.lifecycle<>'PUBLISHED') THEN
    RAISE EXCEPTION 'invalid release public state' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER release_approval_guard AFTER INSERT OR UPDATE ON persona_releases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_release_approval();
--> statement-breakpoint
CREATE FUNCTION deny_record_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only record' USING ERRCODE='23514'; END $$;
CREATE TRIGGER moderation_append_only BEFORE UPDATE OR DELETE ON moderation_records FOR EACH ROW EXECUTE FUNCTION deny_record_mutation();
CREATE TRIGGER submission_no_delete BEFORE DELETE ON release_submissions FOR EACH ROW EXECUTE FUNCTION deny_record_mutation();
CREATE TRIGGER release_no_delete BEFORE DELETE ON persona_releases FOR EACH ROW EXECUTE FUNCTION deny_record_mutation();
CREATE TRIGGER asset_immutable BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION deny_record_mutation();
--> statement-breakpoint
CREATE FUNCTION check_asset_reference() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.assets a JOIN public.personas p ON p.owner_id=a.owner_id WHERE a.id=NEW.asset_id AND p.id=NEW.persona_id AND a.purpose=NEW.purpose) THEN
    RAISE EXCEPTION 'asset reference ownership mismatch' USING ERRCODE='23514';
  END IF;
  IF (NEW.resource_type='draft' AND NEW.resource_id<>NEW.persona_id) OR (NEW.resource_type='submission' AND NOT EXISTS(SELECT 1 FROM public.release_submissions s WHERE s.id=NEW.resource_id AND s.persona_id=NEW.persona_id)) THEN
    RAISE EXCEPTION 'asset reference target mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_reference_guard BEFORE INSERT OR UPDATE ON asset_references FOR EACH ROW EXECUTE FUNCTION check_asset_reference();
--> statement-breakpoint
CREATE FUNCTION freeze_submission_assets() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.resource_type='submission' THEN
    RAISE EXCEPTION 'submission assets are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.resource_type='submission' AND NOT EXISTS(SELECT 1 FROM public.release_submissions s WHERE s.id=NEW.resource_id AND s.status='PENDING') THEN
    RAISE EXCEPTION 'submission asset links require a pending snapshot' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER freeze_submission_asset_links BEFORE INSERT OR UPDATE OR DELETE ON asset_references FOR EACH ROW EXECUTE FUNCTION freeze_submission_assets();
