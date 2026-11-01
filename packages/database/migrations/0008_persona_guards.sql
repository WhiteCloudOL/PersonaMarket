-- Custom SQL migration file, put your code below! --
INSERT INTO categories(id,name) VALUES ('00000000-0000-4000-8000-000000000001','通用') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO site_settings(key,value) VALUES ('contentLimits','{"maibotField":2000,"astrbotPrompt":20000,"dialoguePairs":20,"dialogueMessage":2000}'),('submissions','{"enabled":true}') ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION persona_fixed_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.platform IS DISTINCT FROM OLD.platform OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'persona identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER persona_identity_guard BEFORE UPDATE ON personas FOR EACH ROW EXECUTE FUNCTION persona_fixed_identity();
--> statement-breakpoint
CREATE FUNCTION persona_draft_platform_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payload->>'platform' IS DISTINCT FROM (SELECT platform FROM personas WHERE id=NEW.persona_id) THEN
    RAISE EXCEPTION 'draft platform mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER persona_draft_guard BEFORE INSERT OR UPDATE ON persona_drafts FOR EACH ROW EXECUTE FUNCTION persona_draft_platform_guard();
