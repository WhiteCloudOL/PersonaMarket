# 部署与配置

## 本地运行

要求 Docker、Docker Compose（已验证 5.3.1 / 5.5.1）与 Node.js 24.22.1。在根目录首次生成配置，再构建和启动：

```sh
node scripts/init-env.mjs
node scripts/build-images.mjs
docker compose -f compose.yaml -f compose.dev.yaml up -d --wait
```

已有 .env 时保留配置并从构建步骤开始。访问 http://127.0.0.1:8080 。开发组合只向回环地址开放站点 8080、PostgreSQL 15432、Redis 16379、邮件 SMTP 11025 和 Mailpit 收件箱 18025，容器间通过内部网络连接。本地使用测试邮箱，邮件保存在 data/mailpit/，不会投递到外部邮箱。

Windows 宿主机首次生成配置后，在 PowerShell 执行 `./scripts/secure-local-data.ps1` 保护 `.env` 和 `data/` 的入口 ACL，使用 `-Check` 可只读复核；已有子目录的显式权限需单独检查。Docker 容器内的 chmod 不代替宿主机 NTFS 权限，相关说明见 [开发环境](../CONTRIBUTING.md#开发环境)。

## 数据目录绑定

全部持久数据位于仓库根目录 data/，通过 bind mount 绑定到容器。仓库中的实际配置片段：

```yaml
services:
  postgres:
    volumes:
      - ./data/postgres:/var/lib/postgresql
  redis:
    volumes:
      - ./data/redis:/data
  api:
    volumes:
      - ./data/storage:/data/storage
  caddy:
    volumes:
      - ./data/caddy/data:/data
      - ./data/caddy/config:/config
```

PostgreSQL 18 的版本数据位于 data/postgres/18/docker。API / Worker 共用 data/storage。data-init 在启动时设置 Redis、私有目录及 Caddy 状态目录的属主和权限，服务进程保持非 root。首次配置或 `pnpm data:prepare` 会准备目录，`pnpm data:check` 可核验开发与生产组合的全部绑定。

| 宿主机目录                           | 用途                   |
| ------------------------------------ | ---------------------- |
| data/postgres/                       | PostgreSQL             |
| data/redis/                          | Redis AOF              |
| data/mailpit/                        | 开发邮箱，仅开发组合   |
| data/storage/                        | 私有文件               |
| data/caddy/data/、data/caddy/config/ | 证书和 Caddy 状态      |
| data/backups/                        | 备份与迁移归档         |
| data/cache/                          | 维护工具缓存和镜像归档 |
| data/tests/                          | 隔离验证数据           |

data/ 不进入 Git 或镜像构建上下文；保留整个目录可在容器重建后继续使用原有数据。停止容器使用 stop，重新启动使用 up -d --wait。

## 环境配置

.env 由初始化命令生成随机凭据，.env.example 只提供字段说明。手动配置时使用独立高熵密码与两把不同的应用密钥。

| 字段                                | 用途                                                             |
| ----------------------------------- | ---------------------------------------------------------------- |
| PUBLIC_ORIGIN / CADDY_DOMAIN        | 对外地址与 Caddy 域名                                            |
| POSTGRES_PASSWORD                   | 数据库迁移所有者密码                                             |
| POSTGRES_APP_PASSWORD               | 受限应用账户密码                                                 |
| REDIS_PASSWORD                      | 队列连接密码                                                     |
| APP_ENCRYPTION_KEY / STATS_HMAC_KEY | 各自独立的 64 位十六进制密钥                                     |
| STORAGE_ROOT                        | 本机开发使用项目 data/storage 的绝对路径；容器固定 /data/storage |

Compose 使用内部连接地址覆盖本机连接串，开发组合使用本地 HTTP 地址。不要将 .env、证书、数据库或私有文件分发到仓库。

## 注册与邮件

生产默认 `AUTH_REGISTRATION_ENABLED=false`。配置 SMTP 并确认邮件投递后设为 true；API 会在接受注册前验证 SMTP 连接，失败时关闭注册入口并返回可重试错误。验证与密码重置邮件通过事务 Outbox 和 Worker 发送，链接有效期 30 分钟且只能使用一次，重新申请使此前同用途链接失效。

| 字段                      | 含义                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| AUTH_REGISTRATION_ENABLED | 是否允许新用户注册，true / false                                    |
| AUTH_SESSION_TTL_SECONDS  | 普通完整会话有效期，默认 86400 秒，范围 600—604800                  |
| SMTP_HOST / SMTP_PORT     | 邮件服务器与端口，默认端口 587                                      |
| SMTP_SECURE               | 465 隐式 TLS 填 true，587 STARTTLS 填 false；生产强制加密与证书校验 |
| SMTP_USER / SMTP_PASSWORD | SMTP 账号与密码，同时填写；可信内网 relay 可同时留空                |
| SMTP_FROM                 | 经提供商验证的发件邮箱                                              |

管理员可以在「站点设置 → 邮件服务 SMTP」选择部署环境配置、自定义 SMTP 或关闭邮件。自定义密码加密保存，仅显示是否已配置；更新时显式选择保留、替换或清除。API 与 Worker 在后续操作读取已保存配置，不需要重启；选择环境配置时，修改 .env 后仍须重新创建服务。保管原始 APP_ENCRYPTION_KEY，丢失后无法解密 SMTP、MFA 和待发邮件。

测试邮件仅投递到当前管理员的已验证邮箱，每十五分钟最多三次；保存后再发送测试，失败提示可以重试，不能由客户端指定任意收件人。生产 SMTP 强制 TLS 和证书检查，本地 Mailpit 允许开发内网明文连接。

「账号设置」可以控制新用户注册、验证邮件时机、注册尝试频率与新会话期限；期限范围为600—604800秒，既有会话保留原到期时间。验证邮件默认注册时自动发送，也可改为用户登录后主动申请；两种模式仍要求SMTP就绪，公开写入仍需验证邮箱。频率默认每IP每小时10次，允许收紧为1—10次/60—3600秒，并保留固定每IP每小时10次硬保护。恢复默认只填入候选，明确保存后生效；并发更新需核对最新修订。完整规则、客户端刷新边界和0048升级说明见[注册与账户设置](ACCOUNT_SETTINGS.md)。

`PUBLIC_ORIGIN` 必须是实际访问的 HTTPS origin，生成链接与 CSRF 均依赖此值；localhost 与 127.0.0.1 是不同 origin。生产不使用 compose.dev.yaml 或 Mailpit。

## 创建与保护管理员

管理员通过受控维护命令创建，公开注册的账号始终为普通用户。先启动并完成迁移，再执行：

```sh
docker compose --profile maintenance run --rm admin
```

命令交互输入用户名、管理员邮箱和 12–64 个 Unicode 字符的密码，密码输入隐藏，凭据不作为命令参数。开发组合也可在命令中增加 `-f compose.yaml -f compose.dev.yaml`（置于 `--profile` 前）。维护容器使用单独的所有者连接，常驻 API / Worker 保持受限数据库身份；本机贡献者也可使用 `pnpm admin:create`。

管理员可直接使用密码登录，在「账号与安全」自愿绑定支持 TOTP 的身份验证器。绑定时确认动态验证码并离线保存十个一次性恢复码；已绑定的账号随后登录仍需要动态码或恢复码。

有效管理员会话可正常浏览后台、审核他人作品、编辑品牌与创作投稿设置。账号和权限、密码/MFA 与会话安全策略、SMTP 连接与密钥、管理员自审、封禁和恢复等高危操作要求十分钟内的身份验证；已绑定 MFA 使用动态码或恢复码，未绑定则使用当前登录密码，密码登录本身也计入近期验证。过期时在当前页面确认，原有输入会保留，验证后再次点击操作；密码确认旋转会话，已绑定 MFA 的账号不能使用它绕过二次验证。设置保存另有版本冲突保护，防止覆盖其他管理员的修改。

恢复码需要密码配合，每个仅可用一次。遗失全部二次验证凭据时应由所有者执行受审计的人工恢复流程，不存在公共 MFA 绕过入口。管理员邮箱由维护操作者核实，因此受控创建时标为已验证。

## 账号安全与邮箱变更

用户在「账号与安全 → 密码与邮箱设置」更新密码、申请新邮箱确认及提交或撤回停用申请。新密码为 12–64 个 Unicode 字符，拒绝完整常见口令和明显的账号口令；登录仍支持历史密码长度，不截断原始输入。已启用 MFA 的账号在敏感操作前需近期二次验证，未绑定 MFA 的管理员使用近期密码确认。

修改密码需要当前密码，成功后撤销所有会话与旧验证链接。新邮箱确认链接用途独立、绑定目标地址、三十分钟单次有效，重发使此前变更链接失效；确认前仍使用原邮箱，确认后撤销所有旧会话和安全链接，并向原已验证邮箱发送安全通知。链接令牌位于 fragment，由用户明确确认，普通 GET 不改变账号。

停用申请提交后可在同页查看和撤回，同一账号只允许一份待处理申请；待处理期间账号保持可用。站点管理员按受控管理流程处理停用，申请操作本身不删除账号、作品或私有文件。

## 对外运行要求

生产仅使用 compose.yaml，配置真实 HTTPS origin 与域名，数据库和 Redis 保持内网访问。迁移进程成功后应用才启动；Caddy 处理 HTTPS，服务具备健康探针和日志轮转。

Compose 使用 Caddy 作为 Web 与 API 的统一外部入口，两者的 `TRUST_PROXY_HOPS` 均设为 `1`。Web 只向公开榜单读取转发来自受信代理的单个合法访客 IP，保持每个访客独立限流；直接开发运行默认不信任转发头。增加前置代理时同步核对完整信任链和入口隔离配置。

当前配置用于本地运行。对公网发布前须完成依赖与镜像安全处置、业务权限验收和恢复演练，并提供 AGPL 对应版本源码获取方式；运行镜像采用固定摘要的精简系统和可审查补丁构建，构建时需访问官方镜像源、Go 模块源及 Alpine 软件源。

Caddy 按入口限制请求体：通用文件预览的 POST 请求为 129 MiB，原生文件预览 `/api/v1/me/persona-imports/preview/file` 与文本源预览 `/api/v1/me/persona-imports/text/source/file` 的 POST 请求为 5 MiB，图片上传的 POST 请求为 6 MiB，其他入口为 4 MiB。上传入口的额外空间用于 multipart 边界和文件名；API 继续执行通用 JSON/原生文本/TXT/Markdown 4 MiB、完整 ZIP 128 MiB、单图 5 MiB 的文件硬限及鉴权、配额和内容校验。前置其他代理时需同步这些入口限制。更新 `infra/caddy/Caddyfile` 后执行 `docker compose -f compose.yaml restart caddy` 加载配置。

升级前按 [OPERATIONS.md](OPERATIONS.md) 备份数据库与私有文件，构建新镜像后先停止旧版 API、Worker 和 Web 写入进程，再运行单一迁移进程，迁移成功后启动新应用。包含 `0019_public_search_projection` 的升级会启用 PostgreSQL 自带的 `pg_trgm` 扩展，并在迁移锁内分批重建公开搜索字段与首次发布时间；迁移账号需具有创建该受信扩展的权限。重跑迁移可继续未完成批次，原始已审核正文和来源声明保持不变。升级失败时保持停写并排查，勿启动旧版写入进程覆盖新搜索投影；回退应用和数据库应使用同一份已验证备份。

数据维护和历史目录迁移见 [OPERATIONS.md](OPERATIONS.md)。

`0021_import_preview_budget` 将原生导入临时预览的数据库上限从 2 MiB 对齐到草稿既有的 4 MiB，保留旧预览及其过期、哈希和归属信息。应用在同一写事务中按实际 `jsonb::text` 大小检查预览及最终草稿，原始文件上传仍为 4 MiB，正文超限或无法存储的字符会返回明确输入错误。升级前按上述流程备份并停写，迁移成功后再启动新应用；升级后可能存在大于 2 MiB 的预览，回退到旧版本时须恢复匹配的数据库备份，不直接缩小约束或删除现有预览。

## 服务恢复与页面重试

数据库明确报告正在关闭或恢复时，API 返回 `503 SERVICE_UNAVAILABLE`，临时不可用响应附带 `Retry-After`。客户端可按提示重试读取，写入操作继续遵循对应接口的幂等与版本校验规则。

首页的站点介绍和社区统计读取失败时，已有的成功结果会保留，并进行一次短暂重试。恢复网络或回到页面后会重新读取失败的请求；持续失败时保留明确错误提示。

## 公开列表接口兼容

`GET /api/v1/personas` 返回作品卡片摘要，包含平台、名称、简介、素材引用、分类标签、来源类型、发布版本和首次公开时间；列表中的 `snapshot` 不再携带正文、README、作者备注、模型说明和完整来源声明，顶层也不再返回更新日志。读取完整内容的客户端应使用 `GET /api/v1/personas/:id` 或对应的公开版本接口，并按 [OpenAPI 契约](openapi.json) 更新响应类型。
