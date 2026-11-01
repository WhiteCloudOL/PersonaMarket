-- 仅更新旧系统默认介绍，保留管理员自定义文案与其他配置字段。
UPDATE site_settings
SET value = jsonb_set(value, '{description}', to_jsonb('创作、分享与发现 MaiBot 和 AstrBot 人设'::text)),
    revision = revision + 1,
    updated_at = now()
WHERE key = 'brand'
  AND value->>'description' = '创作、分享与发现 MaiBot 和 AstrBot 人设。';
