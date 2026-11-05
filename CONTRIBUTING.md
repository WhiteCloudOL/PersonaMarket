# 参与清蒸云鸭·人设市场

欢迎提交问题、改进文档或贡献代码。开始前阅读 [AGENTS.md](AGENTS.md) 与任务相关设计章节；技术栈、安全要求、测试门禁和提交规则适用于所有贡献。

## 文档分工

| 文件            | 主要用途                                         |
| --------------- | ------------------------------------------------ |
| README.md       | 面向访客、用户与部署者的介绍、可用功能与运行入口 |
| AGENTS.md       | 开发 Agent 长期遵守的强制工程规范                |
| CONTRIBUTING.md | 开发环境、贡献流程、命令与提交约定               |
| docs/           | 必要项目使用、部署、维护、API 和第三方许可       |

README 只介绍实际可用能力。设计稿、进度、测试证据与未验收项统一放在被 Git 忽略的 .development/。

## 开发环境

要求 Node.js **26.13.0**、pnpm **10.34.8** 和 Docker Compose（实测 **5.3.1 / 5.5.1**）。Node.js 26 可用 `npm install --global pnpm@10.34.8` 安装固定的 pnpm。精确依赖以 package.json 和 pnpm-lock.yaml 为准，兼容性核验记录保存在本地 .development/DEPENDENCIES.md。

```sh
node scripts/install-agent-skills.mjs
node scripts/verify-agent-skills.mjs
pnpm install --frozen-lockfile
pnpm env:init
pnpm infra:up
pnpm db:migrate
pnpm dev
```

Windows 也可执行 `./scripts/install-agent-skills.ps1`，macOS / Linux 使用 `bash scripts/install-agent-skills.sh`。安装器复用通过哈希校验的项目级 Skill。

env:init 只首次创建 .env；已有文件按样例补充，STORAGE_ROOT 指向项目 data/storage 的绝对路径。开发站点位于 http://127.0.0.1:3000，PUBLIC_ORIGIN 必须与浏览器访问地址完全一致，API 位于 http://127.0.0.1:3001。infra:up 同时启动真实 Mailpit（SMTP 11025、收件箱 18025，均只绑定回环地址）。Web 只接收允许的公开环境信息。

仅检查页面与同步业务时，可用 `pnpm infra:up --base-only` 启动 PostgreSQL 和 Redis，执行 `pnpm db:migrate` 后用 `pnpm dev --without-worker` 在宿主机启动 Web 和 API。需要处理异步任务时运行默认的 `pnpm dev`。验证注册、邮箱验证或密码重置前，运行 `pnpm infra:up` 启动 Mailpit，并使用带 Worker 的默认开发模式。`pnpm infra:down --base-only` 只停止两个基础服务，默认 `pnpm infra:down` 也停止 Mailpit。

Windows 首次生成配置后执行 `./scripts/secure-local-data.ps1`，移除 `.env` 与 `data/` 从父目录继承的权限，仅保留当前账号、SYSTEM 和本机管理员组；执行 `./scripts/secure-local-data.ps1 -Check` 可只读复核入口 ACL。已有子目录的显式 ACL 不会被重置，须单独核对；脚本发现入口链接或额外允许项会报错。Node 的 POSIX mode 参数不能代替 Windows NTFS ACL。

所有长期运行数据、备份与维护缓存都放在 data/。Compose 使用目录绑定；测试数据库必须独立，禁止用业务库代替或删除数据目录解决失败。详见 [数据维护](docs/OPERATIONS.md)。

格式命令通过 Git 枚举受跟踪文件和未忽略的新文件，再应用 `.prettierignore` 和 Prettier 配置。它不会遍历私有运行数据目录，不需要为代码检查放宽数据库或邮件目录的权限。

GitHub 工程门禁分别运行源码、真实集成、三种浏览器视口、完整视觉矩阵，以及容器和恢复检查。各任务使用独立 runner，单个 runner 内沿用单 worker 和构建并发上限；全量检查范围与本地命令保持一致。源码检查通过后，其他任务独立执行并分别报告结果，单个用例的超时不变。

