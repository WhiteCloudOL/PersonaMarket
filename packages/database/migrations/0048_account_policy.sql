-- 只补新策略缺失的键，保留管理员已有值、null部署fallback、revision和updated_at。
UPDATE public.site_settings
SET value = value || jsonb_build_object('verificationEmailTiming', 'on_registration')
WHERE key = 'accounts' AND jsonb_typeof(value) = 'object'
  AND NOT (value ? 'verificationEmailTiming');
--> statement-breakpoint
UPDATE public.site_settings
SET value = value || jsonb_build_object('registrationRateLimit', jsonb_build_object('maxAttempts', 10, 'windowSeconds', 3600))
WHERE key = 'accounts' AND jsonb_typeof(value) = 'object'
  AND NOT (value ? 'registrationRateLimit');
--> statement-breakpoint
UPDATE public.site_settings
SET value = jsonb_set(value, '{registrationRateLimit}', value->'registrationRateLimit' || jsonb_build_object('maxAttempts', 10))
WHERE key = 'accounts' AND jsonb_typeof(value->'registrationRateLimit') = 'object'
  AND NOT ((value->'registrationRateLimit') ? 'maxAttempts');
--> statement-breakpoint
UPDATE public.site_settings
SET value = jsonb_set(value, '{registrationRateLimit}', value->'registrationRateLimit' || jsonb_build_object('windowSeconds', 3600))
WHERE key = 'accounts' AND jsonb_typeof(value->'registrationRateLimit') = 'object'
  AND NOT ((value->'registrationRateLimit') ? 'windowSeconds');
