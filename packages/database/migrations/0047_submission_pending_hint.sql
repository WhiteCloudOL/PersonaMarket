-- 仅初始化新字段，不改变既有投稿策略、管理员自定义值、修订号或更新时间
UPDATE public.site_settings
SET value = value || jsonb_build_object('pendingHint', '待审期间可以继续编辑草稿，修改不会改变本次审核快照')
WHERE key = 'submissions'
  AND jsonb_typeof(value) = 'object'
  AND NOT (value ? 'pendingHint');