## 入库文件与隐私

仅提交源码、版本化迁移、生成的公开契约、受控测试夹具及必要文档。`.env`、`data/`、`.development/`、构建缓存、浏览器认证状态、HAR、内存转储和本地归档由忽略规则排除；`.env.example` 只写明确占位值。第三方许可及其作者署名保持原文。

推送前检查暂存区和将要上传的提交历史；新增忽略规则不会自动移除已经跟踪的文件或清除旧提交中的个人信息。CI 仅上传明确列出的扫描摘要，不上传会话、trace、截图目录或整份原始验收日志。清理本机构建产物时保留运行数据、依赖和必要测试夹具，目录链接只删除链接本身。

`pnpm typecheck` 会先构建 API 及其依赖，生成根工程测试使用的 `@personamarket/api/testing` 公共导出声明；全新检出无需预先执行全站构建。项目源码和根目录测试、脚本仍完整执行类型检查。

根目录构建、类型与契约入口通过 `scripts/run-turbo.mjs` 固化本次 API 源码提交及工作区标记，作为 API 构建缓存的输入。API 编译成功后写入 `dist/build-info.json`，缓存命中保留该产物的原构建时间；源码提交或脏树状态变化会生成新的 API 缓存键。直接执行 API 包的 build 也会记录当次构建来源。通过 `scripts/build-images.mjs` 构建容器时，同一份来源由受控 build arg 传给构建阶段，不进入运行时环境。缺少 Git 的源码包若没有有效构建来源，运行信息明确显示未知；不要靠运行时环境变量或镜像标签补造版本。

## 常用命令

| 命令                                           | 实际职责                                            |
| ---------------------------------------------- | --------------------------------------------------- |
| `pnpm dev`                                     | 构建共享包，校验环境与依赖，启动 Web / API / Worker |
| `pnpm format:check` / `pnpm format`            | 格式检查 / 格式化                                   |
| `pnpm lint`                                    | ESLint 与包边界检查                                 |
| `pnpm typecheck`                               | 全工作区与根工程 TypeScript strict 检查             |
| `pnpm test:unit`                               | 契约、环境、解析与存储单元测试                      |
| `pnpm test:integration`                        | 构建 API、Worker 和客户端后执行真实数据库与队列集成 |
| `pnpm test:e2e`                                | 生产构建与 Playwright 浏览器流程                    |
| `pnpm build` / `pnpm build:packages`           | 全部应用与共享包 / 仅共享包构建                     |
| `pnpm db:generate` / `pnpm db:migrate`         | 生成可审查 SQL / 版本化迁移                         |
| `pnpm api:generate` / `pnpm api:check`         | OpenAPI 与客户端生成 / 漂移检查                     |
| `pnpm formats:generate` / `pnpm formats:check` | 从共享契约生成 / 检查人设通用格式 JSON Schema       |
| `pnpm check`                                   | 格式、lint、类型、单元和契约门禁                    |
| `pnpm verify`                                  | check、真实集成、E2E 及其生产构建                   |
| `pnpm env:init`                                | 首次生成本机配置与随机凭据                          |
| `pnpm infra:up` / `pnpm infra:down`            | 启动 / 停止开发依赖，保留 data/                     |
| `pnpm skills:verify` / `pnpm deps:check`       | Skill 完整性 / 版本、引擎、peer 核验                |
| `pnpm security:scan` / `pnpm security:images`  | 本机秘密与生产依赖审计 / 镜像扫描                   |
| `pnpm licenses:generate`                       | 实际安装包许可记录                                  |
| `pnpm admin:create`                            | 受控创建管理员，交互密码隐藏，可自愿绑定 MFA        |
| `pnpm rankings:rebuild`                        | 在受控运行环境提交真实 Worker 榜单重建请求          |
| `pnpm test:recovery`                           | 本地隔离恢复与持久化演练，会暂停业务进程            |
| `pnpm build:images`                            | 按服务串行构建固定容器镜像                          |
| `pnpm test:remote`                             | 受控真实 HTTPS、在线图片队列与 SSRF 边界检查        |
| `pnpm test:visual`                             | 八视口真实页面截图、触控与视觉布局验收              |

