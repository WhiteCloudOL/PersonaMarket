CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
INSERT INTO site_settings (key, value) VALUES (
  'brand',
  '{"name":"清蒸云鸭·人设市场","description":"创作、分享与发现 MaiBot 和 AstrBot 人设。","defaultLocale":"zh-CN"}'::jsonb
) ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
INSERT INTO outbox_events (topic, payload) VALUES ('system.bootstrap', '{"schemaVersion":1}'::jsonb);
