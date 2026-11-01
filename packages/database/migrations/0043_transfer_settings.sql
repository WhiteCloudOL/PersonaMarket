ALTER TABLE "persona_imports" ADD COLUMN "input_bytes" integer;--> statement-breakpoint
ALTER TABLE "market_imports" ADD COLUMN "input_bytes" integer;--> statement-breakpoint
ALTER TABLE "persona_imports" ADD CONSTRAINT "import_input_bytes_bounded" CHECK ("persona_imports"."input_bytes" IS NULL OR "persona_imports"."input_bytes" BETWEEN 0 AND 4194304);--> statement-breakpoint
ALTER TABLE "market_imports" ADD CONSTRAINT "market_import_input_bytes_bounded" CHECK ("market_imports"."input_bytes" IS NULL OR "market_imports"."input_bytes" BETWEEN 0 AND 134217728);
--> statement-breakpoint
INSERT INTO site_settings (key, value) VALUES ('transfer', '{"guestExportsEnabled":true,"importFormats":["maibot-toml","astrbot-json","text-plain","text-markdown","market-json","market-zip"],"exportFormats":["text","markdown","maibot-toml","astrbot-json","market-json","market-zip"],"maxImportFileKiB":4096,"maxImportArchiveMiB":128}'::jsonb) ON CONFLICT (key) DO NOTHING;
