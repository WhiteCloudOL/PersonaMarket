CREATE TABLE "auth_admin_guard" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "auth_admin_guard_singleton" CHECK ("auth_admin_guard"."singleton")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"csrf_token_hash" varchar(64) NOT NULL,
	"security_version" integer NOT NULL,
	"device_name" varchar(200) DEFAULT '' NOT NULL,
	"restricted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"mfa_verified_at" timestamp with time zone,
	CONSTRAINT "auth_sessions_hash_only" CHECK ("auth_sessions"."token_hash" ~ '^[0-9a-f]{64}$' AND "auth_sessions"."csrf_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_sessions_expiry_valid" CHECK ("auth_sessions"."expires_at" > "auth_sessions"."created_at"),
	CONSTRAINT "auth_sessions_security_version_positive" CHECK ("auth_sessions"."security_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" varchar(32) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"target_email" varchar(254),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "auth_tokens_hash_only" CHECK ("auth_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_tokens_expiry_valid" CHECK ("auth_tokens"."expires_at" > "auth_tokens"."created_at"),
	CONSTRAINT "auth_tokens_purpose_valid" CHECK ("auth_tokens"."purpose" in ('email_verify', 'password_reset', 'email_change')),
	CONSTRAINT "auth_tokens_email_change_bound" CHECK (("auth_tokens"."purpose" = 'email_change') = ("auth_tokens"."target_email" IS NOT NULL)),
	CONSTRAINT "auth_tokens_email_canonical" CHECK ("auth_tokens"."target_email" IS NULL OR ("auth_tokens"."target_email" = lower(btrim("auth_tokens"."target_email")) AND position('@' in "auth_tokens"."target_email") > 1 AND "auth_tokens"."target_email" !~ '[[:space:][:cntrl:]]'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(32) NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"role" varchar(16) DEFAULT 'user' NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"security_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_canonical" CHECK ("users"."username" ~ '^[a-z][a-z0-9_]{2,31}$'),
	CONSTRAINT "users_email_canonical" CHECK ("users"."email" = lower(btrim("users"."email")) AND position('@' in "users"."email") > 1 AND "users"."email" !~ '[[:space:][:cntrl:]]'),
	CONSTRAINT "users_password_hash_only" CHECK ("users"."password_hash" LIKE '$argon2id$%' AND length("users"."password_hash") BETWEEN 80 AND 512),
	CONSTRAINT "users_role_valid" CHECK ("users"."role" in ('user', 'moderator', 'admin')),
	CONSTRAINT "users_status_valid" CHECK ("users"."status" in ('active', 'banned', 'deactivated')),
	CONSTRAINT "users_security_version_positive" CHECK ("users"."security_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_unique" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_purpose_hash_unique" ON "auth_tokens" USING btree ("purpose","token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_purpose_idx" ON "auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");
--> statement-breakpoint
INSERT INTO public.auth_admin_guard (singleton, revision) VALUES (true, 1);
--> statement-breakpoint
CREATE FUNCTION public.protect_last_active_admin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.role = 'admin' AND OLD.status = 'active' THEN
    IF TG_OP = 'DELETE' OR NEW.role <> 'admin' OR NEW.status <> 'active' THEN
      -- A real row write serializes READ COMMITTED and conflicts under old RR snapshots.
      UPDATE public.auth_admin_guard SET revision = revision + 1 WHERE singleton;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ADMIN_GUARD_MISSING';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.users WHERE role = 'admin' AND status = 'active') THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'LAST_ACTIVE_ADMIN';
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_last_active_admin() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER users_protect_last_admin
AFTER UPDATE OF role, status OR DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.protect_last_active_admin();
--> statement-breakpoint
CREATE FUNCTION public.advance_account_security_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.security_version < OLD.security_version THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'SECURITY_VERSION_CANNOT_DECREASE';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.password_hash IS DISTINCT FROM OLD.password_hash OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at THEN
    NEW.security_version := OLD.security_version + 1;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.advance_account_security_version() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER users_advance_security_version BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.advance_account_security_version();
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'personamarket_app') THEN
    REVOKE ALL ON public.auth_admin_guard FROM personamarket_app;
  END IF;
END;
$$;
