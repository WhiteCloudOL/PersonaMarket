CREATE TABLE "comment_moderation_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"revision_id" uuid,
	"actor_id" uuid,
	"action" varchar(16) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"self_review" boolean DEFAULT false NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_moderation_action_valid" CHECK ("comment_moderation_records"."action" IN ('approve','reject','auto_approve','hide','restore','delete')),
	CONSTRAINT "comment_moderation_reason_bounds" CHECK (char_length("comment_moderation_records"."reason")<=2000),
	CONSTRAINT "comment_moderation_actor_shape" CHECK (("comment_moderation_records"."action"='auto_approve' AND "comment_moderation_records"."actor_id" IS NULL AND NOT "comment_moderation_records"."self_review") OR ("comment_moderation_records"."action"<>'auto_approve' AND "comment_moderation_records"."actor_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "comment_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"body" text NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_text_bounds" CHECK ("comment_revisions"."number">0 AND char_length("comment_revisions"."body") BETWEEN 1 AND 2000 AND "comment_revisions"."body" ~ '[^[:space:]]'),
	CONSTRAINT "comment_revision_status_valid" CHECK ("comment_revisions"."status" IN ('PENDING','APPROVED','REJECTED','SUPERSEDED')),
	CONSTRAINT "comment_reason_bounds" CHECK ("comment_revisions"."reason" IS NULL OR char_length("comment_revisions"."reason")<=2000),
	CONSTRAINT "comment_rejection_reason" CHECK ("comment_revisions"."status"<>'REJECTED' OR ("comment_revisions"."reason" IS NOT NULL AND "comment_revisions"."reason" ~ '[^[:space:]]'))
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"reply_to_id" uuid,
	"release_id" uuid,
	"visibility" varchar(16) DEFAULT 'normal' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"latest_revision_id" uuid,
	"public_revision_id" uuid,
	"pending_revision_id" uuid,
	"first_published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_visibility_valid" CHECK ("comments"."visibility" IN ('normal','deleted','hidden')),
	CONSTRAINT "comment_revision_positive" CHECK ("comments"."revision">0),
	CONSTRAINT "comment_reply_shape" CHECK ("comments"."parent_id" IS NOT NULL OR "comments"."reply_to_id" IS NULL),
	CONSTRAINT "comment_parent_not_self" CHECK ("comments"."parent_id" IS DISTINCT FROM "comments"."id" AND "comments"."reply_to_id" IS DISTINCT FROM "comments"."id")
);
--> statement-breakpoint
-- 先建立复合外键的引用键，随后添加约束
CREATE UNIQUE INDEX "comment_revision_owner_unique" ON "comment_revisions" USING btree ("comment_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_persona_id_unique" ON "comments" USING btree ("persona_id","id");--> statement-breakpoint
ALTER TABLE "comment_moderation_records" ADD CONSTRAINT "comment_moderation_records_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_moderation_records" ADD CONSTRAINT "comment_moderation_records_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_moderation_records" ADD CONSTRAINT "comment_moderation_revision_fk" FOREIGN KEY ("comment_id","revision_id") REFERENCES "public"."comment_revisions"("comment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_revisions" ADD CONSTRAINT "comment_revisions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comment_parent_persona_fk" FOREIGN KEY ("persona_id","parent_id") REFERENCES "public"."comments"("persona_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comment_reply_target_persona_fk" FOREIGN KEY ("persona_id","reply_to_id") REFERENCES "public"."comments"("persona_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comment_release_persona_fk" FOREIGN KEY ("persona_id","release_id") REFERENCES "public"."persona_releases"("persona_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_moderation_history_idx" ON "comment_moderation_records" USING btree ("comment_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "comment_revision_number_unique" ON "comment_revisions" USING btree ("comment_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "one_pending_revision_per_comment" ON "comment_revisions" USING btree ("comment_id") WHERE "comment_revisions"."status"='PENDING';--> statement-breakpoint
CREATE INDEX "comments_persona_root_created_idx" ON "comments" USING btree ("persona_id","created_at","id") WHERE "comments"."parent_id" IS NULL;--> statement-breakpoint
CREATE INDEX "comments_parent_created_idx" ON "comments" USING btree ("parent_id","created_at","id") WHERE "comments"."parent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "comments_author_created_idx" ON "comments" USING btree ("author_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "comments_pending_created_idx" ON "comments" USING btree ("created_at","id") WHERE "comments"."pending_revision_id" IS NOT NULL AND "comments"."visibility"='normal';
--> statement-breakpoint
ALTER TABLE comments ADD CONSTRAINT comment_latest_revision_fk FOREIGN KEY(id,latest_revision_id) REFERENCES comment_revisions(comment_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE comments ADD CONSTRAINT comment_public_revision_fk FOREIGN KEY(id,public_revision_id) REFERENCES comment_revisions(comment_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE comments ADD CONSTRAINT comment_pending_revision_fk FOREIGN KEY(id,pending_revision_id) REFERENCES comment_revisions(comment_id,id) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION guard_comment_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW.id,NEW.persona_id,NEW.author_id,NEW.parent_id,NEW.reply_to_id,NEW.release_id,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.persona_id,OLD.author_id,OLD.parent_id,OLD.reply_to_id,OLD.release_id,OLD.created_at)
      OR NEW.revision<>OLD.revision+1
      OR (OLD.visibility='deleted' AND NEW.visibility<>'deleted')
      OR (OLD.first_published_at IS NOT NULL AND NEW.first_published_at IS DISTINCT FROM OLD.first_published_at) THEN
      RAISE EXCEPTION 'invalid comment identity transition' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.comments p WHERE p.id=NEW.parent_id AND p.persona_id=NEW.persona_id
        AND p.parent_id IS NULL AND p.visibility='normal' AND p.public_revision_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'reply requires a published root comment' USING ERRCODE='23514';
    END IF;
    IF NEW.reply_to_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.comments r WHERE r.id=NEW.reply_to_id AND r.persona_id=NEW.persona_id
        AND (r.id=NEW.parent_id OR r.parent_id=NEW.parent_id)
        AND r.visibility='normal' AND r.public_revision_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'invalid reply target' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER comment_identity_guard BEFORE INSERT OR UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION guard_comment_identity();
CREATE TRIGGER comment_no_delete BEFORE DELETE ON comments FOR EACH ROW EXECUTE FUNCTION deny_record_mutation();
--> statement-breakpoint
CREATE FUNCTION freeze_comment_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'PENDING' OR NEW.reason IS NOT NULL THEN
      RAISE EXCEPTION 'comment text requires explicit review' USING ERRCODE='23514';
    END IF;
  ELSE
    IF (NEW.id,NEW.comment_id,NEW.number,NEW.body,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.comment_id,OLD.number,OLD.body,OLD.created_at)
      OR OLD.status<>'PENDING' OR NEW.status NOT IN ('APPROVED','REJECTED','SUPERSEDED') THEN
      RAISE EXCEPTION 'comment revision is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER comment_revision_guard BEFORE INSERT OR UPDATE ON comment_revisions FOR EACH ROW EXECUTE FUNCTION freeze_comment_revision();
CREATE TRIGGER comment_revision_no_delete BEFORE DELETE ON comment_revisions FOR EACH ROW EXECUTE FUNCTION deny_record_mutation();
CREATE TRIGGER comment_moderation_append_only BEFORE UPDATE OR DELETE ON comment_moderation_records FOR EACH ROW EXECUTE FUNCTION deny_record_mutation();
--> statement-breakpoint
CREATE FUNCTION check_comment_state() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE target_id uuid; current_row public.comments%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='comments' THEN target_id:=NEW.id; ELSE target_id:=NEW.comment_id; END IF;
  SELECT * INTO current_row FROM public.comments WHERE id=target_id;
  IF current_row.latest_revision_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.comment_revisions r WHERE r.id=current_row.latest_revision_id AND r.comment_id=target_id
  ) THEN RAISE EXCEPTION 'comment requires a latest revision' USING ERRCODE='23514'; END IF;
  IF current_row.pending_revision_id IS NOT NULL AND (
    current_row.pending_revision_id IS DISTINCT FROM current_row.latest_revision_id OR NOT EXISTS (
      SELECT 1 FROM public.comment_revisions r WHERE r.id=current_row.pending_revision_id AND r.comment_id=target_id AND r.status='PENDING'
    ) OR current_row.visibility='deleted'
  ) THEN RAISE EXCEPTION 'invalid pending comment pointer' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM public.comment_revisions r WHERE r.comment_id=target_id AND r.status='PENDING' AND r.id IS DISTINCT FROM current_row.pending_revision_id)
    OR current_row.latest_revision_id IS DISTINCT FROM (SELECT r.id FROM public.comment_revisions r WHERE r.comment_id=target_id ORDER BY r.number DESC LIMIT 1)
  THEN RAISE EXCEPTION 'comment revision pointers are stale' USING ERRCODE='23514'; END IF;
  IF (current_row.public_revision_id IS NULL) IS DISTINCT FROM (current_row.first_published_at IS NULL) OR (
    current_row.public_revision_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.comment_revisions r WHERE r.id=current_row.public_revision_id AND r.comment_id=target_id AND r.status='APPROVED'
    )
  ) THEN RAISE EXCEPTION 'invalid public comment pointer' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.comment_revisions r WHERE r.comment_id=target_id AND r.status IN ('APPROVED','REJECTED') AND NOT EXISTS (
      SELECT 1 FROM public.comment_moderation_records m WHERE m.comment_id=target_id AND m.revision_id=r.id
        AND ((r.status='APPROVED' AND m.action IN ('approve','auto_approve')) OR (r.status='REJECTED' AND m.action='reject'))
    )
  ) THEN RAISE EXCEPTION 'comment decision requires a review record' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER comment_state_guard AFTER INSERT OR UPDATE ON comments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_comment_state();
CREATE CONSTRAINT TRIGGER comment_revision_state_guard AFTER INSERT OR UPDATE ON comment_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_comment_state();
--> statement-breakpoint
-- 保留已配置的点赞、收藏及任何既有评论值，只补齐新增默认字段
UPDATE site_settings SET value='{"commentsEnabled":true,"showExistingComments":true,"commentReviewMode":"all","commentMaxLength":2000,"commentsPerMinute":5}'::jsonb || value,
  revision=revision+1,updated_at=now() WHERE key='community';