首次浏览器测试前执行 `pnpm exec playwright install chromium`，Linux 可加 --with-deps。可设置 PLAYWRIGHT_CHANNEL=chrome 使用本机 Chrome，PowerShell 为 `$env:PLAYWRIGHT_CHANNEL='chrome'`。

浏览器测试运行器为每个文件/视口分配独立的 `data/tests/e2e-storage/run-*` 素材目录，并通过内部 `E2E_STORAGE_ROOT` 传给测试服务；测试服务不继承业务 `STORAGE_ROOT`。直接运行测试服务也会自行分配目录。路径校验拒绝业务存储、越界路径和 junction/symlink，测试结束或服务启动失败后由目录所有者清理。普通异常退出有回收钩子；操作系统强制终止父运行器无法保证执行钩子，残留仅限测试目录，须确认归属后处理，不能批量删除其它测试或业务资料。

测试 API 和 Worker 共用由当前隔离测试库地址派生的队列名，覆盖宿主机的 `QUEUE_NAME`，直接运行测试服务也遵守此规则。概览和任务观测必须读取该测试队列，不能误读业务队列。全量运行逐文件隔离；显式同时选择多个文件时，这些文件属于同一选择组，每个视口仍新建隔离库和队列。

可见页面改动先采集桌面/手机基线，再执行 `pnpm test:visual`。该命令使用真实 PostgreSQL、Redis、Mailpit 与隔离测试库，按 v360/v390/v430/v768/v1024/v1366/v1440/v1920 顺序、单 worker 运行；可用 `--project=v390 --project=v1440` 做开发期间的局部复核，交付仍运行完整矩阵。截图在忽略的 `data/tests/ui-redesign/`，测量清单在 `.development/evidence/ui-redesign/`。本机 Chromium 的触控/可视高度仿真不等于实体手机系统键盘验收，报告须明确范围，截图与自动断言均需人工复看。

本机按顺序执行测试，Vitest / Playwright 各限一个 worker，构建限两个任务，不同时运行多套 E2E 或对同一依赖进行重启/恢复。HTTP 集成与浏览器邮件流程使用真实 Mailpit；E2E 每轮创建唯一临时数据库并在结束后删除，仅使用测试账号。认证流程禁用 trace 和截图，防止密码、二维码或恢复码进入测试附件。API 与邮件 Worker 共享测试服务进程，结束后关闭连接和独立队列，不额外启动常驻 Worker。

## 贡献与提交

1. 用 git status / git diff 检查当前实现，保留用户修改和历史。
2. 围绕完整开发单元同步代码、契约、迁移、测试与文档。
3. 提交前执行关联检查，交付前运行 pnpm verify；文档还需检查 Markdown、链接、命令和内容真实性。
4. 审查 git diff --cached，核对内容与文件大小，凭据和私有数据不进入提交。
5. 按关键模块或阶段成果提交；同一逻辑单元的小改动集中，无关变更分开。

所有新增提交使用带 scope 的 Conventional Commits：

```text
<type>(<scope>): <description>
```

type 使用 feat、fix、refactor、perf、style、docs、test、build、ci、chore、revert。scope 使用真实模块，如 auth、personas、releases、moderation、admin、ui、database、docker、workspace、readme。

```text
docs(readme): 优化项目介绍与本地运行指南
fix(moderation): 修复待审核版本的访问权限
build(docker): 完善生产环境容器编排
```

破坏性兼容变更用 type(scope)!: 或正文 BREAKING CHANGE:，说明影响和迁移方法。提交描述真实变更，不能将设计目标写成可用能力。

