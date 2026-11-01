INSERT INTO "site_settings" ("key", "value") VALUES
  ('mail', '{"mode":"environment"}'::jsonb),
  ('accounts', '{"registrationEnabled":null,"sessionTtlSeconds":null}'::jsonb)
ON CONFLICT ("key") DO NOTHING;
