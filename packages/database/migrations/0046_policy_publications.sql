CREATE TABLE "policy_entries" (
	"slug" varchar(32) PRIMARY KEY NOT NULL,
	"title" varchar(160) DEFAULT '' NOT NULL,
	"summary" varchar(300) DEFAULT '' NOT NULL,
	"body_markdown" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"approved_through_revision" integer DEFAULT 0 NOT NULL,
	"published_id" uuid,
	"activated_at" timestamp with time zone,
	"latest_submission_id" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone,
	CONSTRAINT "policy_entry_slug_valid" CHECK ("policy_entries"."slug" IN ('terms','privacy','content-policy')),
	CONSTRAINT "policy_entry_revision_valid" CHECK ("policy_entries"."revision">0 AND "policy_entries"."approved_through_revision">=0 AND "policy_entries"."approved_through_revision"<"policy_entries"."revision"),
	CONSTRAINT "policy_entry_body_bounded" CHECK (char_length("policy_entries"."body_markdown")<=30000),
	CONSTRAINT "policy_entry_public_shape" CHECK (("policy_entries"."published_id" IS NULL AND "policy_entries"."activated_at" IS NULL) OR ("policy_entries"."published_id" IS NOT NULL AND "policy_entries"."activated_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "policy_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(32) NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" varchar(16) NOT NULL,
	"submission_id" uuid,
	"reason" text NOT NULL,
	"self_review" boolean DEFAULT false NOT NULL,
	"before_state" jsonb NOT NULL,
	"after_state" jsonb NOT NULL,
	"from_revision" integer NOT NULL,
	"to_revision" integer NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_record_action_valid" CHECK ("policy_records"."action" IN ('edited','submitted','approved','rejected','withdrawn','unpublished','activated')),
	CONSTRAINT "policy_record_states_valid" CHECK (jsonb_typeof("policy_records"."before_state")='object' AND jsonb_typeof("policy_records"."after_state")='object'),
	CONSTRAINT "policy_record_revision_step" CHECK ("policy_records"."from_revision">0 AND "policy_records"."to_revision"="policy_records"."from_revision"+1),
	CONSTRAINT "policy_record_reason_bounded" CHECK (char_length("policy_records"."reason")<=2000)
);
--> statement-breakpoint
CREATE TABLE "policy_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(32) NOT NULL,
	"source_revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"contributors" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"reason" text,
	"self_review" boolean DEFAULT false NOT NULL,
	CONSTRAINT "policy_submission_revision_valid" CHECK ("policy_submissions"."source_revision">0),
	CONSTRAINT "policy_submission_snapshot_valid" CHECK (jsonb_typeof("policy_submissions"."snapshot")='object' AND "policy_submissions"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "policy_submission_authors_valid" CHECK (CASE WHEN jsonb_typeof("policy_submissions"."contributors")='array' THEN jsonb_array_length("policy_submissions"."contributors")>=1 AND "policy_submissions"."contributors" ? "policy_submissions"."submitted_by"::text ELSE false END),
	CONSTRAINT "policy_submission_state_valid" CHECK (
    ("policy_submissions"."status"='pending' AND "policy_submissions"."reviewed_by" IS NULL AND "policy_submissions"."reviewed_at" IS NULL AND "policy_submissions"."reason" IS NULL AND NOT "policy_submissions"."self_review") OR
    ("policy_submissions"."status"='withdrawn' AND "policy_submissions"."reviewed_by" IS NULL AND "policy_submissions"."reviewed_at" IS NULL AND "policy_submissions"."reason" IS NOT NULL AND length(btrim("policy_submissions"."reason"))>0 AND NOT "policy_submissions"."self_review") OR
    ("policy_submissions"."status" IN ('approved','rejected') AND "policy_submissions"."reviewed_by" IS NOT NULL AND "policy_submissions"."reviewed_at" IS NOT NULL AND "policy_submissions"."reason" IS NOT NULL
      AND ("policy_submissions"."status"='approved' OR length(btrim("policy_submissions"."reason"))>0) AND (NOT "policy_submissions"."self_review" OR length(btrim("policy_submissions"."reason"))>0))),
	CONSTRAINT "policy_submission_reason_bounded" CHECK ("policy_submissions"."reason" IS NULL OR char_length("policy_submissions"."reason")<=2000),
	CONSTRAINT "policy_submission_self_review_valid" CHECK (CASE WHEN "policy_submissions"."status" IN ('approved','rejected') THEN ("policy_submissions"."self_review"=("policy_submissions"."contributors" ? "policy_submissions"."reviewed_by"::text)) IS TRUE ELSE NOT "policy_submissions"."self_review" END)
);
--> statement-breakpoint
-- 复合外键依赖的唯一索引须先创建；空库迁移同样遵循此依赖顺序
CREATE UNIQUE INDEX "policy_submission_owner_unique" ON "policy_submissions" USING btree ("slug","id");--> statement-breakpoint
ALTER TABLE "policy_entries" ADD CONSTRAINT "policy_entries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_entries" ADD CONSTRAINT "policy_entry_published_owner_fk" FOREIGN KEY ("slug","published_id") REFERENCES "public"."policy_submissions"("slug","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_entries" ADD CONSTRAINT "policy_entry_latest_owner_fk" FOREIGN KEY ("slug","latest_submission_id") REFERENCES "public"."policy_submissions"("slug","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_records" ADD CONSTRAINT "policy_records_slug_policy_entries_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."policy_entries"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_records" ADD CONSTRAINT "policy_records_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_records" ADD CONSTRAINT "policy_record_submission_owner_fk" FOREIGN KEY ("slug","submission_id") REFERENCES "public"."policy_submissions"("slug","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_submissions" ADD CONSTRAINT "policy_submissions_slug_policy_entries_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."policy_entries"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_submissions" ADD CONSTRAINT "policy_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_submissions" ADD CONSTRAINT "policy_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_record_revision_unique" ON "policy_records" USING btree ("slug","to_revision");--> statement-breakpoint
CREATE INDEX "policy_records_recent_idx" ON "policy_records" USING btree ("slug","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "policy_one_pending_unique" ON "policy_submissions" USING btree ("slug") WHERE "policy_submissions"."status"='pending';--> statement-breakpoint
CREATE UNIQUE INDEX "policy_approved_hash_unique" ON "policy_submissions" USING btree ("slug","content_hash") WHERE "policy_submissions"."status"='approved';--> statement-breakpoint
CREATE INDEX "policy_submissions_recent_idx" ON "policy_submissions" USING btree ("slug","submitted_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
-- 初始只有固定身份和空草稿，绝不预先批准或填入法律正文
INSERT INTO public.policy_entries(slug) VALUES('terms'),('privacy'),('content-policy') ON CONFLICT(slug) DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION public.guard_policy_entry() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'POLICY_REVISION_STEP_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF NEW.updated_by IS NULL OR NEW.updated_at IS NULL THEN
    RAISE EXCEPTION 'POLICY_ACTION_ACTOR_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF NEW.approved_through_revision<OLD.approved_through_revision OR
    (NEW.approved_through_revision>OLD.approved_through_revision AND NOT EXISTS(
      SELECT 1 FROM public.policy_submissions s WHERE s.slug=NEW.slug AND s.status='approved' AND s.source_revision=NEW.approved_through_revision)) THEN
    RAISE EXCEPTION 'POLICY_APPROVED_BASE_INVALID' USING ERRCODE='23514';
  END IF;
  IF NEW.published_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.policy_submissions s WHERE s.id=NEW.published_id AND s.slug=NEW.slug AND s.status='approved') THEN
    RAISE EXCEPTION 'POLICY_PUBLIC_APPROVAL_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF NEW.published_id IS NOT DISTINCT FROM OLD.published_id AND NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
    RAISE EXCEPTION 'POLICY_PUBLIC_TIME_IMMUTABLE_WITHOUT_SWITCH' USING ERRCODE='23514';
  END IF;
  IF NEW.latest_submission_id IS DISTINCT FROM OLD.latest_submission_id THEN
    IF NEW.latest_submission_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM public.policy_submissions s WHERE s.id=NEW.latest_submission_id AND s.slug=NEW.slug AND s.status='pending' AND s.source_revision=OLD.revision) THEN
      RAISE EXCEPTION 'POLICY_LATEST_SUBMISSION_INVALID' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER policy_entry_guard BEFORE UPDATE ON public.policy_entries FOR EACH ROW EXECUTE FUNCTION public.guard_policy_entry();
--> statement-breakpoint
CREATE TRIGGER policy_entry_delete_guard BEFORE DELETE ON public.policy_entries FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
CREATE FUNCTION public.guard_policy_submission() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE entry public.policy_entries%ROWTYPE; expected_contributors jsonb;
BEGIN
  SELECT * INTO entry FROM public.policy_entries WHERE slug=NEW.slug FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POLICY_ENTRY_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'pending' OR NEW.source_revision<>entry.revision OR
      NEW.snapshot IS DISTINCT FROM jsonb_build_object('title',entry.title,'summary',entry.summary,'bodyMarkdown',entry.body_markdown) OR
      length(btrim(entry.title))=0 OR length(btrim(entry.body_markdown))=0 THEN
      RAISE EXCEPTION 'POLICY_SNAPSHOT_SOURCE_MISMATCH' USING ERRCODE='23514';
    END IF;
    SELECT jsonb_agg(actor ORDER BY actor) INTO expected_contributors FROM (
      SELECT r.actor_id::text AS actor FROM public.policy_records r WHERE r.slug=NEW.slug AND r.action='edited'
        AND r.to_revision>entry.approved_through_revision AND r.to_revision<=NEW.source_revision
      UNION SELECT NEW.submitted_by::text
    ) authors;
    IF NEW.contributors IS DISTINCT FROM expected_contributors THEN
      RAISE EXCEPTION 'POLICY_CONTRIBUTOR_LINEAGE_REQUIRED' USING ERRCODE='23514';
    END IF;
  ELSE
    IF ROW(NEW.id,NEW.slug,NEW.source_revision,NEW.snapshot,NEW.content_hash,NEW.contributors,NEW.submitted_by,NEW.submitted_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.slug,OLD.source_revision,OLD.snapshot,OLD.content_hash,OLD.contributors,OLD.submitted_by,OLD.submitted_at)
      OR OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected','withdrawn') OR entry.latest_submission_id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'POLICY_SUBMISSION_IMMUTABLE' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER policy_submission_guard BEFORE INSERT OR UPDATE ON public.policy_submissions FOR EACH ROW EXECUTE FUNCTION public.guard_policy_submission();
--> statement-breakpoint
CREATE TRIGGER policy_submission_delete_guard BEFORE DELETE ON public.policy_submissions FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
CREATE TRIGGER policy_record_update_guard BEFORE UPDATE OR DELETE ON public.policy_records FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