本地提交与远程发布分开授权。用户授权的完整开发单元应按 AGENTS 形成本地提交；git push、强推、破坏性重置与重写历史须有明确指示。不替用户改 Git 身份或丢弃他人修改。

## 文件与证据

.gitignore 排除 data/、环境秘密、依赖、构建、缓存、日志及测试私有状态。锁文件、SQL 迁移、生成客户端、必要夹具和许可证正文需要纳入 Git。第三方 Skill 按固定提交原样保存，其 Markdown 硬换行和许可正文空白保持上游内容。

开发进度、测试和扫描证据统一放在 .development/，不进入 Git；CI 可收集证据附件。依赖核验缓存缺失时从官方 registry 重新生成，安全扫描仍真实执行。公开截图使用脱敏内容。

本地设计和开发计划位于 .development/01_PRODUCT_DESIGN.md 与 .development/02_CODEX_BUILD_SPEC.md，进度和需求追踪也维护在该目录。镜像风险、平台核验与技术债保留内部记录，本地提交不表示生产放行。

## 原生平台与容器检查

浏览器测试按 desktop、tablet、mobile 串行运行，每个视口使用一个新建隔离数据库和真实限流命名空间，结束后删除该测试库。全程复用一套 PostgreSQL、Redis、Mailpit，仅运行一个浏览器 worker。`pnpm test:e2e --project=desktop` 可只运行指定视口；报告合并到 `data/tests/playwright/report/`，认证页面不采集自动截图和 trace。

`pnpm test:native` 下载并校验固定的官方 MaiBot / AstrBot 源码和镜像，用官方配置类与真实 WebUI 验证格式往返，要求 Docker 和已安装的 Playwright Chromium。先运行 `pnpm build:images` 串行准备固定镜像，再执行检查。原生进程没有外网路由，浏览器外部请求被阻断，不连接模型、平台账号或真实用户数据。

`pnpm test:compose` 在独立的 Compose 项目与空 `data/tests/` 目录验证初始化、迁移、真实 Caddy 上传与重启，不替换当前运行数据。上传检查使用隔离管理员验证 4 MiB JSON、超过 4 MiB 的 PNG 和完整 ZIP、草稿确认及 5 MiB / 128 MiB 超限拒绝与重试；凭据只通过子进程标准输入传递。排行榜探针通过真实 Caddy → Web SSR → API 检查伪造转发头被覆盖、不同真实网络来源的访客独立限流，以及同一访客的 SSR/API 读取共用配额；仅记录检查结果，配额通过正常读取请求产生。执行前暂停主站并串行运行，结束后恢复主站。`pnpm test:recovery` 使用本地开发服务执行停写、备份和隔离恢复，运行前保留本地工作并预留服务短暂停机时间。测试数据、原生环境、下载缓存与备份均位于忽略的 `data/`，开发验收记录位于忽略的 `.development/`。

`pnpm test:remote` 要求已经构建当前 API 与 Caddy 镜像，复用 PostgreSQL / Redis / Mailpit，创建独立测试库、隔离 HTTPS 图片服务和单个测试 Worker。夹具使用无公开端口、无外网路由的 Docker 内部网络模拟公网地址，专用 CA 只注入该测试 Worker；生产代码不接受关闭 TLS 或私网放行开关。检查真实证书、固定 peer、重定向、混合 DNS、大小限制、Outbox/BullMQ 幂等及未审图片不可公开，同时验证通用 JSON 的源图哈希、临时托管与确认后草稿转存，失败图片不能保存。结束关闭全部临时进程，记录不含凭据。

MaiBot 导出是三字段 TOML 片段。AstrBot 原生导入会移除系统提示词首尾空白，并使用目标平台的工具与 Skills 默认设置；适配器保留原文，导出预览展示兼容边界。平台原生消费与本站导入导出的真实流程分别验证，用户应在目标机器人中检查能力配置。
