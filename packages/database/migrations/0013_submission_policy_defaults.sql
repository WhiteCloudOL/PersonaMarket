-- 补充新策略字段，保留管理员已有的投稿开关与自定义值。
UPDATE site_settings
SET value = '{"platforms":["maibot","astrbot"],"dailyQuota":20}'::jsonb || value,
    revision = revision + 1,
    updated_at = now()
WHERE key = 'submissions'
  AND (NOT (value ? 'platforms') OR NOT (value ? 'dailyQuota'));
