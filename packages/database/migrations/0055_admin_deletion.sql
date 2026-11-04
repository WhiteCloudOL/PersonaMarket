ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_deleted_inactive" CHECK ("users"."deleted_at" IS NULL OR ("users"."status"='deactivated' AND "users"."role"='user' AND "users"."email_verified_at" IS NULL));--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "persona_deleted_blocked" CHECK ("personas"."deleted_at" IS NULL OR ("personas"."moderation_state"='blocked' AND "personas"."published_release_id" IS NULL));
--> statement-breakpoint
CREATE FUNCTION public.protect_deletion_marker() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'deletion marker is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER protect_user_deletion BEFORE UPDATE OF deleted_at ON users
FOR EACH ROW EXECUTE FUNCTION public.protect_deletion_marker();
--> statement-breakpoint
CREATE TRIGGER protect_persona_deletion BEFORE UPDATE OF deleted_at ON personas
FOR EACH ROW EXECUTE FUNCTION public.protect_deletion_marker();
