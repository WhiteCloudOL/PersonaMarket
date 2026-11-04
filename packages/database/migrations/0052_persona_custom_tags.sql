ALTER TABLE "tags" ADD COLUMN "user_created" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
INSERT INTO tags (name) VALUES
  ('温柔陪伴'), ('毒舌吐槽'), ('冷静理性'), ('元气活泼'), ('慢热内向'), ('腹黑'),
  ('科幻'), ('赛博朋克'), ('古风'), ('悬疑推理'), ('末日生存'), ('童话'),
  ('日常聊天'), ('情绪陪伴'), ('语言学习'), ('灵感助手'), ('游戏搭子'), ('桌游主持')
ON CONFLICT DO NOTHING;
