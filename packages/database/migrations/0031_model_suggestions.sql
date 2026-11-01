-- 初始为空，管理员主动维护建议；保留可能已存在的定制配置
INSERT INTO "site_settings" ("key", "value", "revision")
VALUES ('modelSuggestions', '{"entries":[]}'::jsonb, 1)
ON CONFLICT ("key") DO NOTHING;
