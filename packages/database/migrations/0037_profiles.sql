CREATE TABLE "profile_drafts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"display_name" varchar(60) NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"avatar_asset_id" uuid,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "profile_draft_revision_positive" CHECK ("profile_drafts"."revision">0),
	CONSTRAINT "profile_draft_name_bounded" CHECK (char_length("profile_drafts"."display_name") BETWEEN 1 AND 60 AND "profile_drafts"."display_name"=btrim("profile_drafts"."display_name") AND "profile_drafts"."display_name" !~ '[[:cntrl:]]' AND "profile_drafts"."display_name" ~ '[^[:space:]]'),
	CONSTRAINT "profile_draft_bio_bounded" CHECK (char_length("profile_drafts"."bio")<=1000),
	CONSTRAINT "profile_draft_links_bounded" CHECK (CASE WHEN jsonb_typeof("profile_drafts"."links")='array' THEN jsonb_array_length("profile_drafts"."links")<=5 AND octet_length("profile_drafts"."links"::text)<=20000 ELSE false END)
);
--> statement-breakpoint
CREATE TABLE "profile_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"submission_id" uuid,
	"actor_id" uuid NOT NULL,
	"action" varchar(16) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"self_review" boolean DEFAULT false NOT NULL,
	"from_profile_revision" integer NOT NULL,
	"to_profile_revision" integer NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "profile_record_action_valid" CHECK ("profile_records"."action" IN ('submit','withdraw','approve','reject','hide','restore')),
	CONSTRAINT "profile_record_reason_bounded" CHECK (char_length("profile_records"."reason")<=2000 AND ("profile_records"."action" NOT IN ('reject','hide','restore') OR "profile_records"."reason" ~ '[^[:space:]]') AND (NOT "profile_records"."self_review" OR "profile_records"."reason" ~ '[^[:space:]]')),
	CONSTRAINT "profile_record_revision_shape" CHECK ("profile_records"."from_profile_revision">0 AND (("profile_records"."action" IN ('submit','withdraw','reject') AND "profile_records"."to_profile_revision"="profile_records"."from_profile_revision") OR ("profile_records"."action" IN ('approve','hide','restore') AND "profile_records"."to_profile_revision"="profile_records"."from_profile_revision"+1))),
	CONSTRAINT "profile_record_submission_required" CHECK ("profile_records"."action" IN ('hide','restore') OR "profile_records"."submission_id" IS NOT NULL),
	CONSTRAINT "profile_record_owner_action" CHECK ("profile_records"."action" NOT IN ('submit','withdraw') OR ("profile_records"."actor_id"="profile_records"."user_id" AND NOT "profile_records"."self_review"))
);
--> statement-breakpoint
CREATE TABLE "profile_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"draft_revision" integer NOT NULL,
	"display_name" varchar(60) NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"avatar_asset_id" uuid,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "profile_submission_revision_positive" CHECK ("profile_submissions"."revision">0 AND "profile_submissions"."draft_revision">0),
	CONSTRAINT "profile_submission_name_bounded" CHECK (char_length("profile_submissions"."display_name") BETWEEN 1 AND 60 AND "profile_submissions"."display_name"=btrim("profile_submissions"."display_name") AND "profile_submissions"."display_name" !~ '[[:cntrl:]]' AND "profile_submissions"."display_name" ~ '[^[:space:]]'),
	CONSTRAINT "profile_submission_bio_bounded" CHECK (char_length("profile_submissions"."bio")<=1000),
	CONSTRAINT "profile_submission_links_bounded" CHECK (CASE WHEN jsonb_typeof("profile_submissions"."links")='array' THEN jsonb_array_length("profile_submissions"."links")<=5 AND octet_length("profile_submissions"."links"::text)<=20000 ELSE false END),
	CONSTRAINT "profile_submission_hash_valid" CHECK ("profile_submissions"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "profile_submission_status_valid" CHECK ("profile_submissions"."status" IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
	CONSTRAINT "profile_submission_decision_shape" CHECK (("profile_submissions"."status"='PENDING' AND "profile_submissions"."reason" IS NULL AND "profile_submissions"."reviewed_by" IS NULL AND "profile_submissions"."reviewed_at" IS NULL AND "profile_submissions"."withdrawn_at" IS NULL) OR ("profile_submissions"."status" IN ('APPROVED','REJECTED') AND "profile_submissions"."reason" IS NOT NULL AND char_length("profile_submissions"."reason")<=2000 AND "profile_submissions"."reviewed_by" IS NOT NULL AND "profile_submissions"."reviewed_at" IS NOT NULL AND "profile_submissions"."withdrawn_at" IS NULL AND ("profile_submissions"."status"<>'REJECTED' OR "profile_submissions"."reason" ~ '[^[:space:]]')) OR ("profile_submissions"."status"='WITHDRAWN' AND "profile_submissions"."reason" IS NULL AND "profile_submissions"."reviewed_by" IS NULL AND "profile_submissions"."reviewed_at" IS NULL AND "profile_submissions"."withdrawn_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"visibility" varchar(16) DEFAULT 'normal' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"published_submission_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "user_profile_revision_positive" CHECK ("user_profiles"."revision">0),
	CONSTRAINT "user_profile_visibility_valid" CHECK ("user_profiles"."visibility" IN ('normal','hidden'))
);
--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "asset_purpose_valid";--> statement-breakpoint
CREATE UNIQUE INDEX "profile_submission_owner_unique" ON "profile_submissions" USING btree ("user_id","id");--> statement-breakpoint
ALTER TABLE "profile_drafts" ADD CONSTRAINT "profile_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_drafts" ADD CONSTRAINT "profile_drafts_avatar_asset_id_assets_id_fk" FOREIGN KEY ("avatar_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_records" ADD CONSTRAINT "profile_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_records" ADD CONSTRAINT "profile_records_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_records" ADD CONSTRAINT "profile_record_submission_owner_fk" FOREIGN KEY ("user_id","submission_id") REFERENCES "public"."profile_submissions"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_submissions" ADD CONSTRAINT "profile_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_submissions" ADD CONSTRAINT "profile_submissions_avatar_asset_id_assets_id_fk" FOREIGN KEY ("avatar_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_submissions" ADD CONSTRAINT "profile_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "profile_published_submission_owner_fk" FOREIGN KEY ("user_id","published_submission_id") REFERENCES "public"."profile_submissions"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_record_submission_action_unique" ON "profile_records" USING btree ("submission_id","action") WHERE "profile_records"."action" IN ('submit','withdraw','approve','reject');--> statement-breakpoint
CREATE UNIQUE INDEX "profile_record_state_revision_unique" ON "profile_records" USING btree ("user_id","to_profile_revision") WHERE "profile_records"."action" IN ('approve','hide','restore');--> statement-breakpoint
CREATE INDEX "profile_record_owner_created_idx" ON "profile_records" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "one_pending_profile_per_owner" ON "profile_submissions" USING btree ("user_id") WHERE "profile_submissions"."status"='PENDING';--> statement-breakpoint
CREATE INDEX "profile_submission_owner_created_idx" ON "profile_submissions" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "profile_submission_queue_idx" ON "profile_submissions" USING btree ("created_at","id") WHERE "profile_submissions"."status"='PENDING';--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "asset_purpose_valid" CHECK ("assets"."purpose" IN ('content','evidence','avatar'));
--> statement-breakpoint
-- 原始文本由契约完整校验，数据库另保护结构、硬边界和头像归属
CREATE FUNCTION public.validate_profile_content(owner_id uuid, avatar_id uuid, body text, public_links jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  item jsonb;
  label text;
  address text;
BEGIN
  IF char_length(body)>1000 OR translate(body,E'\t\r\n','') ~ '[[:cntrl:]]' OR
     jsonb_typeof(public_links) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'PROFILE_CONTENT_INVALID' USING ERRCODE='23514';
  END IF;
  IF jsonb_array_length(public_links)>5 OR octet_length(public_links::text)>20000 THEN
    RAISE EXCEPTION 'PROFILE_LINKS_LIMIT' USING ERRCODE='23514';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(public_links) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'PROFILE_LINK_INVALID' USING ERRCODE='23514';
    END IF;
    IF item-ARRAY['label','url']::text[]<>'{}'::jsonb OR
       jsonb_typeof(item->'label') IS DISTINCT FROM 'string' OR
       jsonb_typeof(item->'url') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'PROFILE_LINK_INVALID' USING ERRCODE='23514';
    END IF;
    label:=item->>'label';
    address:=item->>'url';
    IF char_length(label) NOT BETWEEN 1 AND 40 OR label<>btrim(label) OR
       label ~ '[[:cntrl:]]' OR label !~ '[^[:space:]]' OR
       char_length(address)>2048 OR address !~* '^https?://[^/?#]+' OR
       address ~ '[[:space:][:cntrl:]]' OR position(chr(92) in address)>0 THEN
      RAISE EXCEPTION 'PROFILE_LINK_INVALID' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF avatar_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.assets WHERE id=avatar_id AND assets.owner_id=validate_profile_content.owner_id
    AND purpose='avatar' AND mime='image/webp'
  ) THEN
    RAISE EXCEPTION 'PROFILE_AVATAR_NOT_OWNED' USING ERRCODE='23514';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.guard_profile_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>1 THEN
      RAISE EXCEPTION 'PROFILE_DRAFT_INITIAL_REVISION' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'PROFILE_DRAFT_REVISION_CONFLICT' USING ERRCODE='23514';
  END IF;
  PERFORM public.validate_profile_content(NEW.user_id,NEW.avatar_asset_id,NEW.bio,NEW.links);
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER profile_draft_write_guard BEFORE INSERT OR UPDATE ON public.profile_drafts
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_draft();
--> statement-breakpoint
CREATE FUNCTION public.guard_profile_submission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  draft public.profile_drafts;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>1 OR NEW.status<>'PENDING' THEN
      RAISE EXCEPTION 'PROFILE_SUBMISSION_INITIAL_STATE' USING ERRCODE='23514';
    END IF;
    SELECT * INTO draft FROM public.profile_drafts WHERE user_id=NEW.user_id;
    IF NOT FOUND OR draft.revision<>NEW.draft_revision OR
       ROW(NEW.display_name,NEW.bio,NEW.avatar_asset_id,NEW.links) IS DISTINCT FROM
       ROW(draft.display_name,draft.bio,draft.avatar_asset_id,draft.links) THEN
      RAISE EXCEPTION 'PROFILE_SUBMISSION_DRAFT_CHANGED' USING ERRCODE='23514';
    END IF;
  ELSE
    IF ROW(NEW.id,NEW.user_id,NEW.draft_revision,NEW.display_name,NEW.bio,NEW.avatar_asset_id,NEW.links,NEW.content_hash,NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.id,OLD.user_id,OLD.draft_revision,OLD.display_name,OLD.bio,OLD.avatar_asset_id,OLD.links,OLD.content_hash,OLD.created_at) THEN
      RAISE EXCEPTION 'PROFILE_SNAPSHOT_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    IF OLD.status<>'PENDING' OR NEW.status NOT IN ('APPROVED','REJECTED','WITHDRAWN') OR NEW.revision<>OLD.revision+1 THEN
      RAISE EXCEPTION 'PROFILE_SUBMISSION_TRANSITION' USING ERRCODE='23514';
    END IF;
  END IF;
  PERFORM public.validate_profile_content(NEW.user_id,NEW.avatar_asset_id,NEW.bio,NEW.links);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER profile_submission_write_guard BEFORE INSERT OR UPDATE ON public.profile_submissions
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_submission();
--> statement-breakpoint
CREATE FUNCTION public.guard_user_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>1 OR NEW.published_submission_id IS NOT NULL OR NEW.visibility<>'normal' THEN
      RAISE EXCEPTION 'USER_PROFILE_INITIAL_STATE' USING ERRCODE='23514';
    END IF;
  ELSIF ROW(NEW.user_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.user_id,OLD.created_at) OR
        NEW.revision<>OLD.revision+1 OR
        ROW(NEW.published_submission_id,NEW.visibility) IS NOT DISTINCT FROM ROW(OLD.published_submission_id,OLD.visibility) THEN
    RAISE EXCEPTION 'USER_PROFILE_REVISION_CONFLICT' USING ERRCODE='23514';
  END IF;
  IF NEW.published_submission_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profile_submissions WHERE id=NEW.published_submission_id
    AND user_id=NEW.user_id AND status='APPROVED'
  ) THEN
    RAISE EXCEPTION 'USER_PROFILE_UNAPPROVED_POINTER' USING ERRCODE='23514';
  END IF;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_profile_write_guard BEFORE INSERT OR UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_user_profile();
--> statement-breakpoint
CREATE TRIGGER profile_draft_delete_guard BEFORE DELETE ON public.profile_drafts
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
CREATE TRIGGER profile_submission_delete_guard BEFORE DELETE ON public.profile_submissions
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
CREATE TRIGGER user_profile_delete_guard BEFORE DELETE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
CREATE TRIGGER profile_record_immutable BEFORE UPDATE OR DELETE ON public.profile_records
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
REVOKE DELETE ON public.profile_drafts,public.profile_submissions,public.user_profiles FROM personamarket_app;
--> statement-breakpoint
REVOKE UPDATE,DELETE ON public.profile_records FROM personamarket_app;
