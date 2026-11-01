-- 默认关闭维护；既有System值、所有旧配置、修订和更新时间原样保留。
INSERT INTO public.site_settings(key,value,revision)
VALUES('system','{"maintenanceEnabled":false,"maintenanceMessage":""}'::jsonb,1)
ON CONFLICT(key) DO NOTHING;
