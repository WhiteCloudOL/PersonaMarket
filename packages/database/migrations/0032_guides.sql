CREATE TABLE "guide_entries" (
	"slug" varchar(32) PRIMARY KEY NOT NULL,
	"title" varchar(160) NOT NULL,
	"summary" varchar(300) NOT NULL,
	"body_markdown" text NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"published_id" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_entries_slug_valid" CHECK ("guide_entries"."slug" IN ('getting-started','maibot','astrbot','create-draft','images-readme','source-license','publish','import-files','troubleshooting')),
	CONSTRAINT "guide_entries_revision_positive" CHECK ("guide_entries"."revision">0),
	CONSTRAINT "guide_entries_title_not_empty" CHECK (char_length("guide_entries"."title")>=1),
	CONSTRAINT "guide_entries_body_bounded" CHECK (char_length("guide_entries"."body_markdown") BETWEEN 1 AND 30000),
	CONSTRAINT "guide_entries_status_pointer" CHECK (("guide_entries"."status"='draft' AND "guide_entries"."published_id" IS NULL) OR ("guide_entries"."status" IN ('published','withdrawn') AND "guide_entries"."published_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "guide_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(32) NOT NULL,
	"title" varchar(160) NOT NULL,
	"summary" varchar(300) NOT NULL,
	"body_markdown" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_publications_title_not_empty" CHECK (char_length("guide_publications"."title")>=1),
	CONSTRAINT "guide_publications_body_bounded" CHECK (char_length("guide_publications"."body_markdown") BETWEEN 1 AND 30000),
	CONSTRAINT "guide_publications_hash_valid" CHECK ("guide_publications"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "guide_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(32) NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" varchar(16) NOT NULL,
	"reason" varchar(2000) NOT NULL,
	"before_state" jsonb NOT NULL,
	"after_state" jsonb NOT NULL,
	"from_revision" integer NOT NULL,
	"to_revision" integer NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_records_action_valid" CHECK ("guide_records"."action" IN ('edited','published','withdrawn')),
	CONSTRAINT "guide_records_before_object" CHECK (jsonb_typeof("guide_records"."before_state")='object'),
	CONSTRAINT "guide_records_after_object" CHECK (jsonb_typeof("guide_records"."after_state")='object'),
	CONSTRAINT "guide_records_revision_step" CHECK ("guide_records"."from_revision">0 AND "guide_records"."to_revision"="guide_records"."from_revision"+1)
);
--> statement-breakpoint
-- 组合外键依赖此唯一索引，须先于外键创建
CREATE UNIQUE INDEX "guide_publications_slug_id_unique" ON "guide_publications" USING btree ("slug","id");
--> statement-breakpoint
ALTER TABLE "guide_entries" ADD CONSTRAINT "guide_entries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_entries" ADD CONSTRAINT "guide_entries_publication_owner_fk" FOREIGN KEY ("slug","published_id") REFERENCES "public"."guide_publications"("slug","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_publications" ADD CONSTRAINT "guide_publications_slug_guide_entries_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."guide_entries"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_publications" ADD CONSTRAINT "guide_publications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_records" ADD CONSTRAINT "guide_records_slug_guide_entries_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."guide_entries"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_records" ADD CONSTRAINT "guide_records_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guide_publications_slug_created_idx" ON "guide_publications" USING btree ("slug","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "guide_records_slug_revision_unique" ON "guide_records" USING btree ("slug","to_revision");--> statement-breakpoint
CREATE INDEX "guide_records_slug_created_idx" ON "guide_records" USING btree ("slug","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
CREATE TRIGGER guide_publications_append_only
BEFORE UPDATE OR DELETE ON public.guide_publications
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
CREATE TRIGGER guide_records_append_only
BEFORE UPDATE OR DELETE ON public.guide_records
FOR EACH ROW EXECUTE FUNCTION public.deny_record_mutation();
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='personamarket_app') THEN
    REVOKE UPDATE,DELETE ON public.guide_publications,public.guide_records FROM personamarket_app;
  END IF;
END $$;
--> statement-breakpoint
-- 从原项目公开指南逐章保留正文，只初始化本次新增的固定章节
DO $$
DECLARE
  seed record;
  publication_id uuid;
BEGIN
  FOR seed IN SELECT * FROM jsonb_to_recordset($initial_guide_content$[{"slug":"getting-started","title":"使用作品","summary":"查找作品、核对版本和来源，再复制或导出人设","bodyMarkdown":"先确认你使用的是 MaiBot 还是 AstrBot，两种平台的人设正文结构不同，下载和填写时应选择对应平台\n\n1. 在「探索」中按平台、分类或标签筛选，打开作品详情并核对作者、版本和来源许可\n2. 阅读作品介绍及作者使用说明，在「人设内容」中查看完整正文，历史版本保留当时的内容\n3. 需要配置机器人时复制对应正文，或在「导出」面板预览目标格式后下载；分享时使用该版本的链接\n\n公开可读不等于可以任意转载，使用和分享前应先查看作品的转载规则","contentHash":"499cd7be55a47c5afd40176659ef7a698d25fafb2cf6a8e4de33deacf0d44d7a"},{"slug":"maibot","title":"MaiBot 使用方式","summary":"核对三段人设正文并导入目标机器人的人格配置","bodyMarkdown":"MaiBot 人设由三段独立正文组成，分别描述角色的性格、表达和行为，使用时不要将三段内容混成一个字段\n\n1. 在作品详情的「人设内容」中，分别查看人格设定、表达风格和行为风格\n2. 将三段正文填入目标机器人的对应配置；使用 TOML 片段时，核对 `[personality]` 下的 `personality`、`reply_style` 和 `behavior_style`\n3. 保留机器人原有的账号、模型和运行配置，按目标平台的配置方式合并，再检查实际回复是否符合预期\n\n本站 MaiBot 原生片段按 1.3.15 核验，只携带三段人设正文；名称、图片、README 和来源资料可通过通用格式保存","contentHash":"06539038ba9e32327a2ede3e1a517502e5d3186065705c13190c76a2c8af370b"},{"slug":"astrbot","title":"AstrBot 使用方式","summary":"导入人格和成对对话，并核对目标平台的能力设置","bodyMarkdown":"AstrBot 人设包含人格设定和可选的预设对话，对话按一条用户消息和一条 AI 回复成对保存，顺序也是人设的一部分\n\n1. 下载前在「导出」面板核对人格设定和预设对话，选择 AstrBot 原生 JSON\n2. 在 AstrBot WebUI 的「人格」文件导入入口导入，随后检查人格内容及对话顺序\n3. 在目标平台核对工具和 Skills 的启用范围，再将人格用于实际会话\n\n原生文件按 AstrBot 4.29.3 核验，该平台导入时会移除系统提示词首尾空白，并采用目标平台的工具和 Skills 默认设置；本站保留作者正文，不能代替目标端的能力配置检查","contentHash":"f33ccf213cf515bd62dba90c61145b9bf56dcf19c26e27aea9b8e7add837a047"},{"slug":"create-draft","title":"创作人设","summary":"从完整表单保存私有草稿，并跟进自动保存状态","bodyMarkdown":"1. 从导航中的「发布」或「我的人设」打开创建表单，填写名称、简介、分类和目标平台\n2. 填写对应平台的正文、作品介绍和来源许可，选择「创建私有草稿」保存到账号中\n3. 进入已有草稿的编辑器后，修改会自动保存，也可以手动保存；关闭页面前确认保存状态\n\n未登录时可以先填写，使用表单中的「去登录」会在本标签页登录并返回，已填资料和两个平台正文在内存中保留 30 分钟，刷新或关闭标签页会清除这份临时内容\n\n每个人设只对应一个平台，首次保存后平台保持固定；新建表单切换平台时会保留两边正文，最终只保存当前选择的平台","contentHash":"5b4424839ec5c7e9dcab59b246bccb3e0dc90e921b205a47b107c463b1f7e79a"},{"slug":"images-readme","title":"图文介绍","summary":"使用 Markdown 和受控素材介绍角色","bodyMarkdown":"作品介绍使用 Markdown，可切换预览查看标题、段落和图片的实际效果，正文不会执行 HTML 或脚本\n\n- 封面、头像和作品介绍图片从当前账号的私有素材库选择，支持静态 JPEG、PNG、WebP，单张最多 5 MiB\n- 在线图片须先明确确认导入并完成托管，不能直接使用其他账号的私有素材\n- 授权证据属于私有资料，不会随公开作品和导出文件一起提供\n\n电脑端可在右侧查看预览和内容检查，手机端通过顶部「预览」查看；预览只展示当前输入，保存草稿不会直接公开","contentHash":"9083b17f47e7df62a82adc9ec646d139ceac55c7ce3a02f8d3c6656d8fc35167"},{"slug":"source-license","title":"作品授权","summary":"说明原创或转载来源，并核对授权范围","bodyMarkdown":"原创作品和转载作品需要分别声明，文件中写着“原创”不会自动使导入账号成为原作者\n\n1. 原创作品选择适合的转载规则，并补充需要使用者了解的说明\n2. 转载作品填写原作者、来源链接或可核查的来源说明，以及本次转载的授权依据\n3. 提交前核对正文、图片及许可范围，确认有权发布，并按作者要求保留署名和来源","contentHash":"13b830c8e756bdf7d84a5004d532b96f93f1b8798483a12e5c360e7aac10f293"},{"slug":"publish","title":"提交审核","summary":"创建版本、提交审核并管理公开状态","bodyMarkdown":"1. 完善内容检查中的必填项，创建版本并核对本次准备公开的快照\n2. 填写稳定版本号（如 `1.0.0`）和更新日志，确认后提交审核\n3. 在「发布记录」中查看处理结果，被退回后修改草稿，再使用同一未发布版本号重提\n\n每个人设同时只能有一个待审提交，继续编辑草稿不会改写待审或已发布版本；新的发布版本号必须高于历史最高已发布版本\n\n作者可隐藏作品、恢复展示、选择仍有效的历史公开版本或撤销版本，当前版本失效时不会自动切换到旧版，管理员下架的作品仍受下架状态限制","contentHash":"e2d67502ec94526b46519ffef5b6f51400efa07b265a73c43bb36411b5aff958"},{"slug":"import-files","title":"导入文件","summary":"选择格式、核对编码和素材，再保存到私有草稿","bodyMarkdown":"从「我的人设 → 导入人设」进入，先选择文件类型，预览核对后再保存为私有草稿\n\n### 选择合适的格式\n\n- **通用 JSON / ZIP**：`.persona.json` 保存作品资料和图片引用，最多 4 MiB；`.persona.zip` 同时携带包内图片，最多 128 MiB，适合离线迁移\n- **平台原生文件**：选择 MaiBot TOML 或 AstrBot JSON，最多 4 MiB，只提取平台人设和对话，不带入账号、密钥或运行能力配置\n- **TXT / Markdown**：最多 4 MiB，先选择平台，再将选中的段落或全文填入对应字段，核对后生成预览\n\n### 核对内容并保存\n\n1. 读取文件后检查正文、对话、图片及实际编码；文本支持 UTF-8、GBK / GB18030、UTF-16 LE / BE，乱码时手动选择编码后重试\n2. 通用 JSON 的在线图片须逐张确认导入，ZIP 包内图片也须通过校验，全部处理完成后继续\n3. 填写原作者、来源和转载依据，明确选择新建草稿或替换自己同平台的草稿，再确认保存\n\n导入后仍是私有草稿，需要主动创建版本并提交审核；替换前会检查草稿修订号，其他页面的更新不会被静默覆盖\n\nZIP 内文本按通用格式使用 UTF-8，独立文本文件可选择编码；自动识别无法判断所有旧编码，应以预览中的实际文字为准","contentHash":"df84280a532f1118dec098b2c92778204761a7e5ffbfb2f32383916661b99d25"},{"slug":"troubleshooting","title":"常见问题","summary":"处理保存冲突、导入乱码和公开访问问题","bodyMarkdown":"### 保存失败或出现版本冲突\n\n先保留当前输入，网络恢复后手动重试；版本冲突时先比较或备份本地内容，再明确重新读取服务器草稿，不要反复刷新覆盖其他页面的修改\n\n### 导入后出现乱码\n\n根据原文件选择 UTF-8、GBK / GB18030 或 UTF-16 后重新预览，无 BOM 的 UTF-16 文件需手动选择字节序，确认文字正常后再保存\n\n### 作品暂时无法公开访问\n\n在「发布记录」核对是否仍在待审、被退回或已撤销，再检查作者隐藏和管理员下架状态，草稿和待审内容不会作为公开版本展示","contentHash":"7c425c9dc84bb4b5fe3d3f452347ffbbf8421560946ee5204497690236d22b8f"}]$initial_guide_content$::jsonb)
    AS item(slug text,title text,summary text,"bodyMarkdown" text,"contentHash" text)
  LOOP
    INSERT INTO public.guide_entries(slug,title,summary,body_markdown)
    VALUES(seed.slug,seed.title,seed.summary,seed."bodyMarkdown")
    ON CONFLICT(slug) DO NOTHING;
    IF FOUND THEN
      INSERT INTO public.guide_publications(slug,title,summary,body_markdown,content_hash)
      VALUES(seed.slug,seed.title,seed.summary,seed."bodyMarkdown",seed."contentHash")
      RETURNING id INTO publication_id;
      UPDATE public.guide_entries SET status='published',published_id=publication_id WHERE slug=seed.slug;
    END IF;
  END LOOP;
END $$;
