# 第三方组件许可说明

核验日期：2026-10-26。

本项目自身软件采用 **AGPL-3.0**，完整协议见根目录 `LICENSE`，协议原文见 [GNU AGPL 3.0](https://www.gnu.org/licenses/agpl-3.0.html)。第三方组件仍由各自权利人按其上游条款授权，本项目不将其重新标为 AGPL。用户上传人设、素材和转载作品的许可按作品声明处理。

## UI 源码及图标

| 组件                                           | 实际版本              | 上游许可               | 说明 / 保留文件                                                                                                       |
| ---------------------------------------------- | --------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| shadcn/ui 组件与主题                           | CLI 4.22.1，Base Nova | MIT                    | 官方 CLI 生成的共享组件（含 Button、Avatar、DropdownMenu、Empty 等）与主题；许可副本 `third-party/shadcn-LICENSE.txt` |
| Base UI React                                  | 1.9.0                 | MIT                    | `@base-ui/react`；许可副本 `third-party/base-ui-LICENSE.txt`                                                          |
| Lucide React                                   | 1.61.0                | ISC                    | 图标及其上游声明；许可副本 `third-party/lucide-LICENSE.txt`                                                           |
| cn / class-variance-authority / tw-animate-css | 0.5.0 / 0.7.1 / 1.4.0 | MIT / Apache-2.0 / MIT | 类名组合、变体与构建时动画样式；完整包级信息见依赖许可清单                                                            |

这些组件的实际代码保留在 `packages/ui`，从官方注册源安装；源码调整不删除原版权和许可义务。认证与设置表单还使用官方 Input、Field、Label、Spinner、Separator、Switch、Toggle、ToggleGroup、AlertDialog、Textarea、Tabs、Select、Checkbox 和 Sheet，均由同版本官方 CLI 的 Base Nova 注册源生成。

常见密码拦截数据取自 SecLists 的 Xato 10,000 条完整口令列表，固定提交 `c205c36a445bff37f8e58a9ec829105cd4975c58`、原始 Git blob `e2bb6b64d278ae8854f0fd86913d01c899356b55`，来源记录随本地数据保存；仅服务端离线比较，不发送用户口令。上游采用 MIT，完整许可见 [SecLists-LICENSE.txt](third-party/SecLists-LICENSE.txt)，来源见 [固定上游文件](https://github.com/danielmiessler/SecLists/blob/c205c36a445bff37f8e58a9ec829105cd4975c58/Passwords/Common-Credentials/xato-net-10-million-passwords-10000.txt)。

认证使用 node-argon2 0.45.1（MIT）、Nodemailer 10.2.1（MIT-0）、OTPAuth 9.5.2（MIT）与 qrcode 1.5.4（MIT），包许可与传递依赖见下方清单。Argon2 捆绑参考 C 实现另提供 CC0-1.0 / Apache-2.0 选择，本项目采用 Apache-2.0，其完整原始声明见 [argon2-reference-LICENSE.txt](third-party/argon2-reference-LICENSE.txt)。开发邮件服务 Mailpit 1.32.0 采用 MIT，来源为 [官方固定版本](https://github.com/axllent/mailpit/tree/v1.32.0)，许可副本见 [mailpit-LICENSE.txt](third-party/mailpit-LICENSE.txt)。

## 应用与工具依赖

| 依赖组     | 主要组件                                                                             | 上游声明                                                    |
| ---------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Web        | Next.js、React、React DOM、TanStack Query、React Hook Form、Zod、Tailwind CSS        | 主要为 MIT；以实际安装包清单为准                            |
| API        | NestJS Core / Common / Express / Swagger、Helmet、RxJS                               | MIT、Apache-2.0 等，以包级清单为准                          |
| 数据与异步 | Drizzle ORM、pg、Redis Node client、ioredis、BullMQ、Pino                            | Drizzle ORM 为 Apache-2.0；其余以实际安装包清单为准         |
| 客户端生成 | Hey API OpenAPI TypeScript、openapi-fetch                                            | 工具与运行库分别保留上游许可；未复制不兼容的 SDK 运行时代码 |
| 工程工具   | TypeScript、pnpm、Turborepo、ESLint、Vitest、Vite、Playwright、Prettier、TOML parser | Apache-2.0、MIT 等，以实际包清单为准                        |

直接与传递依赖的名称、精确版本、作者和许可由 `pnpm licenses list --json` 导出，保存为 [依赖许可清单](third-party/dependency-licenses.json)。它是对已安装包声明的记录，不替代上游许可正文；分发时需保留依赖包内的 LICENSE / NOTICE。依赖变化后重新生成并审查，不以当前说明覆盖未来新增依赖。

本次共收集 736 个依赖记录，实际包内的许可及 NOTICE 正文汇总于 `third-party/npm-LICENSES.txt`；24 个包未附独立许可文件，单列于 [缺失文件清单](third-party/license-file-gaps.json)。这些包的元数据许可声明仍有记录，公开分发前需补核上游正文与对应通知义务，不能把元数据清单当作完整许可审结。

## 运行时与容器

| 组件                     | 固定版本         | 上游许可 / 来源                                                                                                             |
| ------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Node.js                  | 24.22.1          | Node.js 主体 MIT，捆绑组件有各自许可；保留发行包声明                                                                        |
| PostgreSQL               | 18.6             | PostgreSQL License，见 [官方许可](https://www.postgresql.org/about/licence/)                                                |
| Redis Server             | 8.2.7            | Redis 8 提供 RSALv2 / SSPLv1 / AGPLv3 选择，本项目采用其 AGPLv3 选项；见 [Redis 官方说明](https://redis.io/legal/licenses/) |
| Caddy                    | 2.11.7           | Apache-2.0，见 [Caddy 上游](https://github.com/caddyserver/caddy)                                                           |
| Debian / Alpine 基础系统 | 各镜像内实际版本 | 系统组件分别遵循自身许可；固定镜像摘要记录在 Compose / Dockerfile 中                                                        |

应用镜像同时附带根许可证及 `docs/` 下第三方说明。公开部署前，部署者需提供对应版本的完整源码获取方式；本任务没有替所有者创建或发布远程源码仓库。

## 项目级 Agent Skills

shadcn Skill 的 MIT 原文件保留在 `.agents/skills/shadcn/LICENSE.md`，副本见 `third-party/shadcn-skill-LICENSE.txt`。Vercel React Best Practices 与 Composition Patterns 的 `SKILL.md` 声明 MIT。`web-design-guidelines` 在固定上游提交中未附明确许可声明，保留作者和来源记录，不能擅自归为 MIT。精确提交保存在仓库 scripts/agent-skills.lock.json；来源为 shadcn-ui/ui 与 vercel-labs/agent-skills 官方仓库，文件完整性由该锁定清单校验。

## 补丁运行镜像与原生验证工具

Node 24.22.1 的完整捆绑组件声明见 [Node 许可](third-party/node-LICENSE.txt)，同时置于应用镜像 `/usr/share/doc/node/LICENSE`。Distroless cc-debian13 来自 GoogleContainerTools/distroless 官方镜像，基础系统保留各自许可，精确摘要见 Dockerfile。

Caddy 2.11.7 与 gosu 1.19 使用 Go 1.27.3 重新构建，Caddy 的 x/net 固定 0.60.0，模块校验值保存在 `infra/caddy-build/go.sum`。上游及 Go 模块许可分别见 [Caddy 与 Go 模块](third-party/caddy-Go-LICENSES.txt)、[gosu](third-party/gosu-LICENSE.txt)、[gosu 的 Go 模块](third-party/gosu-Go-LICENSES.txt)，对应文件也随运行镜像分发。PostgreSQL、Redis 服务版本保持 18.6、8.2.7，系统补丁版本明确写入 Dockerfile。

Caddy 的 go-jose v4 使用官方 4.1.6；其仍需使用的 v3.0.5 在镜像构建时移植上游提交 `a0111f82742fa92bceec9ede40845e73319e6230` 的 RSA 参数边界和私钥头部校验修复，保留 v3 接口及 Apache-2.0 许可。补丁、来源、模块校验值和逐文件前后 SHA-256 见 `infra/caddy-build/security/`，也随镜像保存在 `/usr/share/doc/caddy/security/`。构建先验证原始文件，再以零模糊匹配应用补丁并核对结果；JWK 默认接受的 RSA 模数上限为 4096 位，与上游修复一致。此补丁构建不代表上游发布了新的 v3 版本。

Caddy 的 klauspost/compress 固定为官方 1.20.2，修复特殊 zstd 帧导致解码器 panic 的问题（GHSA-fpmh-frq8-7rj8）；保留 BSD-3-Clause 许可。构建执行上游复现帧及普通压缩往返测试，模块校验值保存在 `infra/caddy-build/go.sum`。

PostgreSQL 补丁镜像固定 libcurl 8.23.0-r0，采用 curl 许可，完整上游声明见 [curl COPYING](third-party/curl-COPYING.txt)，镜像内同时保留 `/usr/share/doc/curl/COPYING`。curl 及 libcurl 保留各自许可，不改标为项目 AGPL 许可。

原生兼容性检查按 `tests/native/upstream-lock.json` 获取官方固定版本与校验和，仅在本地隔离环境运行 MaiBot、AstrBot，源代码和数据保存在不进入 Git 的 `data/`；不将上游应用源码并入本项目。测试用 Python 依赖采用 MaiBot 的锁定版本与发行包哈希，不进入生产应用镜像。运行或再分发这些上游应用及其镜像时，保留并遵守其自身许可和依赖声明。

## 创作与素材依赖

Markdown 使用 react-markdown 10.1.0、remark-gfm 4.0.1、rehype-sanitize 6.0.0；AST 分析使用 unified 11.0.5、remark-parse 11.0.0、unist-util-visit 5.0.0，均为 MIT。长文本编辑使用 CodeMirror 6 的独立 view/state/markdown/commands 包，MIT。服务端图片解码采用 sharp 0.35.5（Apache-2.0）及其发行包捆绑组件声明，网络地址分类采用 ipaddr.js 2.5.0（MIT）；精确包版本、libvips 组件及完整许可仍以随附清单和发行包声明为准。
