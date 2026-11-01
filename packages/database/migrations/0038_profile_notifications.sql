ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_valid";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_target_shape";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_valid" CHECK ("notifications"."kind" IN ('release_approved','release_rejected','comment_approved','comment_rejected','comment_state','comment_reply','persona_state','profile_approved','profile_rejected','profile_state','report_updated','account_security','admin_notice'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_target_shape" CHECK (jsonb_typeof("notifications"."target")='object' AND "notifications"."target" ? 'type' AND jsonb_typeof("notifications"."target"->'type')='string' AND octet_length("notifications"."target"::text)<=2000 AND (
    ("notifications"."kind" IN ('release_approved','release_rejected','persona_state') AND "notifications"."target"->>'type'='own_persona') OR
    ("notifications"."kind" IN ('comment_approved','comment_rejected','comment_state') AND "notifications"."target"->>'type'='own_comment') OR
    ("notifications"."kind"='comment_reply' AND "notifications"."target"->>'type'='public_comment') OR
    ("notifications"."kind"='report_updated' AND "notifications"."target"->>'type'='own_report') OR
    ("notifications"."kind" IN ('profile_approved','profile_rejected','profile_state') AND "notifications"."target"->>'type'='own_profile') OR
    ("notifications"."kind"='account_security' AND "notifications"."target"->>'type'='account') OR
    ("notifications"."kind"='admin_notice' AND "notifications"."target"->>'type'='none')));