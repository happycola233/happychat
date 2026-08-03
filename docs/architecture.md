# HappyChat 工程文档

面向接手开发者，不是宣传材料。每节尽量落到具体文件、函数、命令和风险点。阅读顺序建议：先看 §1、§2 跑起来，再看 §5（生成链路）这是全项目最复杂、最容易改坏的部分。

---

## 1. 这是什么 / 当前状态

私有 AI 聊天站。服务端原生对接 OpenAI **Responses API**、OpenAI 兼容 **chat/completions**、Anthropic **Messages API**（文本/思考/联网/视觉/文件）与 OpenAI **Images API**（生图），再把各家上游事件翻译为统一 SSE 流回传浏览器。

- 已实现并验证：P0–P9 全部（鉴权+可配置的邀请码注册、Provider/模型后台、流式聊天、SSE 断线续传、对话分支、思考摘要、联网引用、图片/文件输入、gpt-image-2 生图/带参考图编辑、Markdown/LaTeX、暗色主题、生产单体托管）。
- **近期里程碑 A–D（本文档已据此更新）**：
  - **A 用户设置 + 聊天展示**：服务端持久化的账户级偏好（`user_settings.preferences`）、ChatGPT 风设置弹窗、消息时间/模型名/Token·TPS·耗时明细、字号、Enter 发送（桌面/手机分别配置）、自动滚动、头像/改密/删号/清空对话。
  - **B 管理后台重构**：细分为 概览/分析/请求事件/错误日志/账号中心/分享管理/供应商/模型/系统设置；recharts 可视化；分用户统计与成本估算（按模型定价 `models.pricing`）；`usage_logs.providerId` 支持按供应商筛选；错误日志补全 errorType/httpStatus 并落库全局 onError。
  - **C 模型配置增强**：提示词模板变量（请求时渲染并写 `runs.instructions`）；手动添加模型 + 可编辑请求体硬参数（JSON）。
  - **D 收尾**：chat/completions 协议支持（`model.kind='chat'`→`runChatEngine`）、聊天标题自动总结（`services/title.ts`，管理员可配模型/提示词）、分享聊天（快照，`shared_chats`）、会话列表三点菜单、编辑框重设计、移动端抽屉、克制动效。
  - **E 侧边栏文件夹 + 批量管理**：聊天文件夹（自定义颜色/Emoji 图标、可置顶，`folders` 表 + `conversations.folder_id`）；「聊天」分区标题右侧新增「批量管理/新建文件夹」按钮；批量模式多选后可批量删除/批量移动；文件夹设置弹窗用 frimousse（headless Emoji 选择器，数据由 `/api/emoji-data` 同源自托管）+ react-colorful（预设色板 + 自定义取色）。见 §7.2。
  - **F 独立分支对话**：助手消息操作区可把“根消息 → 该助手消息”的路径复制为新的独立会话，标题为 `分支 • 原对话名称`；附件使用新 ID 与独立磁盘副本，删除原对话或分支互不影响；不复制 run/event/usage 审计记录，避免后台统计失真，但会像 Token 一样复制总生成耗时与思考耗时快照，保证 TPS/耗时明细不丢失。
  - **G 模型按用户授权**：模型列表开关作为唯一全局上下架入口；每个模型另有 `all|selected` 可用范围，可按管理员/普通用户分组搜索勾选。用户端模型列表、发送、重新生成及标题总结均在服务端按当前用户二次校验，直接伪造模型 ID 也无法绕过。
  - **H 导出聊天**：六种格式（chatlog-md 对话日记 / Markdown / 自包含 HTML / JSON 全量 / JSONL messages / 纯文本）× 多维选项（消息范围与逐条选择、思考摘要、模型名、引用来源、检索过程（联网搜索 + X 搜索）、Token 用量、时间精度四档、附件三模式），弹窗实时预览，批量导出打包 ZIP（JSONL 合并单文件）。见 §3.3 `export/` 与 §7.2。
  - **I Anthropic Messages 原生适配**：Provider 协议选择、分页模型目录、Messages 请求体与 SSE block 聚合、thinking 摘要、原生 web search/引用/错误状态、`pause_turn` 自动续跑、完整 assistant blocks 私有重放，以及图片/PDF/文本附件映射。必填输出上限在默认参数栏可见，其余静态上游模板在高级 JSON 中可见。
  - **J 模型分组 + 模型/分组图标**：管理员定义的全站分组（`model_groups`，拖拽排序，独立管理页），模型单一归属（`models.group_id`，删除分组只把成员移回未分组）；用户端模型选择器提供「平铺（分组标题可折叠）」与「二级目录（文件夹式钻取）」两种视图，账户级偏好记忆，模型数 >8 时出现搜索框。图标三来源统一为一个 JSON 字段（自托管 lobe-icons 内置库 / 管理员上传 / Emoji），未配置时按 modelId 自动识别品牌图标，管理端可批量套用识别结果。见 §4.2、§7.2、§9.1、§10。
- 验证方式：`scripts/` 下脚本（Playwright 浏览器 E2E + 直连后端冒烟）+ 临时库冒烟；Base URL/Key 只在管理后台或临时环境变量中配置，不写进代码。
- `npm run typecheck` / `lint` / `test` / `build` 是合并前完整验证集；当前用例数以 §11 最新记录为准。
- `data/` 与 `.env` 已在 `.gitignore`。

---

## 2. 本地运行与命令

### 2.1 命令（`package.json` scripts）

| 命令                          | 作用                                           | 备注                                                          |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| `npm run dev`                 | 同时起后端+前端                                | `concurrently` 跑 `dev:server` + `dev:web`                    |
| `npm run dev:server`          | `node --watch --import tsx server/index.ts`    | 后端 **8787**，改动自动重载                                   |
| `npm run dev:web`             | `vite`                                         | 前端 **5173**，代理 `/api`→`127.0.0.1:8787`                   |
| `npm run typecheck`           | `tsc --noEmit` 分别跑 server/web 两个 tsconfig |                                                               |
| `npm run lint`                | `eslint .`                                     |                                                               |
| `npm run test`                | `vitest run`                                   | `{server,shared}/**/*.test.ts` + `web/src/**/*.test.{ts,tsx}` |
| `npm run build` / `build:web` | `vite build` → `dist/web`                      | 后端不需要构建，直接 `tsx` 运行                               |
| `npm run start`               | `NODE_ENV=production tsx server/index.ts`      | 静态托管 `dist/web`                                           |
| `npm run db:generate`         | `drizzle-kit generate`                         | 改 `schema.ts` 后生成迁移                                     |
| `npm run db:migrate`          | `tsx server/db/migrate.ts`                     | 也会在每次后端启动时自动执行                                  |

### 2.2 首次使用流程

1. `npm install`（`better-sqlite3@12` 在 Node24/Windows 走预编译二进制，无需 VS 构建工具）。
2. `npm run dev`，打开 `http://localhost:5173`。
3. 注册页提示「首位用户将成为管理员，无需邀请码」→ 注册即管理员；首位用户始终免邀请码，后续注册默认需要邀请码，管理员可在「系统设置」关闭该要求。
4. 进「管理后台 → 提供商」先选协议，再填 Base URL + Key → 测试连接 → 同步模型。OpenAI 兼容地址通常含 `/v1`；Anthropic 支持官方根地址或已含 `/v1` 的网关地址。
5. 「模型」页调能力/默认参数/思考等级；Anthropic 模型会预填可见高级 JSON 和私有上下文回传开关，确认后回聊天使用。

### 2.3 Windows 本地的两个坑（已写入 `docs` 与记忆）

- **关进程**：`tsx watch` / `vite` 由 `npm` 拉起，杀 `npm` 不会杀到孙进程。要按端口杀：
  `BP=$(netstat -ano|grep ':5173'|grep LISTENING|awk '{print $NF}'); taskkill //F //T //PID $BP`（Git Bash 里 `//F` 是对 `/F` 的转义）。
- **curl 传中文**：Git Bash 命令行里内联中文给 `curl -d` 会乱码（应用本身 UTF-8 正常）。测试要把 JSON 体用 Node 写到 `data/body.json` 再 `curl --data-binary @data/body.json`；`/tmp` 在 Node 看来是 `C:\tmp`（不存在），共享文件放 `data/`。

---

## 3. 仓库结构与模块职责

单仓库、非 monorepo。`shared/`（前后端共享类型与 zod schema）、`server/`、`web/`，靠 TS 路径别名 `@shared/*` 串起来。

### 3.1 别名解析（容易踩）

- tsc：每个叶子 tsconfig（`server/tsconfig.json`、`web/tsconfig.json`）各自声明 `paths: { "@shared/*": ["../shared/*"] }`，**无 `baseUrl`**（TS6/7 已废弃 baseUrl，加了会报错）。
- 运行时 tsx：读**根** `tsconfig.json` 的 paths。
- Vite：`vite.config.ts` 里手写 `resolve.alias`（不依赖插件）。
- vitest：`vitest.config.ts` 里手写 alias。
- **`server/db/schema.ts` 是唯一例外**：用相对路径 `../lib/id`、`../../shared/types/domain`，因为 `drizzle-kit` 不解析 `@shared` 别名。改这个文件时别改回别名，否则 `db:generate` 挂。

### 3.2 shared/

- `types/domain.ts`：领域类型 + JSON 列类型。关键：`ProviderProtocol='openai'|'anthropic'`、`ModelKind='responses'|'chat'|'anthropic'|'image'`、`ContentPart`（消息内容部件联合：`input_text`/`output_text`/`input_image`/`input_file`/`image_result`）、`ModelCapabilities`、`ModelParams`（含 `image` 选项）、动态 `ReasoningEffort` + `ReasoningEffortOption`（上游值/显示描述）、`MessageUsage`、`RunState`。
- `types/events.ts`：SSE 线格式 `WireEvent {type,seq,data}`、`RUN_EVENT_TYPE`（合成事件名）、`TERMINAL_EVENT_TYPES` + `isTerminalEventType()`。**前后端都依赖它判断终止**。
- `types/api.ts`：所有 HTTP DTO（`PublicUser`/`ModelDTO`/`AdminModelDTO`/`ConversationDTO`/`MessageDTO`/`SendResult`/`AttachmentDTO`/`InviteCodeDTO`/`AdminUserDTO`/`StatsDTO`/`ErrorLogDTO`/`UsageLogDTO`/`ApiError`）。
- `schemas/*.ts`：zod 请求校验（`auth`/`model-config`/`chat`/`admin`），同时导出推断类型供前端用。`chat.ts` 的 `sendMessageSchema` 含 `.refine`（text 或 attachments 至少一个）。

### 3.3 server/

- `index.ts`：启动入口。顺序：`runMigrations()` → `recoverInterruptedRuns()` → `startOrphanAttachmentCleanupScheduler()`（启动即扫 + 每小时扫）→ 建 `Hono<AppEnv>` → 挂 `/api/*` 路由 → 生产环境挂 `productionWebCacheMiddleware` 后 `serveStatic('./dist/web')` → `notFound`（`/api` 与缺失 `/assets/*` 返 404，其余生产环境回 `index.html` 做 SPA 回退）→ `onError`（`UpstreamError`→502 友好中文）→ `serve(8787)`；清理定时器已 `unref()`，服务器关闭时会显式停止。
- `env.ts`：`loadEnv()` 用 zod 校验 `process.env`，生产环境若 `SESSION_SECRET` 仍是 `dev-` 默认值则**直接退出**。
- `db/client.ts`：`better-sqlite3` + drizzle，开机设 `PRAGMA journal_mode=WAL / synchronous=NORMAL / foreign_keys=ON / busy_timeout=5000`，自动建 `data/` 目录。导出 `db`、`sqlite`。
- `db/schema.ts`：21 张表（见 §4）。
- `db/migrate.ts`：`runMigrations()` 用 drizzle migrator 跑 `db/migrations/`；也能 `tsx server/db/migrate.ts` 单独跑（用 `pathToFileURL` 判断是否被直接执行）。
- `lib/id.ts`：`newId()`(uuidv7) + `genInviteCode()`(8 位、去 I/O/0/1)。
- `lib/mask.ts`：`maskSecret` 仅用于 Provider API Key 的后台列表固定星号脱敏展示；Key 本体明文存库，编辑详情按管理员权限返回完整值。
- `lib/assert.ts`：`must(x)` —— insert().returning() 必然返回行的断言，去掉一堆 `!`。
- `auth/`：`password.ts`(scrypt，零原生依赖) / `session.ts`(签名 cookie `hc_session` + DB `sessions` 表，30 天) / `middleware.ts`(`requireUser`/`requireAdmin`) / `users.ts`(`toPublicUser`)。
- `http/types.ts`：`AppEnv = { Variables: { user } }`、`AuthUser = users.$inferSelect`。
- `http/web-cache.ts`：生产 Web 缓存策略。等待最终响应后按 `Content-Type` 与状态分流：所有 HTML/固定 URL/错误响应使用 `no-cache`，仅成功的 Vite `/assets/*` 哈希资源使用 `public, max-age=31536000, immutable`；避免浏览器启发式缓存旧入口，也避免长期缓存 404。
- `http/validator.ts`：`jsonValidator(schema)` 包 `@hono/zod-validator`，校验失败返回中文。
- `provider/`：上游适配，见 §6。
- `runs/`：生成核心，见 §5。
- `storage/files.ts`：本地文件存储，见 §9。
- `export/`：**聊天导出**。`collect.ts`（归属校验 + 当前分支/全树范围 + 逐条选择过滤 + 附件行解析与读盘降级）→ 六个格式构建器：`chatlog-md.ts`（严格遵循 dialogary [《chatlog-md 格式规范 v1》](https://github.com/happycola233/dialogary/blob/main/chatlog-md-%E6%A0%BC%E5%BC%8F%E8%A7%84%E8%8C%83.md)——行首哨兵、front matter、日期节、`> 🤔` 思考块、`🖼️/📄` 附件行、`<!-- @meta -->` 扩展点、§10 反斜杠转义；转义只针对**严格匹配哨兵正则**的行，保证往返保真）、`markdown.ts`、`text.ts`、`json.ts`（happychat-export/1，full 范围含整棵分支树 + activeLeafId）、`jsonl.ts`（OpenAI messages，一行一会话；会话无任何有效样本时返回 null——单会话报 `empty_selection`、批量跳过该行，不产出空 `messages` 的无效样本）、`html.ts`（unified + rehype-raw/sanitize 服务端渲染 Markdown，附件内联 data URI，浅/深主题自适应单文件）；`index.ts` 编排（预览模式不读盘但用 existsSync 保证展示一致、批量导出每会话独立文件夹）。**防护与保真**：① 导出构建有全局并发闸（同时最多 2 个，排队等待），配合 512MB embed 字节预算兜住进程内存峰值；② `archive.ts` 用 fflate 流式 `Zip` 逐条目推进——同一时刻至多一个压缩 worker（一次性 `zip()` 会给每个 ≥160KB 条目各起一个 worker 且无上限），条目数超 ZIP 的 16 位上限（65535）时报 `too_many_files`（413）而非静默产出损坏文件；注意 `AsyncZipDeflate` 会把输入缓冲区 transfer 给 worker，须推副本；③ 正文只去首尾空白行、保留首行缩进与行尾空格（`textOfContent`，整段 trim 会破坏缩进代码块/硬换行）；④ Markdown/chatlog 的附件链接目标经 `encodeAssetHref` 百分号编码（空格/`#`/`%`/括号，CJK 保持可读），citation URL 经 `sanitizeLinkUrl` 编码换行/控制字符/括号，防止伪造 chatlog 行首哨兵；⑤ chatlog front matter 的 YAML 歧义标量（`true`/数字等）加引号保持字符串类型；⑥ scope=full 的 JSON 在流式占位被剔除时把 `activeLeafId` 回退到最近存活祖先，不留悬空引用；缺失附件占位沿用 content 引用的 kind/文件名提示。选项 zod schema 在 `shared/schemas/export.ts`（批量上限 `EXPORT_BATCH_MAX=1000`，前后端同源）；**格式能力矩阵 + 归一化**在 `shared/util/exportOptions.ts`（前端据此禁用控件、服务端据此在构建前钳制选项，两端共用同一份事实）。
- citation 的公共安全边界由 `shared/util/url.ts#safeHttpUrl` 提供：站内消息、公开分享页及 Markdown/chatlog/HTML 导出都只生成 `http(s)` 链接；导出层再用 `sanitizeLinkUrl` 编码换行、控制字符与括号，防止破坏文档结构。
- `services/`：`models.ts`/`model-groups.ts`/`lobe-icons.ts`/`conversations.ts`/`conversation-branches.ts`/`folders.ts`/`admin.ts`/`providers.ts`（`syncProviderModels` 供后台同步模型使用）—— DB 查询 + DTO 映射，路由层只编排不写复杂 SQL。`conversations.ts` 的 `deleteConversations`（单条删除与批量删除共用，级联消息/runs 并清理附件行+磁盘文件）、`moveConversationsToFolder`（逐行保留 `updatedAt`，避免移动打乱最近排序）；`conversation-branches.ts` 在事务中复制目标路径并管理附件文件回滚；`attachment-cleanup.ts` 回收满 24 小时仍未绑定消息的上传，并负责后台调度。
- `routes/`：`auth`/`admin`/`models`/`conversations`（含 `POST /batch-delete`、`POST /batch-move`、`POST /export-batch`、`POST /:id/export`（preview=true 返回 JSON 预览，否则文件流 + RFC 5987 中文文件名）、`POST /:id/branch`）/`folders`（文件夹 CRUD + 置顶）/`emoji-data`（自托管 Emojibase 数据，公开读）/`model-icons`（自托管 lobe 图标 + 自定义图标读取，见 §9.1）/`runs`/`attachments`/`shares`/`announcements`，见各节。

### 3.4 web/src/

- `main.tsx`：挂 `QueryClientProvider`，引入 `katex` 与 `highlight.js/styles/github-dark.css`。
- `App.tsx`：`RouterProvider` + `Toaster` + 主题 `applyTheme` 副作用。
- `router.tsx`：守卫 `RequireAuth`/`RequireAdmin`/`RedirectIfAuthed`；聊天路由 `/` 与 `/c/:id` 共用 `ChatLayout`；后台 `/admin/*` 共用 `AdminLayout`。
- `api/`：`client.ts`(fetch 封装 + `ApiRequestError` + `apiUpload` 多部分) + 各域 API。
- `hooks/`：`useAuth`(useMe/useLogin/useRegister/useLogout) / `useModels` / `useConversations` / `useFolders`(+`useFolderActions`) / `useConversationActions`(删除/置顶/重命名/移动到文件夹/批量删除/批量移动)。
- `store/`(zustand)：`chat.ts`(用户偏好，**persist 到 localStorage**：模型/联网/思考/图片选项) / `stream.ts`(按会话 id 存活动流) / `theme.ts` / `toast.ts` / `folderEditor.ts`(文件夹设置弹窗全局状态) / `sidebar.ts`(侧栏折叠/分区折叠/**文件夹展开状态持久化**/移动端抽屉)。
- `sse/`：`eventReducer.ts`(纯函数折叠事件→`LiveMessage`) / `streamManager.ts`(Run EventSource 生命周期) / `conversationEvents.ts`(会话级元数据事件，如标题更新)。
- `chat/`：聊天 UI，见 §7。
- `pages/`：`LoginPage`/`RegisterPage`（外壳与表单控件在 `components/auth/*`，见 §7.5）+ `admin/*` 10 个页面。

---

## 4. 数据库设计（`server/db/schema.ts`）

### 4.1 约定（为了将来迁 PostgreSQL）

- 主键 `text` + UUIDv7（`pk()` 工厂，`$defaultFn(newId)`）。
- 时间 `integer({mode:'timestamp_ms'})`（不用 SQLite 的 `CURRENT_TIMESTAMP`）。
- 布尔 `integer({mode:'boolean'})`。JSON `text({mode:'json'}).$type<T>()`。
- 不用任何 SQLite 专有特性。迁移产物在 `db/migrations/0000_careful_gwen_stacy.sql`。

### 4.2 表与关键点

- `users` / `invite_codes` / `sessions` / `user_settings`：账号体系。`users` 增 `avatar_path`（头像，`GET /api/auth/avatar/:id` 公开读，供分享页复用）、`can_share`（null=随全局）。`user_settings.preferences`（列名仍 `ui_prefs`）现作为账户级偏好的服务端真值（主题 + 字号/Enter发送/时间格式/各展示开关等，见 §3.4 settings store）。
- `app_settings`：**全局设置单例**（一行）——`registration_requires_invite_code`（非首位用户注册是否必须使用邀请码，默认 `true`；首位管理员始终免邀请码）、`sharing_enabled`（全局分享开关）、`title_enabled`/`title_model_id`/`title_prompt`（标题总结）。`services/appConfig.ts` 读写。
- `announcements` / `announcement_reads`：**站内公告**。`announcements`（多条、可排期）——`title`/`body`(Markdown)/`level`/`channel`(silent/banner/modal)/`audience`(all/admins)/`status`(draft/published)/`pinned`/`max_impressions`（强弹窗通知次数上限）/`publish_at`/`expires_at`/`created_by`；可见性在**读取时**按 `status='published' 且 now ∈ [publish_at, expires_at]` 计算，无 cron。`announcement_reads`（复合主键 `announcement_id`+`user_id`）——`read_at`（null=仅曝光未确认）、`impressions`（强弹窗已曝光次数）；已读统计只算 `read_at` 非空。`services/announcements.ts` + 用户路由 `routes/announcements.ts`（`/active`、`/:id/read`、`/:id/impression`）+ 管理路由（CRUD、`/:id/readers`、`/:id/reset-reads`）。
- `shared_chats`：分享聊天（**快照**：`snapshot` 存分享时定格的消息 MessageDTO[]，可为**手动选择的分支子集**——选中集必须落在同一条 root→leaf 链上，校验在 `shared/util/shareSelection.ts`）——`token`(unique，`genShareToken()` 128 位全随机，不用可预测的 UUIDv7)、`owner_id`、`show_avatar`/`show_name`、`include_attachments`（false 时快照内用户上传附件的 `attachment_id` 已剥离为空串，分享页文字占位；`image_result` 不受影响）、`expires_at`、`revoked`。语义：更新分享保持原 token；`expiresInDays:'keep'/缺省` 保持现有到期时间；**撤销后再次分享必换新 token**（旧链接永久失效）。`services/shares.ts` + 公开路由 `routes/shares.ts`（附件响应 `no-store` + `nosniff`，非图片强制下载）。
- `providers`：`protocol` ∈ `openai|anthropic`，迁移 `0023` 默认 `openai`，因此旧记录行为不变；`api_key` 明文保存，列表固定脱敏、编辑详情按权限返回完整 Key。`models`：`capabilities`/`default_params`/`hard_params`/`allowed_efforts`/`pricing`/`tags` 都是 JSON；其中 `allowed_efforts` 新记录为有序 `{value,description}[]`，读取时兼容旧 `string[]`；`tags` 新记录为 `{label,color}[]`（`color=null` 按文字自动配色，或保存 `#RRGGBB` 自定义主题色），经 `shared/util/modelTags.ts normalizeModelTags` 兼容旧 `string[]` 并净化异常颜色；两项升级均无需 DDL。`kind` ∈ `responses|chat|anthropic|image`；`pricing`={input,cacheWriteInput,cachedInput,output,image}（USD/1M，缓存写入/读取分别定价，用于成本估算）；`description`（用户可见简介，选择器 ⓘ 展示）与 `tags`（用户可见标签，如「内测」「禁止滥用」，直接显示在模型列表）；`icon`（JSON `ModelIcon`，null=未配置→前端按 modelId 自动识别品牌图标）与 `group_id`（所属分组，null=未分组）见下方 `model_groups`；`capabilities` 是逐步追加的能力位（`x_search` 为 2026-07 新增，历史记录没有该键，出参前经 `shared/util/modelCapabilities.ts normalizeModelCapabilities` 补齐为 false）；`default_web_search`/`default_x_search` 是两个相互独立的默认开关；`enabled` 是全局总开关，`access_mode` 为 `all|selected` 用户开放范围（旧记录默认 `all`）；**无 `(provider_id, model_id)` 唯一约束**（0012 迁移移除）——同一供应商下允许多条同 id 记录，参数不同的配置视为不同的模型实例，仅保留 `models_provider_idx` 普通索引。
- `model_user_access`：模型指定用户白名单（`model_id + user_id` 复合主键，双外键级联删除）。是否开放只由 `models.access_mode` 显式决定，绝不以“名单是否为空”推断；因此 `selected + 空名单` 始终表示无人可用，删除最后一位获准用户不会意外向全站开放。
- `model_groups`：**模型分组**（管理员定义的全站结构，非用户私有）——`name`/`icon`(JSON `ModelIcon`，null=默认文件夹图形)/`color`(#RRGGBB，null=中性色)/`sort`。`icon` 与 `color` 在产品语义上互斥：只有默认文件夹图形使用自定义颜色，显式图标使用自身外观；`shared/util/modelGroupAppearance.ts resolveModelGroupColor` 被服务端写入/DTO 与前端预览/渲染共同调用，旧的 `icon+color` 脏组合也不会在移除图标后让隐藏颜色突然复活。排序沿用 **models 的 `sort` 稀疏步长约定**（重排写 `(index+1)*100`），不用 folders 的 `createdAt` 排序：分组顺序即用户端分区顺序，需要管理员显式拖拽控制。`models.group_id` → `model_groups.id`（`ON DELETE SET NULL`；⚠ drizzle-kit 生成的 `ADD COLUMN ... REFERENCES` 会丢 `ON DELETE`，0024 迁移已手工补上，与 0013 同一个坑），索引 `models_group_idx`。`services/model-groups.ts` 删除分组时**不依赖 FK**，而是在事务里逐行把 `group_id` 置 null 并**写回各行原 `updatedAt`**——分组归属变化不该让模型看起来"刚被改过"（与 `deleteFolder` 处理会话同理）。
- `model_icons`：**管理员自定义图标库**（上传一次，可被多个模型/分组引用）——`name`/`storage_path`/`mime`。图标存在 `models.icon`/`model_groups.icon` 这两个 JSON 列里，**无法靠 FK 级联**：所有模型/分组写入先在同一个 `IMMEDIATE` 事务中经 `modelIconReferencesExist()` 校验 lobe slug/custom id 真实存在；删除图标时由 `clearCustomIconReferences()` 清空引用，并在事务提交前严格删除磁盘文件，删盘失败则回滚数据库变更。
- `folders`：**聊天文件夹**（每用户私有）——`name`/`color`(#RRGGBB，null=默认中性色)/`emoji`(图标，null=默认文件夹图形)/`pinned_at`。`services/folders.ts` + 路由 `routes/folders.ts`；删除文件夹时其中会话移回未分组（FK `ON DELETE SET NULL` + 服务层显式移出并逐行保留 `updatedAt`）。
- `conversations`：`active_leaf_id` 指向当前可见分支叶子（**无 DB 级外键**，避免与 messages 循环引用，应用维护）。`folder_id` → folders（`set null`；⚠ drizzle-kit 生成的 `ADD COLUMN ... REFERENCES` 会丢 `ON DELETE` 子句，0013 迁移已手工补上）。`system_prompt_override` 是保留的旧列，当前请求链路不再读取，确保管理员修改模型提示词后旧对话立即生效。
- `messages`（**合并了节点树与内容，单表**）：`parent_id` 自引用构成分支树（无 DB 外键）；`content` 是 `ContentPart[]`；用户消息的 `runtime_context` 冻结发送时的日期时间/时区，Responses 构建时展开为虚拟 system item，Anthropic 则作为同一用户回合的首个 text block。历史列名 `reasoning_replay_context` 现保存 `ProviderReplayContext` 联合信封：Responses V1 是来源三元组 + 上游 context + 原样 reasoning items，Anthropic V1 是来源三元组 + 完整 assistant content blocks；两者都不进入 `MessageDTO`/分享快照。另有 `run_id`、`reasoning_summary`、`reasoning_duration_ms`/`generation_duration_ms`（展示快照，run 仍在时读取期现算值优先）、`annotations`、`search_actions`（web/X 检索动作及 Anthropic 搜索错误按真实顺序保存）、各 token 列、`error_message`。索引 `(conversation_id, parent_id)` 支撑树遍历。
- `attachments`：`storage_path` 是显式保存的本地文件路径（默认随 `DATA_DIR=./data` 存相对路径）；`message_id` 上传后、发送消息时才回填（无 DB 外键）。`message_id IS NULL AND created_at <= now-24h` 是孤立上传清理的基础候选条件；`attachments_message_created_idx(message_id,created_at,id)` 支撑 TTL 查询。历史上已被 `messages.content` 引用的异常行不会误删：引用仅在一个会话内时修复归属，异常跨会话引用则保持未绑定并持续受保护。
- `runs`：状态机（见 §5），`idempotency_key UNIQUE`、`last_sequence_number`、`assistant_message_id`（无 DB 外键）。
- `run_events`：`UNIQUE(run_id, sequence_number)` —— 续传游标 + 去重的命门。`data` 是净化后的统一事件，**绝不存图片 b64、Responses reasoning `encrypted_content`，也不存 Anthropic signature、`redacted_thinking`、搜索 `encrypted_content`/引用 `encrypted_index`**；这些 opaque 数据只进入服务端私有信封。启动迁移会用同一净化器一次性清理旧 Responses 密文行，查询条件天然幂等、自终止。
- `usage_logs` / `error_logs`：FK 多为 `set null`，所以**删用户/会话后日志仍在**（统计审计用）。`usage_logs` 冗余存 `model_label`/`provider_label` 并增 `provider_id`（按供应商/Key 筛选统计）；索引补 `(created_at)`、`(provider_id)`。`error_logs` 增 `(user_id)` 索引；现在 finalize/image-run 会写入 `error_type`/`code`/`http_status`，全局 `onError` 落 `scope='server'`。

### 4.3 外键级联策略

层级关系（sessions→users、models→providers、messages→conversations、run_events→runs 等）用 `onDelete:'cascade'`；循环/自引用的 4 个列（`messages.parent_id`、`conversations.active_leaf_id`、`runs.assistant_message_id`、`messages.run_id`）**无 DB 外键**，靠应用保证。日志表 FK 用 `set null`。

---

## 5. 生成核心链路（最复杂，重点读）

涉及文件：`runs/prepare.ts` → `runs/manager.ts` → `runs/engine.ts`(Responses) / `runs/chat-engine.ts`(chat/completions) / `runs/anthropic-engine.ts`(Messages) / `runs/image-run.ts`(图片) → `runs/finalize.ts` → `runs/emitter.ts` → `routes/runs.ts`(SSE) → 前端 `sse/streamManager.ts` + `sse/eventReducer.ts` + `chat/ChatView.tsx`。

### 5.1 发起（`routes/runs.ts` `POST /api/runs` → `prepare.ts`）

`prepareRun()`：

1. `getRunnableModel(modelId,userId)` 取模型+Provider（两者全局启用，且模型范围包含当前用户才行；管理员也不隐式绕过）。
2. 校验附件归属与能力（图片需 `vision`、文件需 `file_input`）；Anthropic 另校验图片 MIME/单图 base64 10MB、文件仅 PDF/`text/*`，不通过返 400。
3. 没 conversationId 就建会话。
4. 建 user 消息（parent = `args.parentId ?? conv.activeLeafId`；**编辑重发时传 `parentId` 使其成为兄弟分支**），并按浏览器 IANA 时区生成、冻结 `runtime_context`。
5. `createAssistantAndRun()`：先按 `model.kind` 完整构建并校验 body：`responses` 走 `buildResponseBody` + `buildInput`；`chat` 走 `buildChatMessages` + `buildChatBody`；`anthropic` 走 `buildAnthropicMessages` + `buildAnthropicBody`，系统提示词放顶层 `system`，runtime context 放到对应 user content 的首个 text block，图片/PDF/文本映射为原生 block。开启提供商私有上下文时，只有 Provider id/Base URL/上游模型 id 三元组完全匹配的历史 assistant 才使用服务端原始 Responses reasoning items 或 Anthropic content blocks，不匹配/未知版本跳过。`image` 走 `buildImageBody`/`buildImageEditBody`（prompt = 路径最后一条 user 文本；`gpt-image-2` 的 `size` 先按共享 util 校验）。请求体成功后才建 assistant 占位消息（status `streaming`）+ run（state `queued`，最终 instructions 随 insert 一次写入）→ **立刻把 `conversation.active_leaf_id` 指到新 assistant**；这样参数或附件内容错误不会留下没有 worker 的 queued run。

路由拿到 `prepared` 后 `runManager.start(...)` **异步**跑引擎，立即返回 `{runId, conversation, userMessage, assistantMessage}`。`/regenerate` 走 `prepareRegenerate()`（在原 user 消息下加兄弟 assistant，不建新 user 消息）。

### 5.2 引擎（`runs/manager.ts` 按 `model.kind` 分派）

- `runManager.start()`：建 `AbortController` 存进 `active` Map，按 kind 调 `runEngine` / `runChatEngine` / `runAnthropicEngine` / `runImageEngine`，`.finally` 时从 Map 删除。
- `runEngine`（`engine.ts`，文本）：`persistEmit(type,data)` 先用纯拷贝净化图片结果与 reasoning 密文，再**写 `run_events`（同步 better-sqlite3）并 `runEmitter.emit`**，自增 `seq`；原始对象仍留在内存供终态处理。先发合成 `run.created`，置 run `running`；然后 `for await` 消费 `client.createResponseStream(body, signal)`。delta 只负责低延迟累积，`response.completed/incomplete` 的完整 `response.output` 必须用于最终正文、思考摘要、引用、usage、状态校准，并在开关/effort 门控通过时从原始终态提取 reasoning items（单轮 JSON >256KB 整轮放弃并告警）形成私有重放信封；没有任何终态事件就 EOF 视为失败，不能把 delta 当最终真值。建流 4xx 可按原始 type/code/message 识别“不支持 include”或“历史 reasoning 无效”，仅在首个上游事件前去掉对应字段重试一次，流开始后绝不重试。中止（signal.aborted）→ state `canceled`。
- `runAnthropicEngine` 消费 `message_start`、`content_block_*`、`message_delta`、`message_stop`，把 `text_delta`、`thinking_delta`、URL citation 与 `server_tool_use:web_search` 翻译成本站统一 Responses 风格事件。thinking signature、`redacted_thinking`、搜索密文与引用索引只进入私有 replay；`pause_turn` 把上一段 assistant content 原样追加后继续请求（上限 8 段），各段 usage 相加。`max_tokens`/上下文窗口耗尽映射为 incomplete，但若截断内容含未配对的客户端或服务端工具调用，则不保存该轮 replay，避免下一轮构造出缺少 `tool_result` 的非法历史。`refusal` 不自动切换模型：该轮明确失败，作废已流出的正文、思考、引用与搜索动作；普通客户端 `tool_use` 因本站没有执行器同样明确失败并展示原因。严格要求终态与所有 content block 完整；仅兼容“已有 `stop_reason` 且所有 block 均收到 `content_block_stop`，但网关省略 `message_stop`”这一可证明完整的 EOF 变体。
- `runImageEngine`（`image-run.ts`，图片）：合成 `run.created`/`image.generation.in_progress` → `createImage` → b64 落盘为 attachment（关联 assistant 消息）→ 合成 `image.generation.completed{attachmentId}` → 内联 finalize（assistant content = `[{type:'image_result',...}]`，usage 记 `image_tokens`）。**非流式，无 partial_images**（见 §12）。

### 5.3 终结（`runs/finalize.ts`，文本路径）

单次 CAS：`UPDATE runs SET state=? WHERE state IN ('queued','running')`（防重复 finalize）。写 assistant 消息最终 content/状态/usage/reasoning/annotations；仅 completed/incomplete 可写服务端私有 `reasoning_replay_context`，failed/canceled 强制清空。随后写 `usage_logs`、失败时 `error_logs`、再 `persistEmit` 终止事件（`run.done`/`run.error`/`run.canceled`）。`run.done` 只携带校准后的 `text/reasoningSummary/annotations/searchActions/usage`，绝不携带私有信封；`status` 映射：completed→`complete`，failed→`error`，incomplete/canceled→`interrupted`。

### 5.4 SSE 续传协议（`routes/runs.ts` `GET /api/runs/:id/stream`，全项目最易写错处）

游标 `effectiveFrom = max(?from, Last-Event-ID)`。`streamSSE` 回调里：

1. **先订阅** `runEmitter`（实时事件进队列），再查 DB `run_events where seq>from`（**先订阅后回放**避免漏事件）。
2. 回放完若已见终止事件→关闭。
3. 否则查 run 状态：若已终态且 `!runManager.isActive`（引擎已结束或启动中断）→ 补查剩余事件，**没有终止行就按 run.state 合成一个**（启动中断的 run 没有持久化终止事件）。
4. 否则进实时循环：从队列取、`seq<=lastSeq` 去重、写出、遇终止事件 `return`。

- 客户端断开 → `stream.onAbort` 置 `aborted`，**不**中止后台生成。
- 第三参数 onError 吞掉写入异常（客户端掉线）。

### 5.5 启动恢复（`runs/manager.ts` `recoverInterruptedRuns`）

进程启动时把所有 `queued/running` 的 run 置 `interrupted`，对应 assistant 消息置 `interrupted` 并清空任何可能在终结写入中途留下的推理重放信封。**这是「无 worker/Redis」的代价**：进程一重启，内存里的 `active` Map 和 `runEmitter` 订阅全没了，正在跑的生成无法接续，只能标记中断。

### 5.6 前端消费（`sse/streamManager.ts` + `eventReducer.ts` + `ChatView.tsx`）

- `startStream({runId,conversationId,assistantMessageId,fromSeq,onTerminal})`：开 `EventSource('/api/runs/:id/stream?from=N', {withCredentials})`，`onmessage` 解析 `WireEvent`、`reduceEvent` 折叠进 `useStreamStore.byConversation[convId]`、更新 `lastSeq`、遇终止事件 `finish()`；`onerror` 自管退避重连（`1s→30s`，`MAX_ATTEMPTS=6`，超限置 `interrupted`）。**不靠浏览器自动重连**（fresh 连接不带 Last-Event-ID，所以总带 `?from`）。
- `ChatView.tsx` 是编排中枢：`onSend`/`onEdit`(带 parentId)/`onRegenerate`/`onSwitch`；`applyRunResult` 把新消息塞进 react-query 缓存并 `startStream`；`useEffect([id])` 做 **resume-on-load**（`getActiveRun` 查到未完成 run 就续传）；另一个 `useEffect` 做**交接**（流终止且 DB 消息已最终化 → `clearStream`，从内存流切回持久化内容）。
- `Message.tsx` 渲染时，若该 assistant 消息 id == 当前流的 `assistantMessageId` 就用 `live` 覆盖（流式文本逐段渐入/思考卡/生成中图片）。流式态给 `Markdown` 传 `animate`，靠逐单元淡入替代旧的打字光标。
- 前端不消费上游 `response.completed` 的内容终值（`output_item.added/done` 仅用于读取 `web_search_call` / x_search `custom_tool_call` 的生命周期与动作，不作为正文/思考来源）；本地合成的 `run.done` 是浏览器权威终值（含 `searchActions` 终态校准），因此服务端保留终态校准、同时从所有客户端事件中剥离重复 opaque 密文不会改变现有 UI 路径。

---

## 6. 上游 API 适配（`server/provider/`）

所有上游事实以**真实冒烟 + 官方文档/SDK 类型双重确认**为准。OpenAI Responses：`store` 默认 false（故本地重放，不发 `previous_response_id`）；`output_text.delta.obfuscation` 必剥；推理等级按模型配置门控。Anthropic Messages：`max_tokens` 必填、系统提示词是顶层 `system`、消息角色仅 user/assistant、SSE 是按 index 分块的增量协议。两条路径的错误都归一为 `UpstreamError` 与本站统一终态。

- `client.ts` `ProviderClient`：唯一对上游 fetch 的地方。OpenAI 用 `Authorization: Bearer` + `joinBaseUrl`；Anthropic 用 `x-api-key`、`anthropic-version: 2023-06-01` + `joinAnthropicUrl`，后者同时兼容根地址与已含 `/v1` 的网关。方法：`listModels`（Anthropic 自动按 `after_id` 分页并保留 capabilities/max_tokens）、`createResponse(Stream)`、`createChat(Stream)`、`createAnthropicMessage(Stream)`、`createImage`/`editImage`。Anthropic body 在 fetch 前序列化一次，并按 UTF-8 实际字节精确执行 32MB 限制。
- **思考摘要 part 边界**（`shared/util/reasoningSummary.ts`）：OpenAI Responses 的 reasoning summary 是结构化数组，流事件用 `item_id + summary_index` 标识独立 part，part 文本本身不保证含换行。`runs/engine.ts` 与前端 `sse/eventReducer.ts` 共用累积规则——同 part 的 token 连续拼接、切换 part 时补 Markdown 段落边界；`provider/normalize.ts` 的终态解析使用同一连接规则，`run.done.reasoningSummary` 再原子校准前端。`ReasoningCard` 的 `normalizeReasoningMarkdown` 仍兼容旧库中已被空串拼成 `**A****B**` 或 `<!-- -->**Next**` 的历史摘要，**不能用 CSS block 强行拆粗体**，否则会破坏普通行内 Markdown。
- **提供商私有上下文管理**（`reasoning-replay.ts` + `reasoning-replay-capture.ts` + `prepare.ts`）：历史 SQL 列名仍是 `reasoning_replay_context`/`replay_reasoning`，TS 属性已改为语义准确的 `providerReplayContext`/`replayProviderContext`。Responses 在有效 effort 下请求并保存终态 reasoning items（单轮 256KB 上限）；Anthropic 保存完整 assistant content blocks，覆盖 thinking/signature、`redacted_thinking`、server tool/result 密文和 citation index。两种 V1 信封都记录 Provider id、Base URL、upstream model id，下一轮三元组全等才原样注入。任何 DTO、分享、浏览器事件、usage/error 日志均不携带这些 opaque 数据。
- **chat/completions（`provider/chat.ts` + `runs/chat-engine.ts`）**：`buildChatMessages` 把分支路径转 `messages[]`（system=instructions，用户图片走多模态 content，文件输入忽略）；`parseChatStream` 解析 `content`/`reasoning_content` 与末尾 usage，再翻译成统一事件并复用 `finalizeRun`。
- **Anthropic Messages（`provider/anthropic.ts` + `anthropic-stream.ts` + `runs/anthropic-engine.ts`）**：必填的 `max_tokens` 由默认参数栏中同样必填的 `max_output_tokens` 映射，新模型预设 `16000`（Models API 报告更小上限时随目录钳制）；高级 JSON 明示顶层自动缓存 `cache_control`、thinking 模板与稳定基础版 `web_search_20250305`，默认不设置可选的 `max_uses` 搜索次数上限，并保持最终覆盖优先级。管理员删掉 thinking/web 模板后运行时不会补回。Models API capabilities（thinking types、effort 各档、image/pdf）优先于 ID 推断，缺字段的网关只对官方已知 ID/alias 使用精确 profile；未知模型不猜 thinking。Adaptive 型号映射 `output_config.effort`，manual-only 型号使用可见 `enabled+budget_tokens` 模板；两者默认以 `display:summarized` 返回公开 API 最详细的可见摘要，且只在思考开启时下发。Sonnet 5 等拒绝 sampling 的型号不从普通参数发送 `temperature/top_p`，高级 JSON仍可显式覆盖。
- **提示词模板变量 + runtime context（`shared/util/promptTemplate.ts` + `runs/promptVars.ts` + `runs/runtimeContext.ts`）**：每次请求读取模型当前最新提示词，渲染后附加固定 runtime context 协议并写入 `runs.instructions`（仅审计）；管理员更新后旧对话下一轮立即生效。用户消息的时间环境以独立、持久化的虚拟 system 消息重放；时间类模板变量仍兼容，但后台明确提示它们会降低精确前缀缓存命中率。
- **标题总结（`services/title.ts`）**：在 `finalizeRun` 成功分支 fire-and-forget；仅当会话标题为空时生成。按模型 kind 调 Responses/chat/Anthropic 非流式接口；Anthropic 默认思考型号会为短标题显式关闭 thinking，不能关闭的型号使用 low effort，避免小额度耗尽。`cleanTitle` 后存库，失败回退首条用户消息切片，并通过 conversation events + 短轮询双路径刷新侧栏/浏览器标题。
- **检索动作通用解析（`shared/util/searchActivity.ts`）**：Responses web_search 与 xAI x_search 收敛到同一个 `SearchAction[]` 有序数组；Anthropic `server_tool_use:web_search` 也翻译成相同生命周期和动作。Anthropic 的 HTTP 200 工具结果可能携带 `error_code`，会写入 `SearchAction.error`，并在浅/深色 UI 及 Markdown/HTML/TXT 等人类可读导出中明确标记搜索失败；URL citations 转为 `UrlCitation` 来源标签，链接只允许 `http(s)`。当前公共 citation 类型只展示 web URL 引用，PDF/文本 document citation 尚未映射。
- `params.ts` `buildResponseBody`：参数优先级 **高级硬参数 > 应用生成参数 > 用户请求 > 模型默认 > 代码默认**。思考按 `allowed_efforts` 校验后才发 `reasoning.effort`；历史推理开关 + 有效非 `none` effort 时加 `include:['reasoning.encrypted_content']`，`include` 与高级参数按去重并集合并（关开关不删除管理员手写 include）；联网仅 `capabilities.web_search && 开关` 才挂 `tools:[{type:'web_search'}]`，X 搜索同理挂 `{type:'x_search'}`（两者独立、可同时下发）；**`tools` 数组按工具身份（`responseToolMergeKey`）合并而不是整体替换**：命中已有条目时与应用生成的配置浅合并（管理员只写想改的字段），未命中时追加——但 `web_search`/`x_search` 这类**启停由开关决定的工具例外，未命中即整条丢弃**，因此高级 JSON 里的 `{"tools":[{"type":"web_search","enable_image_search":false}]}` 只是「参数模板」：开关开时生效、关时既不注入工具也不留下空 `tools` 字段（⚠ 早期实现里它会把工具塞回请求，令会话开关失效）。要让某模型恒开检索，改能力位 + `default_web_search`，不要靠高级 JSON 注入；`tools: []` 仍保留「清空全部工具」的兜底语义；开思考时 `max_output_tokens` 兜底 ≥25k（`REASONING_MIN_OUTPUT_TOKENS`）。所有文本请求写入会话级稳定 `prompt_cache_key`；最后 `mergeDeep(hardParams)`，因此高级 JSON 可显式覆盖该 key 并原样传递其他上游参数。chat/completions 同样处理。`buildImageBody`/`buildImageEditBody` 只组装 size/quality/background 与参考图；`gpt-image-2` 尺寸规则在 `prepare.ts` 调共享 util 校验，避免把 provider fetch 层写成业务校验层。
- `sse-parse.ts` `parseSSEStream`：按 `\n\n` 切块、按 `data.type` 标注、剥 `obfuscation`，处理跨块拼接与 `\r\n`/`[DONE]`。有单测。
- `normalize.ts`：`parseResponse`(非流式 Response → 文本/引用/思考/usage)、`mapUsage`（统一解析缓存写入 `cache_write_tokens` 与缓存读取 `cached_tokens`）、`buildAssistantContent`。
- `context.ts` `buildInput` 负责 Responses；`anthropic.ts buildAnthropicMessages` 负责 Messages。两者共用“只携带最近 12 张历史生成图”的常量与附件解析结果，避免视觉上下文/预算口径漂移。
- `errors.ts`：`UpstreamError` + `friendlyUpstreamMessage`（按 `error.type` 与 HTTP 状态映射）+ `networkError`。Anthropic 的 413/529、计费错误以及 HTTP 200 SSE `error` 都保留 type/code/rawMessage 供审计，并向用户给中文文案；流内错误没有 HTTP 终态时按官方类型精确还原 400/401/402/403/404/409/413/429/500/504/529，未知类型才记为 500。
- `model-defaults.ts` `inferModelDefaults`：OpenAI 按 id 推断；Anthropic 优先读取 Models API capabilities/max_tokens，并生成相符的 adaptive/manual/effort 配置。兼容网关只返回部分 capabilities 时按叶字段覆盖，未提供的 thinking type/effort 档继续继承官方已知型号 profile。Provider protocol 与 model kind 在服务端强制一致；协议切换、手动创建、目录同步/导入的最终检查与写入都在 SQLite `IMMEDIATE` 事务内，目录联网期间若 protocol/Base URL/Key 已变化则返回 409，不会留下协议与 kind 分裂的模型。

---

## 7. 前端架构（`web/src`）

### 7.1 状态分层

- 服务端状态：**TanStack Query**（`['me']`/`['models']`/`['conversations']`/`['conversation',id]`/`['admin',*]`）。
- 客户端持久偏好：**zustand persist** `store/chat.ts`（localStorage `happychat-prefs`）。
- 流式实时态：`store/stream.ts`（按 conversationId，**支持多会话并发流**）。
- 主题：`store/theme.ts`（localStorage `happychat-theme`）。

### 7.2 聊天组件（`web/src/chat/`）

- `ChatLayout`(Sidebar+Outlet+全局弹窗宿主 SettingsDialog/FolderEditorDialog/AnnouncementDialog) / `ChatView`(编排，见 §5.6) / `Sidebar`(会话列表+文件夹+批量管理+新建+删除+管理入口+登出+主题切换)。
- **侧边栏文件夹 + 批量管理（里程碑 E）**：
  - **分区规则**（`sidebarSections.ts`，纯逻辑+单测）：文件夹是「容器」（成员无论是否置顶都留在文件夹内），置顶是「快捷入口」（置顶聊天始终出现在已置顶分区，文件夹内聊天置顶后两处可见）；已置顶分区 = 置顶文件夹(按置顶时间倒序) + 置顶聊天，聊天分区 = 未置顶文件夹(创建序，位置稳定) + 未分组聊天。
  - **「聊天」标题右侧两个常驻小按钮**：批量管理（ListChecks，激活态高亮）与新建文件夹（FolderPlus）。
  - **文件夹行**（`FolderRow.tsx`）：裸图标（`folderVisuals.tsx` FolderGlyph——emoji 与实心文件夹共用 `iconSizing.ts` 的实际图标规格，默认 `sm=16px`，尺寸盒与图形同宽高且无 padding；Emoji 字号略小以补偿彩色字体更饱满的可视面积，因此不同图标后的名称严格对齐；行容器以 `min-h-8` 保持与普通聊天一致的高度，展开引导线按 16px 图标中心对齐；主题色经 `.hc-colored-glyph` 只作用于前景，浅色模式保留原始选色、深色模式向白色提亮）+ 名称 + 展开箭头 + 行尾计数（hover 让位给菜单按钮，`HOVER_CONCEAL_CLASS`）；菜单：文件夹设置/置顶/删除（删除仅移出会话不删聊天，走 `askConfirm`）。展开成员列表带缩进引导线；展开状态持久化；打开文件夹内会话时自动展开所在文件夹；折叠时若当前会话在内则行高亮。
  - **文件夹设置弹窗**（`FolderEditorDialog.tsx`，创建/编辑两用，全局挂载由 `store/folderEditor.ts` 驱动）：`FolderIdentityField.tsx` 让 44px 高的名称输入与图标触发器并排；触发器内仍是 24px 无底板裸图标，仅用同样无底板的 ChevronDown 表达展开状态，不再向 Emoji 叠加装饰角标，图形尺寸与点击热区各自独立。桌面端新建时自动聚焦名称、展开 Emoji 时自动聚焦搜索，移动端两处均不抢焦点（避免连续唤起软键盘）；Emoji 面板 = **frimousse**（headless，`EmojiPickerPanel.tsx` 懒加载、Tailwind 全自绘、`locale=zh` 中文搜索、数据走同源 `/api/emoji-data`——服务端自托管 Emojibase，不依赖公网 CDN）；颜色 = 默认灰 + 10 预设色板 + 自定义（**react-colorful** HexColorPicker/HexColorInput，`.hc-color-picker` 覆写样式）；面板均内联展开，Emoji 列表按弹窗剩余高度自适应并独立滚动（浏览器放大时不产生弹窗外层滚动条），Escape 先收面板再关弹窗。
  - **frimousse 的三个坑**（改 `EmojiPickerPanel.tsx` 时务必注意）：① `components` 里的 CategoryHeader/Row/Emoji **必须是模块级稳定引用**——内联创建会让父弹窗每次重渲染（如输入名称）都换组件身份，frimousse 把整个虚拟化列表卸载重建，滚动/交互明显卡顿；② 虚拟化要求单元格尺寸固定（不能 flex 拉伸，分类末行不满时会被拉宽），网格铺满是「按 40px 理想边长取整列数 → 均分可用宽度得实际边长」经 CSS 变量 `--hc-emoji-cell` 下发，容器 ResizeObserver 重算；③ 列表 DOM 里**首个 `[frimousse-emoji]` 是隐藏的尺寸测量行**（`visibility:hidden`），E2E 断言须限定 `[aria-rowindex]` 内的可见行。搜索框区域带背景 + `relative z-10`，防粘性分类头在特殊缩放下绘制逃逸盖住输入框；emoji 按钮 `title` 显示 Emojibase 中文名。
  - **菜单图标视觉重量**：行内菜单其余图标是 ChatGPT 风格 fill 自绘图标（等效笔画 ≈1.1px），菜单里的 lucide 描边图标（FolderInput/CornerUpLeft/FolderPlus）统一 `strokeWidth={1.6}` + `!h-[15px] !w-[15px]`（important 盖过 `RowMenuItem` 的 `[&>svg]:h-4`）对齐粗细。
  - **批量管理**：进入后行首圆形选择标记、整行点击=切换选中（选中行 sky 底色）、行内菜单隐藏；底部工具栏（`batch-toolbar`）：标题行 = 已选计数（未选中时显示引导文案「选择要管理的聊天」）+ 全选/取消全选 + 完成（深底胶囊，退出批量模式，与破坏性操作分排避免误触）；操作行 = 移动(上弹文件夹选择层)/导出(批量导出弹窗)/删除(确认弹窗) 三个等宽「图标在上、文字在下」的 ghost 按钮（无常驻底色、hover 浅底，删除为红色语义色；图标沿用行内菜单：FolderInput/Download/DeleteIcon）；操作完成自动退出；侧栏折叠为 rail 时自动退出批量模式。批量接口见 §3.3。
  - **移动到文件夹**：会话行三点菜单与顶栏 `ConversationMenu` 均含「移动到文件夹」二级视图（返回箭头 + `FolderMenuList.tsx`：文件夹列表/移出文件夹/新建文件夹…，新建后自动把会话移入）；行内菜单外点/翻转逻辑抽到 `rowMenu.ts` 的 `useRowMenu`（会话行/文件夹行共用，菜单切视图时重估上下翻转）。
- **顶栏（ChatView 内）**：悬浮层取代旧的文档流 header，无分隔横线；全新空聊天不渲染 `.hc-top-fade`，避免遮住 hero 输入框侧向展开的模型面板。进入会话或首条消息落底后，仅当聊天区宽度不足（消息列两侧留白 < 顶栏按钮簇宽度，阈值集中在 `topFade.ts`）时渲染模糊交叉渐变（backdrop blur + mask 渐隐）兜住划过按钮下方的内容，宽屏时按钮落在留白里、顶部完全不加渐变。左侧移动端为汉堡 + `ModelControlMenu`（桌面端模型选择器在输入框内）；右侧为 `NotificationBell` + `ConversationMenu`（三点菜单：分享/重命名/置顶/删除，复用 `RowMenuItem` 与 `hooks/useConversationActions`，重命名为居中小弹窗）。
- **桌面端新对话（hero 态）**：以**输入框视觉盒的几何中心**为锚点垂直居中——Composer 经 `onMetricsChange` 上报 `{height, boxCenterFromBottom}`，ChatView 按 `视口高度/2 − boxCenterFromBottom` 计算抬升量，盒子随行数长高时中心保持不动（向上下对称生长）；光晕 `.hc-hero-glow` 通过 `--hc-hero-glow-anchor` 共用同一锚点（`translate(-50%,50%)` 压中心），由账户偏好 `showNewChatGradientGlow` 控制且默认开启，随重点色自适应（默认灰重点色经 `--hc-accent-glow-tint` 借用蓝色重点色的色调，灰色光晕观感偏脏）、浅/深色两套宽扁大椭圆 radial-gradient（多段渐变近似高斯衰减、边缘收敛全透明）。「居中→落底」的平移动画与光晕/问候语/免责声明/底部遮罩的透明度过渡**只在新聊天里发出首条消息时启用**（`dockAnimated`），刷新/切换会话直接落位、这些装饰层立即显隐不过渡（否则免责声明会在错误位置闪一下）；落底时免责声明延迟 300ms 淡入，待输入框接近落位才出现。⚠ `dockAnimated` 只由定时器摘除（`DOCK_ANIMATION_SETTLE_MS`），不要按「回到 hero 就取消」——navigate 走 React Router 的 startTransition，发送成功后会有一帧 id 未更新、optimisticUser 已清空的瞬态 hero 渲染，会误触发取消并打断动画。**文字清晰度与升层时机**（`composerLayerWarm`）：合成层上的文字只有灰度抗锯齿、且 Windows 125%/150% 缩放下整数 CSS 像素抬升可能落在半个物理像素上被重采样，表现为问候语随机发虚、刷新才恢复——因此居中静止时**不**挂 `will-change`（正常渲染路径保证清晰），输入框有草稿（Composer 经 `onDraftPresenceChange` 上报）才预热升层（发送必先有草稿，发送瞬间依旧无「首次升层」掉帧），且抬升量按 `useDevicePixelRatio()` 对齐物理像素取整。移动端新对话输入框始终在底部、问候语居中显示。
- `Composer`：CSS Grid 区域布局（`.hc-composer-grid`）——单行时「＋｜输入｜模型+发送」同排，正文超一行或有附件预览时切换 `.hc-composer-multiline`（输入独占首行、控件退到次行两端），是否换行用隐藏镜像元素按“单行可用宽度”试排版判定（避免切换布局后宽度变化来回振荡）；正文最大 200px 内部滚动。**行扩展动画**：网格外包 `.hc-composer-expand` 容器，网格内容瞬时排版、容器高度经 ResizeObserver 跟随网格实测值做 0.2s 快出过渡，任何行数/布局变化都表现为盒子高度平滑生长（内容锚定顶部 `align-content:start`——正在输入的文字与光标全程可见、绝不被顶边裁掉，新空间在底部展开、控件行快速落位；曾用贴底锚定但首行文字会被遮一瞬，已按用户反馈改掉。动画期间打开 `overflow:clip`、静止时保持 visible 以免裁掉「＋」/模型菜单弹层；裁切标记用定时器摘除，reduced-motion 直接落位）。视觉盒浅色为低对比 hairline 描边 + 柔和弥散阴影（与 hero 光晕融合），深色以描边为轮廓。图片/文件上传聚合进「＋」弹出菜单（隐藏 `input[type=file]` 常驻 DOM，拖拽/粘贴/E2E 不受影响）。**附件选中即上屏 + 逐项上传进度**：`useAttachmentUpload` 持有 `UploadDraftItem[]` 三态列表（uploading/done/error，纯状态迁移在 `uploadDraft.ts`，有单测），文件选中立刻渲染卡片（图片用本地 object URL 预览，无需等上传完成），各文件并行上传、经 XHR `upload.onprogress`（`api/attachments.ts uploadAttachment`，fetch 拿不到请求体进度）逐项汇报进度；失败项卡片原位重试或移除（AbortController 中止在途请求），上传中/有失败项时发送按钮禁用（避免静默丢附件），发送时取 done 项的 `AttachmentDTO` 并 `clearUploads()`。卡片 UI 见 `AttachmentDraftList`：图片为 64px 圆角缩略图（上传中压暗 + 白色环形进度，失败中央重试按钮，右上角浮动移除），文件为「类型图标 + 文件名 + 扩展名·大小」卡片（上传中副行变进度条 + 百分比，失败副行变重试入口），composer 与消息内联编辑（`MessageEditForm`）共用同一组件，`data-status` 标注状态供 E2E 断言。**正文溢出滚动的顶/底渐隐（对齐 ChatGPT 输入框）**：`.hc-composer-primary` 上一层 `mask-image` 竖向渐变，渐隐高度由 `updateScrollFade` 随滚动位置注入 CSS 变量 `--hc-composer-fade-top/bottom`（各自封顶 `COMPOSER_SCROLL_FADE_PX≈24px`）——滚到顶则顶部不渐隐、滚到底则底部不渐隐（光标行始终清晰）、未溢出则两端都为 0（单行/短文本零渐隐、不误伤）；因为渐隐到透明、露出输入盒背景，浅/深色与拖拽高亮态都无需各自配色，且 thumb 只在中段出现、永不落进渐隐带。**正文滚动条**同处改为细、内敛、随主题淡色的自定义 `::-webkit-scrollbar`（8px、透明轨道、无上下箭头按钮），替换 Windows 原生「粗轨道 + 箭头」滚动条（深色下尤其割裂）。`modelControl` 槽渲染聚合选择器（桌面端）；`variant='hero'|'docked'` 控制免责声明与底部遮罩的淡入淡出。**发送/换行键位按设备类别分流**：经 `useIsMobile()` 在 `sendOnEnterDesktop`（默认开：Enter 发送、Shift+Enter 换行）与 `sendOnEnterMobile`（默认关：Enter 换行、点发送按钮发送）间选取生效值，两者均为可配置的账户级偏好。
- `ModelControlMenu`：**聚合选择器**（取代旧 ModelSelector + ChatControls）——一个触发器（模型名 + 思考深度短标签 + 联网状态小地球 + 箭头）聚合全部会话参数，桌面/移动共用同一套分区组件（`MenuSections`）：
  - **触发器胶囊宽度过渡**：切换模型 / 思考深度 / 联网状态导致标签文字增减时，胶囊宽度经 `hooks/useTriggerLabelWidth.ts` 平滑过渡而非瞬间跳变（桌面端与移动端触发器共用同一 `<button>`，故两视图一致生效）。结构为 `labelWrap`（`overflow-hidden`，只有它的 `width` 参与过渡）> `labelContent`（`w-max`/max-content，恒以最终排版渲染）> 模型名 / 思考短标签 / 地球；**下拉箭头在 `labelWrap` 之外**，扩宽时绝不被裁。关键点（对应历史踩坑）：① 内层恒为 max-content——即便外层被钉在旧窄宽度，新文字也不会被挤出省略号；② FLIP 起点在静止时取「上一次基线宽度」（此刻外层已重排到新宽度，直接测会误判为无变化而跳变），在途过渡时取当前实际渲染宽度以顺滑续接；③ 首次就绪 / 重挂载 / reduced-motion 一律直接落位，避免模型异步到达时从占位宽度「跳入」。触发器宽度变化会挤窄输入区，`Composer` 的 ResizeObserver 已一并观察控件列（trailing），及时重判单行/多行（见 §7.2 Composer）。
  - **模型列表**：唯一允许内部滚动的分区，打开时自动把选中项 `scrollIntoView`；含「生图」标记与选中对勾。行内直接显示管理员配置的**标签**（`components/ModelTags.tsx`；默认按标签文字哈希稳定配色，也可保存自定义主题色，浅/深色外观由 CSS `color-mix()` 分别派生，管理端所见即所得）与**图标**（`components/ModelIcon.tsx`，见 §9.1）；配置了**描述**的模型显示 ⓘ——桌面端悬停/聚焦经 portal 弹 fixed 定位气泡（列表内部滚动会裁剪 absolute 子元素），移动端点按行内展开。
  - **两种列表视图（里程碑 J）**：列表本体与分组逻辑已从 `ModelControlMenu.tsx` 拆到 `ModelListViews.tsx` + `modelGroups.ts`（纯逻辑 + 单测，对标 `sidebarSections.ts`），弹层外壳只留触发器、定位与参数分区。
    - **分区规则**（`modelGroups.ts` `buildModelSections`）：分组顺序完全跟随服务端 `sort`（不再二次排序，避免与管理端拖拽结果不一致），组内保持模型自身 sort 顺序；**空分组丢弃**；未分组作为 `group:null` 伪分区恒排最后（标题「未分组」）；**引用了未知分组 id 的模型归入未分组**——分组刚被删而缓存未刷新时绝不能凭空丢模型。
    - **平铺视图**：单列滚动，分组标题带 chevron 可折叠（折叠态若含当前选中模型，标题行右侧显示小圆点）；**完全没有分组时退化为原来的无标题平铺列表**，未配置分组的站点零感知。
    - **二级目录视图**：一级为分组行（无底板裸图标 + 名称 + 数量 + `ChevronRight`），点进为二级列表带「← 分组名」返回头；挂载时若当前选中模型在某组内则直接进入该组（延续原先 `scrollIntoView` 让选中项可见的意图）。
    - **搜索**：模型数 >8 时才出现（少量模型时搜索框纯属占地方）。有输入时**两种视图都退化为扁平结果**——此时用户找的是具体模型而非结构；命中分组名会保留该组全部模型（输入「Claude」期望看到整个 Claude 分组）。
    - **视图切换**：两个图标按钮（List / FolderTree）挂在「模型」分区标题右侧，仅在存在真实分组时渲染。选择存进账户级偏好 `modelPickerView`（服务端为真值，与主题/字号同一套）；分组折叠状态存 `store/modelPicker.ts`（localStorage，照抄 `store/sidebar.ts` 的 `expandedFolders`）。
    - ⚠ `useHeightTransition(desktopPanelRef, …)` 的 signature 现在是 `模型 id ␟ 视图`：只认模型 id 的话，切换视图导致的高度变化会跳变而不是过渡。
  - **尺寸过渡**：切换模型引起分区增减（思考/联网/图片参数）时，面板高度经 `hooks/useHeightTransition.ts` 做 FLIP 式过渡（平时不锁定高度、只在 model.id 变化那次提交临时接管 height），桌面弹层与移动 bottom sheet 都套用；**切换选项不自动关闭是有意为之**（三项设置聚合，用户常一次改多个）。侧向弹层（hero 居中）的水平位置在打开时按触发器宽度冻结 right 偏移——触发器右缘稳定、左缘随标签文字变化，若按左缘锚定（right-full）切换选项会带着面板晃动。
  - **思考深度**：横向分段选择，描述来自模型的动态有序配置，上游实际值保留在悬停提示与无障碍名称中；六档以内等宽，更多档位横向滚动。只在分区标题左侧显示当前档位的原版大脑图标（`max` 复用 `xhigh`，未知值回退 `high`），触发器和各档选项均不显示图标；高亮「本次请求实际会用」的档位（与触发器同口径），点击临时生效；分区标题右侧「固定/已固定」按钮把当前档设为新会话默认（再点取消），已固定但当前未使用的档位在右上角以小圆点标记。
  - **联网搜索 / X 搜索**：同一分区里的两行独立开关（`data-testid="web-search-toggle"` / `"x-search-toggle"`，仅在对应 `capabilities` 打开时出现），开关不关菜单；两者可同时开启，触发器上分别显示小地球与 X 标记。
  - **图片模型参数**：分辨率为 3 列预设网格，每项带按宽高比绘制的**比例缩略图**（auto 为虚线方框）；自定义宽高与画质分段各压成单行（行首对齐标签），保证整个参数分区在面板内完整可见、绝不滚动。
  - **桌面端**为锚定弹层（沉底会话在输入框内**向上**弹；宽度以 `w-80`/20rem 为紧凑下限，按模型行的固有宽度 `w-fit` 适量扩展，上限为 `min(24rem, 100vw - 1.5rem)`，因此名称与多个标签需要空间时才变宽，窄视口仍安全收敛；首选方向可用高度不足 <420px 且对侧更宽裕时在上/下之间自动翻转，并按所选方向动态限高，缩放动画原点随方向切换）。**新对话（hero 居中）时上下都窄、横向才宽裕，改为侧向弹**（`placement='left'`，由 ChatView 按 `heroComposer` 切换）：贴触发器左侧（`right-full mr-2`）、以触发器竖直中点为中心上下对称展开（`top-1/2 -translate-y-1/2`），按较窄一侧空间 ×2 动态限高、动画原点取 `right`。**移动端**为底部弹层 bottom sheet（`createPortal` 到 body，遮罩点击/Escape 关闭，顶部抓手、安全区内边距、更大的触控行高，动效 `hc-sheet-in` 克制快出），宽度仍铺满视口。面板内部为弹性布局——思考/联网/图片参数分区始终可见，仅模型列表在空间不足时收缩滚动（最低保留约 3.5 行）。
- `TimelineNav` + `timelineItems.ts`：**消息时间轴导航**（偏好 `showTimelineNav` 控制，默认开）。仅桌面端、当前路径用户消息 >3 条时显示在聊天区右缘中部：收起态为一列小横条（条数多时压缩间距），随滚动高亮当前所处的用户消息（`resolveActiveTimelineId`，激活线=视口 35% 处，触底归最后一条）；悬停/聚焦展开为可滚动预览列表（单行截断省略号，展开时高亮行自动滚入视区），点击经 `ChatView.scrollToMessage` 平滑跳转（暂停自动跟随并标记程序化滚动，避免误弹「滚动到底部」按钮）。纯逻辑在 `timelineItems.ts`（有单测）。
- `Message`：用户气泡(右) vs 助手(左、Markdown)；`live` 覆盖流式态；hover 操作区（复制/编辑/重新生成/创建新的分支对话）；`branch` 分支切换 `‹n/total›`；附件渲染。创建分支按钮使用从 ChatGPT sprite `#03583c` 提取的两条原始描边 path，`currentColor` 自动适配浅色/深色主题。
- `Markdown`：`react-markdown` + `remark-gfm`/`remark-cjk-friendly`/`remark-cjk-friendly-gfm-strikethrough`/`remark-math`/`remark-flexible-markers` + `rehype-raw`/`rehype-sanitize`/`rehype-katex`/`rehype-highlight`（只放行小范围安全 HTML 与安全 `span` 样式）；CJK-friendly 解析扩展修复粗体/斜体/删除线内容以中日韩标点结尾、闭合符后紧跟正文时的 CommonMark delimiter 判定，使用 `parseOnly` 入口且 GFM 删除线扩展必须置于 `remark-gfm` 之后；支持 GitHub Alerts blockquote 语法（`[!NOTE]`/`TIP`/`IMPORTANT`/`WARNING`/`CAUTION`，本地组件渲染，不扩大 sanitizer 白名单）；流式时按 `animate` 再挂 `rehypeStreamFade`：把正文按可见单元包 `<span class="hc-stream-seg">`，靠 CSS 让新到达文字逐段渐入，替代打字光标，代码/公式子树跳过；`PreBlock` 给代码块加复制按钮（读 `textContent`）；表格包横向滚动；`memo` 化避免流式每 token 全量重渲。
- `ReasoningCard`：组件内计时器（每 200ms）+ 思考中自动展开/完成自动折叠 + 自动滚底。**流式动画**：思考中（`status='thinking'`）摘要体给 `Markdown` 传 `animate`，复用正文的 `hc-stream-seg` 逐单元渐入；新小节整体以 `hc-reasoning-step-in` 低位淡入——与检索状态卡的 `hc-search-step-in` 共享 `hc-step-in` 关键帧（同时长/曲线），两卡运动语言统一；小标题在闭合 `**` 时整行一次性到达，`AnimatedSectionTitle` 按可见单元（`splitVisibleUnits`，CJK 逐字/ASCII 整词）注入逐单元 delay 做从左到右扫入（24ms 步长、360ms 封顶，呼应搜索词 chips 的错峰），圆点以 `hc-reasoning-dot-in` 同步弹现，单元按位置 key 保持身份避免正文流入时重播；完成页脚同样走 `hc-reasoning-step-in` 入场；完成/持久化态静态渲染不重播，动画均登记 `prefers-reduced-motion` 关停。⚠ 状态行与摘要体之间的间距放在可折叠容器内部（`pt-2`）而**不是根上的 space-y**：Tailwind v4 的 space-y 给前一个兄弟加 margin-bottom，折叠后 0 高度容器会留下死空间，导致「已思考」与下方搜索状态行折叠时间距偏大（已按用户反馈修正，勿改回）。
- `SearchActivity`：**检索状态卡**（思考卡下方、正文上方；分享页复用）。数据来自 reducer 的 `LiveMessage.searchCalls`（`{id,status,action}[]`，`persistedSearchCalls()` 把持久化 `MessageDTO.searchActions` 适配成同一形状）。**web_search 与 x_search 共用一条时间线**，保留两类检索真实的交错顺序（模型常常边搜网页边翻 X）。状态行：进行中按仍在跑的调用来源给出「正在搜索网页 / 正在检索 X 内容 / 正在搜索网页与 X」，文字流光（复用 `hc-reasoning-shimmer`，变量在 `.hc-search` 上重声明），图标静止（本轮只用到 X 检索时换成 `components/XLogo.tsx` 的品牌标记，否则用地球）；完成后按 `summarizeSearchActions` 拼「已搜索 N 个关键词 · 在 X 检索 K 次 · 浏览 M 个页面 · 读取 T 个 X 讨论串」（非零项才出现，页面按 URL、讨论串按 post id 去重）。明细为按时间序的动作行：搜索词 chips 逐个错峰渐入（`hc-search-chip-in`）、**web_search 进行中的调用先渲染流动骨架 pill**（查询词要等调用完成才回传，不猜内容）、动作到达时换 key 原位渐入；页面行显示「主机名+路径」并外链；X 行按子工具给不同图标（品牌标记 / 用户检索 / 讨论串），限定条件（`仅 @账号`、`排除 @账号`、日期范围、`Latest→按最新排序`/`Top→按热门排序`）作为浅色小字**与搜索词 chip 同处一个 `flex-wrap` 行**——⚠ 不要让它无条件另起一行：限定项可能只有排序模式，孤零零一个「最新」读者无法理解（已按用户反馈修正），因此每一项都译成自解释短语，且优先贴在 chip 右侧，`x_thread_fetch` 用 `https://x.com/i/status/<id>` 外链原帖（该形式不需要作者用户名）。自动展开/折叠：检索开始自动展开、正文开始输出或终态自动折叠，用户手动开合后自动逻辑让位；动画全部登记进 `prefers-reduced-motion` 关停名单。终态由 `run.done.searchActions` 校准，与流式解析一致时保留行身份避免重播入场动画；未解析出动作的占位调用在终态被丢弃，与刷新后读库口径一致。
- `buildPath.ts`：客户端从 `activeLeafId` 沿 `parent_id` 构建可见路径 + `getSiblings`（与服务端 `services/conversations.ts` 的 `buildPath`/`deepestLeaf` 对应）。
- **导出聊天**（`ExportDialog.tsx`）：三个入口——顶栏三点菜单、侧栏行菜单（id 冒泡 + 顶层单实例）、批量工具栏「导出」（`batch-export`，完成后自动退出批量模式）。弹窗 = 格式卡片（六种，`EXPORT_FORMAT_CAPS` 提供文案，`aria-pressed` 标注选中态）+ 选项区（能力矩阵联动：不适用的开关置灰并注明「当前格式不支持」；「消息范围」在批量模式同样可选——批量 JSON 才能导出全部分支树）+ 消息逐条选择（单会话且当前分支时；默认全选，`selected=null` 表示全部；与分享弹窗共用 `MessageSelectionPresets.tsx`，可快捷选择全部消息 / 全部用户消息 / 全部 AI 回复）+ 350ms 防抖实时预览（`preview:true`，`placeholderData` 保留上一帧防闪烁；查询键含打开弹窗时刻的 `previewEpoch`，重开弹窗不复用旧缓存——消息可能已更新）。下载走 `api/client.ts apiPostFile`（blob + 解析 `filename*`）→ `api/export.ts saveBlobToFile`；请求挂 AbortController，弹窗关闭（卸载）即中止在途下载，AbortError 不弹错误提示；批量超过 `EXPORT_BATCH_MAX`（1000）时前端预先禁用导出按钮并提示分批，不等服务端 400。
- **独立分支对话**：`POST /api/conversations/:id/branch {assistantMessageId}` 只复制该消息的连续祖先链，所有 message/attachment ID 与 parentId/attachment_id 都重写，`activeLeafId` 指向新助手消息；继承原文件夹但不继承置顶/分享。历史 `run_id` 清空，目标 run 的用户可调参数快照写入新会话 `params_override`，`getConversationLastRun` 在无 run 时回退到该快照，保证刷新后仍恢复正确模型/联网/思考设置；Token、总生成耗时、思考耗时则作为消息展示快照复制，删除原会话后 TPS/耗时仍可显示。旧消息尚无计时快照时，创建分支会先从仍存在的 run/event 计算；读取普通消息时 run 现算值优先、快照兜底。附件先复制文件，再以单个 SQLite 事务写会话、消息和附件行；文件或事务失败会清理本次新文件。

### 7.3 登录 / 注册页（`web/src/components/auth/*` + `pages/Login|RegisterPage.tsx`）

单列居中，**刻意不做「一半封面图 + 一半表单」的分栏**——本项目没有可用的品牌大图，硬塞图只会显廉价。视觉重心交给一层随重点色染色的柔和光晕，与新对话页输入框后方的 hero 光晕同一套语言。样式全部集中在 `index.css` 的 `.hc-auth-*`。

- `AuthLayout`：光晕层（`.hc-auth-glow`，裹在独立裁切容器里，页面滚动时不撑出横向滚动条）+ 品牌区（应用图标 / 标题 / 副标题）+ 磨砂卡片 + 底部切换链接（`AuthLink`，走 react-router 的 `Link`），右上角常驻 `AuthThemeToggle`。品牌区 → 卡片 → 底部链接以 `.hc-auth-in` 依次上浮（带 `animation-delay`，故关键帧必须 `both` 填充，否则延迟期间会先按终态画一帧再跳回起点）。
- **⚠ 磨砂卡片与光晕是一对约束**：卡片（`.hc-auth-card`）保留 ~0.7 的自有底色，光晕则铺得极大（`min(88rem,190vw) × min(60rem,150vh)`）且中段衰减很平。两者缺一都会让光晕的明暗过渡整条从卡片内部穿过去，看起来像上半截被打光、下半截是纯黑（已按用户反馈修正，不要为了「更透」调低卡片底色或收小光晕）。真正让面板读作磨砂的是 `::after` 那层内联 SVG `feTurbulence` 颗粒 + overlay 混合——平滑渐变背景上 `backdrop-filter: blur()` 其实看不出效果（模糊平滑色块等于没模糊）。深色另有一道极淡的上缘掠光（`::before`），再亮一点就会读成「顶部反光」。
- `AuthField` / `AuthPasswordField`：44px 高、左置语义图标、单行描述按「错误优先」只渲染一条（报错时表单不整体跳动）。**图标与右侧动作都绝对定位在 input 之上、input 铺满整个视觉盒**，这样 `-webkit-autofill` 的背景覆盖整块、不会在图标处留接缝；也正因如此字段底色必须是不透明实色。密码字段的眼睛按钮 `tabIndex={-1}`，避免从密码框按 Tab 落在它上面而不是提交按钮。
- **焦点色与主按钮同源** `--hc-accent-strong`（即发送按钮那套「重点色实心表面」token，默认灰重点色退化为黑/白）：选了彩色重点色时整页焦点、CTA、光晕同色，不会出现「蓝焦点 + 紫按钮」。描边/光环按比例调淡，因为首个字段自动聚焦，满强度的纯黑/纯白会让页面一打开就发黑/发白。
- 提交前校验直接复用 `@shared/schemas/auth` 的 zod schema（`authValidation.ts`），前端不复述「几位、允许哪些字符」；失败时把光标送到第一个出错字段（`inputRef`）。服务端返回的领域错误走 `AuthNotice tone="error"`（`role="alert"`）。
- 注册页：密码强度四档提示（`passwordStrength.ts` 纯逻辑 + 单测，`PasswordStrengthMeter` 放在标签行右侧，与下方错误行错开位置）；邀请码字段等宽大写 + 输入即归一化为大写去空格（服务端 `genInviteCode` 码表本就是大写且 SQLite `=` 区分大小写，否则小写输入会白白得到「邀请码无效」）；邀请码字段/首位管理员提示的显隐规则见 §8。
- `AuthThemeToggle`：登录前唯一能改主题的入口（设置弹窗要有账号才能开）。直接复用账户级 settings store —— `store/settings.ts` 的 `persistRemote` 会在 `['me']` 缓存为空时跳过回写（未登录明知会 401），偏好只留在 localStorage，登录后由服务端真值覆盖。

---

## 8. 鉴权与权限

- 会话：登录建 `sessions` 行 + 签名 httpOnly cookie `hc_session`（`auth/session.ts`）。**用 cookie 而非 Bearer**，正是为了让 `EventSource` 能自动带凭证做续传。
- 中间件：`requireUser`/`requireAdmin`（`auth/middleware.ts`），把 `user` 放进 `c.var.user`。
- 注册策略：`app_settings.registration_requires_invite_code` 默认开启，由管理员在「系统设置」切换。`GET /bootstrap` 以 `Cache-Control: no-store` 同时返回是否仍需初始化与 `registrationRequiresInviteCode`，注册页加载期间按“需要邀请码”保守处理，并据两者决定是否展示、提交邀请码；**只有邀请码字段与首位管理员提示等策略到位后才渲染**（用户名/密码/提交按钮一开始就可用，页面不摆空转加载态），因此开放注册的站点不会先闪出一个邀请码框再消失；注册失败会重新拉取策略以应对填写期间的开关变化。**首位用户（`users` 表为空）始终免邀请码并自动成为 admin，不受全局开关影响**。
- 邀请注册：`routes/auth.ts` 的 `POST /register` 在**单事务**里查重、读取当前注册策略并创建 user+user_settings。仅当“非首位用户 + 注册需要邀请码”时校验并兑换邀请码（`used_count<max_uses`、未过期、未停用）；关闭要求后直接创建普通用户，客户端即使残留提交有效邀请码也不会消耗次数。注册接口始终是最终权威，避免页面状态陈旧绕过策略。
- ⚠ 关闭邀请码要求等价于开放访客自助注册；当前没有注册验证码或专门的注册限流，公网部署应评估批量注册与资源滥用风险。
- ⚠ 没有独立的 `auth/invites.ts`，兑换逻辑内联在 register 里（计划里提过该文件，实际内联了）。
- 普通用户只能看自己数据：会话/消息查询都带 `userId` 过滤（`services/conversations.ts getOwnedConversation`）；附件读取校验 `userId`（`routes/attachments.ts`）；run 流校验归属（`getOwnedRun`）。
- 管理员自我保护：`routes/admin.ts` 禁止改/删自己（`id===c.get('user').id`→400）。

---

## 9. 附件与图片生成（`server/storage/files.ts` + `runs/image-run.ts`）

- 上传 `POST /api/attachments`（`routes/attachments.ts`，`c.req.parseBody()` 取 `File`）：先按扩展名规范化 MIME（例如浏览器上报为 `application/octet-stream` 的 `.log` 会转为 `text/plain`），再判 `isImageMime`→kind；通用上传层图片限 32MB、文件单个严格小于 50MB，落盘 `data/uploads/<uuid><ext>`，建 `attachments` 行，返回 `AttachmentDTO`。
- 读取 `GET /api/attachments/:id`：校验 `userId` 后 `new Response(buf)` 内联返回（`<img src>` 走同源带 cookie）。
- **删除清理**：删除会话（单条 `DELETE /:id` 与批量 `POST /batch-delete` 共用 `deleteConversations`）会一并清理其消息关联的附件行与磁盘文件；「清空全部对话」仍删除该用户全部附件。上传成功但没有发送消息的附件保持未绑定状态，`services/attachment-cleanup.ts` 在服务启动时立即扫描、之后每小时扫描，正常负载下约在创建后 24～25 小时删除孤立 DB 行与磁盘文件。单批最多处理 1000 个候选，一次调度会沿 `(created_at,id)` keyset 游标继续处理后续批次直至积压清空；前批失败项不会阻塞后续项，并会在下一次从头扫描时重试。消息历史在每次完整调度中只扫描一遍，按 250 条分页并主动让出事件循环；历史上“消息已引用但 message_id 仍为空”的异常行若只属于一个会话会原子修复，跨会话引用则保守保护。删除文件失败会回滚该附件的 DB 删除，日志包含 attachmentId 与错误阶段且错误样本有上限。
- **发送/清理并发**：`prepareRun` 把最终附件归属与磁盘存在性复核、新会话/用户消息写入、附件 `message_id` 绑定放在同一个 SQLite `IMMEDIATE` 事务；清理任务也用相同锁级别逐项重新核验 TTL。发送先赢则附件被绑定、清理跳过，清理先赢则发送返回 `invalid_attachment`，不会留下引用已删除文件的消息。自动删除还会拒绝 `DATA_DIR/uploads` 之外的污染路径。上传接口若在文件落盘后写 DB 失败，会严格尝试回滚磁盘文件，二次回滚失败会记录错误。
- 发送时不内联 base64 进 DB，`messages.content` 只存 `attachment_id`；`prepare.ts resolveAttachments` 在**构建请求那一刻**读盘。OpenAI 路径按当前分支全部 `input_file` 校验单文件 `<50MB`、合计 `≤50MB`。Anthropic 图片仅允许 PNG/JPEG/GIF/WEBP 且单图 base64 后 `≤10MB`，文件仅 PDF/`text/*`；`ProviderClient` 对最终 `JSON.stringify(body)` 的 UTF-8 实际字节做 32MB 精确校验，因此 system、长历史、tools 与私有 replay 都计入。
- 生图/参考图编辑：`gpt-image-2` 无图片输入时走 `/images/generations`；用户上传图片或在生成图上点“以此图编辑”时走 `/images/edits`（JSON `images[].image_url` data URL，实测返 `data[].b64_json`）。显式编辑源走 `sendMessage.imageSources`：已有消息归属的附件不会被改写，未绑定上传则会归属本轮用户消息；普通继续输入默认仍是新图，不会自动继承上一张生成图。`runImageEngine` 落盘成 attachment 关联 assistant 消息，`content` 存 `image_result`，前端 `Attachments.tsx` 渲染（`alt="生成的图片"`、`title=revised_prompt`）。生成中秒数以持久化的 `image.generation.in_progress` 时间为准，刷新后由 `/api/runs/active` 恢复。

---

## 9.1 模型 / 分组图标（`server/services/lobe-icons.ts` + `routes/model-icons.ts` + `web/src/components/ModelIcon.tsx`）

三种来源收敛到同一个 JSON 字段 `ModelIcon = {type:'lobe',slug} | {type:'custom',id} | {type:'emoji',char}`（`shared/types/domain.ts`），`null` 表示未配置。

- **归一化**（`shared/util/modelIcon.ts`）：`normalizeModelIcon(value: unknown)` 契约与 `normalizeModelTags` 完全一致——入参 `unknown`、绝不抛错、非法值静默降级为 `null`。slug 用 `LOBE_ICON_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/` 严格限制（**不允许点号**，挡住 `..` 穿越；不允许斜杠与标点，挡住 CSS/URL 注入），因为它会被拼进 `<img src>` 与 CSS `mask-image: url(...)`。Emoji 复用文件夹的单字素簇判定。zod 侧 `shared/schemas/model-group.ts modelIconSchema` 复用同一批常量，保证「写入校验」与「读取归一化」不漂移；两端都在 DTO 边界调用（`toModelDTO`/`toModelGroupDTO`）。
- **自动识别**（`shared/util/modelIconGuess.ts`）：`guessModelIconSlug(modelId, displayName?)` 按有序规则表（先具体后宽泛；GPT Image 明确映射 OpenAI 通用图标，避免误套 DALL·E 品牌）匹配约 54 个品牌，认不出返回 `null`（宁可漏判用首字母兜底，不可错判）。**未配置图标时前端在渲染层直接回退到这个猜测**，管理员什么都不配也能看到品牌图标；管理端「批量识别图标」只是把同一份猜测**固化成可编辑的显式值**。单测里有一条防回归断言：规则表引用的每个 slug 都必须真实存在于已安装的图标包（写错 slug 只会静默显示首字母，不报错）。
- **内置库自托管**：依赖 `@lobehub/icons-static-svg`（903 图标 / 2.3MB / MIT）。`services/lobe-icons.ts` 沿用 `routes/emoji-data.ts` 的模式（`createRequire` + `require.resolve` 从 node_modules 读，进程内缓存），不依赖公网 CDN，前端打包体积零增长。启动时 `readdirSync` 一次建 slug 白名单；`mono` 标记需要惰性读取全部文件，只有所有可见 paint 都来自 `currentColor`/`none` 且没有固定色或渐变时才为 true，避免把混合品牌色压成单色。
- **路由**（`/api/model-icons`，`requireUser`）：`GET /catalog`（903 项、约 31KB，`no-cache` + ETag，页面重载会确认资源版本，会话内仍只请求一次）、`GET /lobe/:slug`（白名单校验后返回 SVG；只有 `v` 等于当前资源版本才使用一年 `immutable`，否则 `no-cache`）、`GET /custom/:id`（查 `model_icons` 后读盘）。资源版本由图标包版本和本地渲染修订号共同组成，包升级、mono 算法或主题着色变化都会换 URL。lobe 路由的 `theme=light|dark` 只把 `currentColor` 固化为对应前景色，固定品牌色和渐变保持原样；ETag 同时包含资源版本、主题和 slug。所有图标响应保留 `nosniff` 与沙箱 CSP。
- **渲染的关键**（`components/ModelIcon.tsx` + `components/iconSizing.ts` + `index.css` 的 `.hc-icon-mask`/`.hc-colored-glyph`）：纯单色内置图标继续使用 `mask-image` + `background-color: currentColor`，随文字颜色与 hover 态变化；中性场景统一使用 `DEFAULT_MODEL_ICON_TONE_CLASS`（浅色 `neutral-700` / 深色 `neutral-300`），保证 ChatGPT、Grok 等细节密集的 14–20px 标志有足够对比，又不使用纯黑/纯白抢过名称。混合/彩色图标渲染 light/dark 两个 background span，由 `.dark` 只启用当前主题资源，因此不会把固定品牌色压平，也不需要每个图标订阅主题。目录由 Query 的 `queryFn` 一次转换成 `{version, monoBySlug, slugs}`，所有 `ModelIconMark` 共享缓存，不再为每个图标重复构建 903 项 Map；目录到达前仅使用后缀启发式并请求可重验证的无版本 URL。自定义上传仍使用 `<img>`。聊天文件夹、模型与模型分组共用 `xs=14px / sm=16px / md=20px / lg=24px` 的尺寸表；文件夹/分组外层与实际图形同尺寸，只负责着色和居中，不绘制底板、边界或额外 padding。文件夹颜色由 `.hc-colored-glyph` 在深色模式适度提亮；模型分组的颜色只用于默认文件夹图形，并以行内 `color` 原样呈现，选择显式图标后改用图标自身外观、不再叠加颜色。
- **自定义上传**：`POST /api/admin/model-icons/custom`（multipart）复用 `saveUpload()`，第一个参数传子目录名 `model-icons`（图标不属于任何用户），允许 SVG/PNG/WebP/JPEG/GIF，上限 1MB；显式显示名原样校验，只有回退文件名时去扩展名。写库失败会删除刚落盘文件；删除接口在数据库事务提交前调用 `removeUploadStrict()`，失败时数据库引用保持不变。

## 10. 管理后台（里程碑 B 重构 + C/D 增强）

- 后端：`routes/admin.ts`（全 `requireAdmin`）+ 服务层 `services/stats.ts`（概览/分析/分用户/请求事件/错误事件，drizzle `sql` 求和分组 + 整除时间分桶 + 成本经 `shared/util/cost.ts costUsd`）、`services/sessions.ts`（会话）、`services/appConfig.ts`（注册邀请码要求/分享/标题总结等全局设置）、`services/shares.ts`（分享）、`services/admin.ts`（邀请码/用户/`getStats` 系统信息）、`services/models.ts`（含 `createModel` 手动添加，**不再查重**——同 id 多实例合法）、`services/model-icon-references.ts`（lobe/custom 图标真实引用校验）、`services/model-groups.ts`（分组 CRUD + `reorderModelGroups` + `assignModelsToGroup` + `applyModelIcons` + `clearCustomIconReferences`，路由 `GET|POST /model-groups`、`PATCH|DELETE /model-groups/:id`、`POST /model-groups/reorder`、`POST /model-groups/assign`、`POST /models/icons/batch`、自定义图标库 `GET|POST /model-icons/custom`、`DELETE /model-icons/custom/:id`）、`services/providers.ts`（`syncProviderModels` 一键同步 + `getProviderModelCatalog`/`importProviderModels` 上游目录挑选添加，路由 `GET /providers/:id/catalog`、`POST /providers/:id/import-models`）、`services/announcements.ts`（站内公告 CRUD + 读者名单 + 重置已读）。
  ⚠ **模型的 update/delete 没有 service 函数**，内联在 `routes/admin.ts` 的 `PATCH /models/:id`（约 110 行）里；新增模型字段必须同时改这里、`services/models.ts createModel` 与 `services/providers.ts inferredModelValues()`（目录同步/导入是第三个插入点）。`groupId` 在 create 与 patch 两处都做了**存在性显式校验**，否则外键违例会抛成 500 而不是可读的 400。
- 前端：`web/src/pages/admin/`，`AdminLayout` 侧边导航**按职责分组**（洞察/事件/运营/接入/系统），激活项浅 sky 底色；根容器 `h-dvh + overflow-hidden`，**只有右侧内容区滚动、侧栏固定**；移动端为顶部横滑标签；页面经 `lazyPages.ts` 懒加载（recharts 不进聊天主包）。**加一个新页面正好改三处**：`lazyPages.ts` 加一行 → `router.tsx` 加一条子路由 → `AdminLayout.tsx` 的 `navGroups` 加一项（页面组件必须是 `export default`）。通用控件 `components/ui/`：`PageHeader`（统一页头）、`Card`/`cardSurface`（卡片表面）、`EmptyState`、`IconButton`、Select/DateRangePicker/Pagination/StatCard/Badge/tableStyles（表头无底色轻量风格）。**重点色为 sky**（主按钮/焦点环/分页激活/子页标签），黑底按钮已全部移除。
- `ModelsPage.tsx`：卡片列表 + **dnd-kit 拖拽排序**（`@dnd-kit/core+sortable`，键盘可用；搜索/供应商筛选生效时禁用拖拽），行内直接显示图标（`components/ModelIcon.tsx`）、标签徽章（`components/ModelTags.tsx`）与能力徽章；列表开关是唯一全局上下架入口，另有“全部用户 / 指定 N 人”范围按钮打开 `ModelAccessDialog.tsx`。范围面板按管理员/普通用户分组，支持名称/用户名搜索、搜索结果全选、分组三态选择、停用账号预授权及浅色/深色/移动端布局；每次打开都使用新的编辑快照，保存前会检测并发修改或已删除账号，不会静默覆盖旧名单。
  - **「按分组显示」开关**：开启后按分组分区渲染（空分组也显示，管理员要能看见），并**禁用拖拽**——沿用「筛选中不可拖拽排序」的既有先例（分组视图重排了行的位置，全局顺序无法可靠映射）。这样 `reorderModels`「必须提交穷尽的全局 id 列表」的契约完全不用动。
  - **「批量管理」模式**（`ModelBatchTools.tsx`）：行首多选框、整行点击切换选中（选中行 sky 底色）、行内操作按钮隐藏；底部工具栏 = 计数 + 全选/取消 + 完成，操作行为「移动到分组」（`AssignGroupDialog`，列出全部分组 + 移出分组，点选即执行）与「批量识别图标」（`BatchIconDialog`，先展示 `现图标 → 识别结果` 的差异列表再确认；**默认只处理未设置图标的模型**，勾选后才覆盖管理员手工挑过的图标；识别不出来时不会把已有图标抹成空）。两者都走原子批量接口，任一 id 不存在则整批失败并回报 `invalidIds`，不留「移了一半」的中间态。
- **`ModelGroupsPage.tsx` + `ModelGroupEditor.tsx`（新页，导航「接入 → 模型分组」）**：dnd-kit 拖拽排序列表（sensors / `SortableContext` / 乐观更新三件套照抄 `ModelsPage`），行内 `ModelGroupGlyph` + 名称 + 模型数 + 编辑/删除；删除走 `askConfirm` 并明确提示「组内 N 个模型会移到未分组，模型本身不会被删除」。编辑弹窗 = 实时预览行（与用户端同一个无底板图标组件，所见即所得）+ 名称 + `IconPicker` + 默认文件夹颜色（默认灰 + `COLOR_PRESETS` 预设 + react-colorful 自定义）。显式图标与颜色互斥：选择图标即清空并隐藏颜色字段；三个色板的 28px 无边框圆点共用 `components/ui/ColorSwatch.tsx`，避免 `conic-gradient` 与半透明边框再次产生四边串色。
- **`components/IconPicker.tsx`（管理端共用）**：顶部预览按钮 + 三个分页（内置 / 自定义 / Emoji）。⚠ 内置库有 903 个图标，**一次性渲染会同时发出 903 个 SVG 请求**：默认只展示 `curatedIcons.ts` 里策展的约 80 个高频品牌，输入搜索才从完整 catalog 过滤且最多渲染 120 个（`ICON_SEARCH_RESULT_LIMIT`），把并发图片请求钉死在可控量级。Emoji 分页懒加载复用聊天端的 `EmojiPickerPanel`。再次点击已选中的图标即取消选择。服务端用独立详情接口按需返回完整名单，列表只返回人数。
- `ModelEditor.tsx` **新建/编辑两用**：模型 ID、外显名称、描述/标签、能力、思考等级、默认参数、定价、系统提示词与请求体高级 JSON。新建时采用供应商优先的渐进表单：未选供应商不显示类型；OpenAI 兼容供应商显示 Responses/chat/生图类型；Anthropic Provider 唯一派生内部 kind，只显示 `/v1/messages` 只读说明。选择 Anthropic Provider 后按模型 ID 生成 adaptive/manual/effort 预设；只在跨协议时迁移已知协议字段，同协议切换 Provider 不重置 JSON，已有 versioned Anthropic web search 模板优先于预设，自定义字段与工具保持原样。Anthropic 原生工具只暴露 web search，不显示 xAI 专属的 `x_search` 能力与默认开关，保存时也固定归一为关闭。Anthropic 的 `max_tokens` 来自默认参数栏中必填的 `max_output_tokens`；本次切换自动填入且未经用户编辑的值会在切回 OpenAI 时移除。cache、thinking、web_search 模板则保留在高级 JSON；reasoning 能力开关只控制运行时是否下发 thinking，不改写或删除管理员模板。Anthropic 私有上下文开关独立于 reasoning 展示，因为 web search 密文同样需要回传。浅色/深色控件沿用统一 neutral/sky 体系。
- `ProvidersPage.tsx`：创建/编辑时选择 OpenAI 兼容或 Anthropic Messages 协议；卡片显示协议徽章、Base URL/Key 与测试/目录/同步操作。Anthropic 目录分页读取官方 capabilities，挑选导入时服务端重新读取目录，避免浏览器传入过期能力。Provider 已有模型时禁止跨协议切换；模型创建/更新也校验 kind 匹配，防止目录鉴权与生成路径分裂。其余 Settings/Shares 行为不变。

---

## 11. 测试与验证（`scripts/` + vitest）

- 单测（`npm run test`，当前 **112 个文件 / 854 个用例**）：除原有注册、权限、分支、导出、Responses/chat、附件清理与前端流式覆盖外，Anthropic 专项覆盖 URL 拼接、原生鉴权头、分页模型目录/capabilities、模型代际 profile、必填输出上限、manual thinking 预算约束、可见 body 与“删模板不补回”、reasoning 开关保留管理员 thinking 模板、manual/adaptive thinking、sampling 限制、最终 JSON 32MB、图片/PDF/文本映射、SSE index 聚合、signature/redacted/encrypted/citation opaque 保留、流内错误状态映射、`refusal` 作废部分输出、客户端工具失败、截断工具 replay 门控、网关缺失 `message_stop` 的完整性判定、web search 业务错误及其人类可读导出、citation 安全协议、usage、`pause_turn` 续跑与来源门控 replay 隔离。
  **模型分组与图标专项**：`shared/util/modelIcon.test.ts`（路径穿越 / CSS 注入 / 多字素 emoji / 脏对象一律降级为 null）、`shared/util/modelIconGuess.test.ts`（约 50 条 id→slug 映射、显示名回退、认不出返回 null、**规则表 slug 全部存在于已安装图标包**的防回归断言）、`shared/schemas/model-group.test.ts`、`server/services/model-groups.test.ts`（CRUD、稀疏 sort、reorder 穷尽性校验、删除分组回退、批量指派/图标原子性、DTO 归一化）、`server/services/lobe-icons.test.ts` 与 `server/routes/model-icons.test.ts`（单色判定、明暗主题渲染、复合资产版本、缓存头、引用校验、上传命名与文件删除失败回滚），以及 `web/src/chat/modelGroups.test.ts`、`web/src/chat/ModelControlMenu.test.tsx`、`web/src/chat/{FolderIdentityField,folderVisuals}.test.tsx`、`web/src/components/{IconPicker,ModelIcon}.test.tsx`、`web/src/glyphStyles.test.ts`、`web/src/hooks/useModels.test.ts`（视图切换、弹层重测量、文件夹设置触发器尺寸、文件夹/分组裸图标与 CSS 无底板契约、自定义图标删除可达性、主题 URL 与共享目录索引）。
  **颜色与复选框 UI 契约**：`shared/util/modelGroupAppearance.test.ts`、`web/src/components/ui/{ColorSwatch,Checkbox}.test.tsx` 与 `web/src/pages/admin/ModelGroupEditor.test.tsx` 锁定“显式图标与默认文件夹颜色互斥”、颜色字段显隐、渐变色块四边无 border、预设色与预览原色一致、标签/文件夹色板变体，以及二态/三态复选框的自绘状态；ESLint 同时禁止业务 TSX 再直接新增原生 `input[type="checkbox"]`。
- E2E/冒烟脚本（需先 `npm run dev`，再 `npx tsx scripts/<x>.ts`）：
  - 后端直连：`resume-test`(游标续传)、`abort-test`(停止)、`file-input-test`、`image-gen-backend`、`final-smoke`(全模型)。
  - Playwright 浏览器：`ui-smoke`、`auth-ui-e2e`(登录/注册页：**其余脚本共用的登录选择器**「请输入用户名/请输入密码 + 名为「登录」的按钮」、客户端校验与首个出错字段聚焦、密码明文切换、邀请码转大写、未登录切主题不报同步失败、注册策略四种组合下邀请码字段与首位管理员提示的显隐)、`stream-resume-e2e`(流式+刷新续传)、`branch-e2e`、`reasoning-web-e2e`、`image-input-e2e`、`image-gen-e2e`、`markdown-e2e`、`admin-e2e`、`sidebar-search-e2e`、`folders-e2e`(文件夹创建/改色/emoji/置顶/移动/批量移动/批量删除，默认用 test 账号并自清理；⚠ frimousse 列表首个 `[frimousse-emoji]` 是隐藏尺寸测量行，断言须限定 `[aria-rowindex]` 内的可见行)、`model-trigger-anim-e2e`(触发器胶囊宽度过渡：桌面/移动两视图切换模型/联网，**以 ~8ms 逐帧采样动画中间态**——校验宽度出现多个中间值而非跳变、全程标签无省略号、下拉箭头不被裁、不与发送按钮重叠；专门覆盖历史上「只查重叠/箭头、漏检动画中文字」的缺口。⚠ tsx/esbuild 会给具名内部函数注入浏览器端未定义的 `__name`，`page.evaluate` 内改用成员赋值的匿名函数表达式)。
- 这些脚本里的 `data-testid`（`assistant-message`/`stop-btn`/`edit-textarea`/`edit-submit`/`model-menu-trigger`/`model-trigger-label`/`web-search-toggle`/`conversation-menu-trigger`/`timeline-nav`/`sidebar-batch-manage`/`sidebar-new-folder`/`folder-editor`/`folder-name-input`/`folder-editor-submit`/`batch-toolbar`/`batch-selected-count`/`batch-move`/`batch-export`/`batch-delete`/`batch-done`/`export-dialog`/`export-format-<格式>`/`export-quick-all`/`export-quick-user`/`export-quick-ai`/`export-message-row`/`export-preview`/`export-submit`）是给 E2E 用的，改动相关组件时注意别删。选模型统一走 `model-menu-trigger`（聚合选择器，桌面端在输入框内）；`model-trigger-label` 是触发器内 max-content 标签层，供宽度过渡测量与省略号检测。
- ⚠ 这些脚本**没有接进 CI / 没有自动清库**，反复跑会往 `data/happychat.db` 累积测试会话/用户。需要干净状态时删 `data/happychat.db*` 重新 `npm run dev`（会自动迁移建表，但会丢已配置的 Provider，要重配）。

---

## 12. 已知限制 / 风险点 / TODO（务必读）

按严重度大致排序：

1. **单进程续传**：重启即中断（§5.5）；`runEmitter`/`active` Map 在内存，**不支持多实例水平扩展**。要扩展得引入持久化事件总线（与「不用 Redis」的约束冲突，需重新决策）。
2. ~~ESLint 未装 `eslint-plugin-react-hooks`~~ **已修复**：`eslint.config.js` 已对 `web/**` 启用 `react-hooks`（rules-of-hooks=error、exhaustive-deps=warn）与 `react-refresh`；原有警告已正确消除（`invalidateDetail` 用 `useCallback` 稳定化、`textFromContent` 拆到 `contentText.ts`、路由守卫拆到 `guards.tsx`），无任何 disable 压制。
3. **图片生成非流式**：`runImageEngine` 一次性 `createImage`，生成中只显示 spinner + 秒数，没有 `partial_images` 渐进。要渐进得改成 Images API `stream:true` 或 Responses 的 `image_generation` 工具，并扩 `eventReducer` 处理 `partial_image`。
4. **附件内联 base64**：跳过 Files API（兼容性好），但请求体大、且每轮重放都重发；长 PDF/多图会显著增大上下文与延迟。OpenAI 文件按单个 `<50MB`、合计 `≤50MB`；Anthropic 图片/文件类型及 10MB 单图限制见 §9，最终 Messages JSON 精确限制 32MB。部署代理仍需允许相同或更大的请求体。
5. **无分页**：会话列表、会话内消息、日志（`limit 100`）都不分页；`run_events` 永不主动清理（随会话级联删除）。长期重度使用下 `messages`/`run_events` 会膨胀。
6. **会话级系统提示词覆盖已停用**：`conversations.system_prompt_override` 仅作为兼容旧数据的保留列；`prepare.ts` 始终读取模型当前提示词，避免旧覆盖阻止管理员配置立即生效。
7. ~~主题持久化双轨~~ **已修复（里程碑 A）**：账户级偏好（含主题）服务端为源（`user_settings.preferences`/`theme`），`store/settings.ts` 以 localStorage 作首屏缓存避免闪烁、登录后由服务端真值覆盖；`store/theme.ts` 已删除。
8. **CSRF**：仅靠 `SameSite=Lax` cookie；所有写操作是同源 JSON fetch，没有显式 CSRF token。私有站可接受，但若将来开放需补。
9. **Markdown 流式重解析**：每个 delta 重新 parse（已 `memo`，但长文仍有开销）；半截 markdown（未闭合代码块）会中途渲染错乱再纠正。流式时 `rehypeStreamFade` 还会把正文逐单元包 `<span>` 做渐入，带来少量额外开销（生成结束切回持久内容后即无这些 span）。
10. **构建单 chunk 偏大**（~390KB + katex/hljs），有 vite 警告；未做代码分割（如把 admin、markdown 懒加载）。模型图标刻意**不**走 `@lobehub/icons` React 组件包，而是自托管静态 SVG 按 slug 提供（§9.1），正是为了不让 900 个图标组件进主包。
11. ~~标题仅 slice~~ **已实现（里程碑 D）**：`services/title.ts` 在首条回复后异步总结（RikkaHub 轻量逻辑），管理员可配模型/提示词。
12. **分享是快照非实时**：分享时定格快照存 `shared_chats.snapshot`，后续新消息不会出现在分享页（隐私友好），如需更新需「更新分享」重新快照。分享弹窗支持**手动选择消息**（同一分支链上任意子集，用户/AI 解耦；快捷操作 全部/全部用户/全部 AI）与**附件包含开关**；更新时上次未包含的新消息默认不勾选（标「新」），有效期默认「保持当前」。分享附件经 `/api/shares/:token/attachments/:id` 公开读（校验在快照内，`no-store` 保证撤销即失效）。「我的分享」（设置页）行内可跳回原对话/复制/打开，「分享设置」按钮直接复用分享弹窗（更新/停止都在里面）。
13. **协议能力边界**：`model.kind='chat'` 支持文本/`reasoning_content`/图片，但不支持文件与服务端搜索；Anthropic 支持自己的原生 web search 和 URL citation；X 搜索仍只属于 Responses/xAI。普通客户端 `tool_use` 尚无本地工具执行器，会以 failed 明确终结并向用户展示原因。
14. **提示词时间来源**：新用户消息以浏览器 IANA 时区生成并冻结 runtime context；旧消息不回填。时间类顶层模板变量仍按服务器时间渲染以兼容旧配置，但会降低缓存命中，后台已显式警告，推荐仅使用 runtime context。
15. **双协议私有 replay 边界**：Responses 仅保存 reasoning items，单轮 256KB；Anthropic 保存完整 assistant blocks，目前没有额外本地大小上限，统一受最终 32MB 请求限制。关闭模型开关不会删除既有密文，暂无「清除历史提供商私有上下文」按钮；来源切换会停止注入但保留数据。PDF/文本 document citation 还未映射进公共 `UrlCitation`，当前只展示带 URL 的 web-search citation。
16. **better-sqlite3 原生模块**：Windows 用预编译；迁 Ubuntu 时 `npm ci` 会按目标平台重编（需基础构建链或对应预编译）。换 Node 大版本也可能要 `npm rebuild`。
17. **图标目录是一次 31KB 请求**：聊天端为了精确区分纯单色与混合/彩色图标会拉一次 `/api/model-icons/catalog`（HTTP `no-cache` + ETag，Query `staleTime: Infinity`，每个页面会话只请求一次）。目录到达前用 slug 后缀启发式兜底；无版本 SVG 不做长期缓存，目录到达后切到带包版本的 immutable URL。若觉得这 31KB 不值，可改成只下发「非单色 slug 集合」（约 3KB）。
18. **分组只是展示层**：没有分组级别的用户授权，可见性完全由模型自身的 `access_mode` 决定；也没有多分组归属与三级以上嵌套。分组是管理员定义的全站结构，用户不能自建（区别于侧边栏的聊天文件夹）。

---

## 13. 常见扩展怎么做

- **加一种内容能力**（如音频输入）：扩 `shared/types/domain.ts ContentPart` → `provider/context.ts buildInput` 映射 → `prepare.ts` 能力校验 → 前端 `Composer` 上传 + `Attachments` 渲染 + `models` 能力标记。
- **加一种服务端检索工具**（如上游新增站内检索）：`shared/types/domain.ts` 扩 `SearchActionType` + `ModelCapabilities` 能力位（同时改 `normalizeModelCapabilities`）→ `shared/util/searchActivity.ts` 加解析分支与统计口径 → `shared/util/searchTools.ts` 加 `effectiveXxxEnabled` → `server/provider/params.ts` 下发工具 + `responseToolMergeKey` 成键 → 迁移加 `models.default_xxx` → `engine.ts`/`finalize.ts` 沿用同一个 `search_actions` 数组（**不要另开数组，交错顺序才是真实过程**）→ 前端 `eventReducer.ts` + `chat/SearchActivity.tsx` 加行渲染与汇总文案 → `ModelControlMenu` / 管理端 `ModelEditor` 加开关 → `server/export/content.ts` 加导出文案。
- **加管理后台页**：`shared/types/api.ts` 加 DTO → `server/services/admin.ts` 加查询 → `server/routes/admin.ts` 加路由 → `web/src/api/admin.ts` 加调用 → `web/src/pages/admin/` 加页面 → `AdminLayout` 导航 + `router.tsx` 路由。
- **给模型加一个字段**（图标/分组就是这么加的）：`shared/types/domain.ts` 加类型（若是 JSON 列，配一个 `shared/util/xxx.ts normalizeXxx(unknown)` 遵守 `modelTags.ts` 的总函数契约）→ `shared/schemas/model-config.ts` 的 `modelCreateSchema`(`.default()`) 与 `modelUpdateSchema`(`.optional()`) 各加一处 → `shared/types/api.ts` 的 `ModelDTO`（用户可见）或 `AdminModelDTO`（仅管理员）→ `server/db/schema.ts` 加列 + `npm run db:generate`（⚠ 带 `REFERENCES` 的列要手工补 `ON DELETE`）→ **三个写入点**：`services/models.ts toModelDTO`/`createModel` 与 `routes/admin.ts` 内联的 `PATCH /models/:id`，外加 `services/providers.ts inferredModelValues()`（目录同步/导入）→ 前端 `pages/admin/ModelEditor.tsx` 的字段与 save 的 `shared` 对象 → 用到的地方。**别忘了三处测试 fixture**（`server/provider/{params,chat,anthropic}.test.ts` 的 model()、`server/services/models.test.ts` 的 createModel 调用、`web/src/chat/runPrefs.test.ts`）会因缺字段而红。
- **改/加上游参数**：Responses 看 `server/provider/params.ts`，chat/completions 看 `chat.ts`，Anthropic 看 `anthropic.ts` 与 `shared/util/anthropic.ts` 的可见模板/profile；fetch 仍只放 `client.ts`。新字段先确认官方文档与真实上游都支持。
- **迁 PostgreSQL**：换 `drizzle.config.ts` dialect 与 `db/client.ts` 驱动为 `drizzle-orm/node-postgres`；schema 列类型基本可直接用（JSON→jsonb、timestamp_ms→timestamp、boolean）；`db.transaction` 在 better-sqlite3 是同步、PG 是异步，`routes/auth.ts` 注册事务与 `runs/*` 里的同步 `.run()` 调用需改成 await 形态。

---

## 14. 关键文件速查

| 想改…                                                            | 看这个文件                                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 上游请求参数（Responses）                                        | `server/provider/params.ts`                                                                                                                                                                                                               |
| Anthropic 请求/模型 profile/流聚合/引擎                          | `shared/util/anthropic.ts`、`server/provider/anthropic.ts`、`server/provider/anthropic-stream.ts`、`server/runs/anthropic-engine.ts`                                                                                                      |
| 提供商私有上下文净化/提存/重放                                   | `server/runs/event-sanitize.ts`、`server/runs/reasoning-replay-capture.ts`、`server/provider/reasoning-replay.ts`、`server/runs/prepare.ts`                                                                                               |
| chat/completions 路径                                            | `server/provider/chat.ts`、`server/runs/chat-engine.ts`                                                                                                                                                                                   |
| 提示词模板变量                                                   | `shared/util/promptTemplate.ts`、`server/runs/promptVars.ts`                                                                                                                                                                              |
| runtime context / 提示词缓存                                     | `server/runs/runtimeContext.ts`、`server/provider/promptCache.ts`、`server/provider/context.ts`                                                                                                                                           |
| 标题总结 / 浏览器标签标题                                        | `server/services/title.ts`（在 `finalize.ts` 触发）、`server/services/conversation-events.ts`、`web/src/sse/conversationEvents.ts`、`web/src/chat/ConversationDocumentTitle.tsx`、`web/src/hooks/useDocumentTitle.ts`                     |
| 分享聊天                                                         | `server/services/shares.ts`、`server/routes/shares.ts`、`web/src/pages/SharedChatPage.tsx`、`web/src/chat/ShareDialog.tsx`                                                                                                                |
| 导出聊天（六格式/选项矩阵/预览/批量）                            | `server/export/*`（`chatlog-md.ts` 等构建器 + `collect.ts` + `index.ts`）、`shared/schemas/export.ts`、`shared/util/exportOptions.ts`、`web/src/chat/ExportDialog.tsx`、`web/src/api/export.ts`                                           |
| 统计/分析后台                                                    | `server/services/stats.ts`、`web/src/components/charts.tsx`、`web/src/pages/admin/*`                                                                                                                                                      |
| 全局设置（注册/分享/标题）/成本                                  | `server/services/appConfig.ts` + `appConfig.test.ts`、`shared/schemas/app-config.ts`、`shared/types/api.ts`、`web/src/api/appConfig.ts`、`web/src/pages/admin/SettingsPage.tsx`、`shared/util/cost.ts`                                    |
| 站内公告                                                         | `server/services/announcements.ts`、`server/routes/announcements.ts`、`web/src/announcements/*`、`web/src/pages/admin/AnnouncementsPage.tsx` + `AnnouncementEditor.tsx`                                                                   |
| 用户设置/偏好                                                    | `web/src/store/settings.ts`、`web/src/chat/SettingsDialog.tsx`（偏好键与默认值在 `shared/util/preferences.ts` + `shared/schemas/settings.ts`；分页：通用/消息显示/账户/我的分享/关于，账户页为分区卡片）                                  |
| 头像裁切上传                                                     | `web/src/chat/AvatarCropDialog.tsx`（react-easy-crop，选图→圆形裁切→512² WebP→复用 `/auth/avatar` 上传，后端零改动）                                                                                                                      |
| 全局确认对话框（替代 window.confirm）                            | `web/src/store/confirm.ts`（`askConfirm()` 返回 Promise）+ `web/src/components/ui/ConfirmDialogHost.tsx`（App 顶层挂载一次）；删除聊天及管理后台删除模型/提供商/用户/公告、重置已读均走此通道；单条聊天删除确认会显示目标聊天标题         |
| 编排器临时vs固定 + 按会话恢复                                    | `web/src/store/chat.ts`、`web/src/chat/ChatView.tsx`、`ModelControlMenu.tsx`                                                                                                                                                              |
| 聚合模型选择器（模型/思考/联网/图片参数/标签/ⓘ 描述）            | `web/src/chat/ModelControlMenu.tsx`、`web/src/components/ModelTags.tsx`                                                                                                                                                                   |
| 模型选择器两种视图（平铺折叠 / 二级目录 / 搜索）                 | `web/src/chat/ModelListViews.tsx`、`modelGroups.ts`（纯逻辑+单测）、`web/src/store/modelPicker.ts`                                                                                                                                         |
| 模型 / 分组图标（三来源、自动识别、mask 渲染）                   | `shared/types/domain.ts`（`ModelIcon`）、`shared/util/modelIcon.ts` + `modelIconGuess.ts`、`server/services/lobe-icons.ts`、`server/routes/model-icons.ts`、`web/src/components/ModelIcon.tsx` + `iconSizing.ts` + `IconPicker.tsx` + `curatedIcons.ts`、`web/src/index.css` 的 `.hc-icon-mask`/`.hc-colored-glyph` |
| 模型分组（表/服务/管理页/批量指派）                              | `server/db/schema.ts`（`model_groups`/`model_icons`）、`server/services/model-groups.ts`、`shared/schemas/model-group.ts`、`web/src/pages/admin/ModelGroupsPage.tsx` + `ModelGroupEditor.tsx` + `ModelBatchTools.tsx`                      |
| 选择器面板尺寸过渡动画                                           | `web/src/hooks/useHeightTransition.ts`                                                                                                                                                                                                    |
| 触发器胶囊宽度过渡（切换模型/思考/联网平滑改宽）                 | `web/src/hooks/useTriggerLabelWidth.ts`、`web/src/chat/ModelControlMenu.tsx`（触发器结构）、`web/src/chat/Composer.tsx`（trailing 宽度变化重判换行）、`scripts/model-trigger-anim-e2e.ts`                                                 |
| 管理端模型排序/标签/描述/多实例                                  | `web/src/pages/admin/ModelsPage.tsx`、`ModelEditor.tsx`、`TagsInput.tsx`、`ReasoningEffortEditor.tsx`                                                                                                                                     |
| 模型按用户授权                                                   | `server/services/models.ts`、`server/routes/models.ts`、`server/routes/admin.ts`、`web/src/pages/admin/ModelAccessDialog.tsx`、`modelAccessSelection.ts`                                                                                  |
| 从上游目录挑选模型                                               | `server/services/providers.ts`、`web/src/pages/admin/ProvidersPage.tsx`（PickModelsModal）                                                                                                                                                |
| 消息时间轴导航                                                   | `web/src/chat/TimelineNav.tsx`、`timelineItems.ts`（纯逻辑+单测）                                                                                                                                                                         |
| 附件即时上屏/逐项上传进度/失败重试                               | `web/src/chat/uploadDraft.ts`（纯状态+单测）、`useAttachmentUpload.ts`、`AttachmentDraftList.tsx`、`web/src/api/attachments.ts`（XHR 进度）                                                                                               |
| 输入框布局（单行⇄多行/＋上传聚合/hero 居中/正文滚动渐隐+滚动条） | `web/src/chat/Composer.tsx` + `web/src/index.css` 的 `.hc-composer-*`/`.hc-hero-glow`                                                                                                                                                     |
| 顶栏模糊渐变/三点菜单                                            | `web/src/chat/ChatView.tsx`（`.hc-top-fade`）、`ConversationMenu.tsx`、`hooks/useConversationActions.ts`                                                                                                                                  |
| 移动端抽屉                                                       | `web/src/store/sidebar.ts`、`web/src/chat/Sidebar.tsx`、`ChatView.tsx`                                                                                                                                                                    |
| 聊天文件夹（分组/置顶/展开）                                     | `web/src/chat/Sidebar.tsx`、`FolderRow.tsx`、`sidebarSections.ts`（纯逻辑+单测）、`folderVisuals.tsx`、`server/services/folders.ts`、`server/routes/folders.ts`                                                                           |
| 文件夹设置弹窗（Emoji/颜色）                                     | `web/src/chat/FolderEditorDialog.tsx`、`EmojiPickerPanel.tsx`（frimousse）、`folderColors.ts`、`web/src/store/folderEditor.ts`、`server/routes/emoji-data.ts`（自托管 Emojibase）                                                         |
| 批量管理（多选/批量删除/批量移动）                               | `web/src/chat/Sidebar.tsx`（批量工具栏）、`FolderMenuList.tsx`、`web/src/hooks/useConversationActions.ts`、`server/services/conversations.ts`（`deleteConversations`/`moveConversationsToFolder`）                                        |
| 侧栏行内菜单外点/翻转                                            | `web/src/chat/rowMenu.ts`（`useRowMenu`，会话行/文件夹行共用）                                                                                                                                                                            |
| 上游事件解析/去 obfuscation / 思考摘要 part 边界                 | `server/provider/sse-parse.ts`、`shared/util/reasoningSummary.ts`                                                                                                                                                                         |
| 检索状态：联网搜索 / X 搜索（动作解析/持久化/UI）                | `shared/util/searchActivity.ts`、`shared/util/searchTools.ts`、`server/runs/engine.ts` + `finalize.ts`、`web/src/sse/eventReducer.ts`、`web/src/chat/SearchActivity.tsx` + `web/src/components/XLogo.tsx` + `index.css` 的 `.hc-search-*` |
| 生成状态机/续传                                                  | `server/runs/engine.ts`、`finalize.ts`、`routes/runs.ts`                                                                                                                                                                                  |
| 独立分支对话 / 会话内编辑重发                                    | `server/services/conversation-branches.ts`、`server/routes/conversations.ts`、`server/runs/prepare.ts`、`server/services/conversations.ts`、前端 `chat/ChatView.tsx` + `Message.tsx`                                                      |
| 未发送附件 24h 清理                                              | `server/services/attachment-cleanup.ts`、`server/storage/files.ts`、`server/runs/prepare.ts`、`server/index.ts`                                                                                                                           |
| 数据表                                                           | `server/db/schema.ts`                                                                                                                                                                                                                     |
| 前端流式渲染                                                     | `web/src/sse/streamManager.ts`、`sse/eventReducer.ts`、`chat/Message.tsx`                                                                                                                                                                 |
| Markdown/代码/公式/Alerts/流式渐入                               | `web/src/chat/Markdown.tsx`（Alerts 辅助 `web/src/chat/markdownAlerts.tsx`，渐入插件 `web/src/chat/markdownStreamFade.ts`）+ `web/src/index.css` 的 `.hc-md`/`.hc-md-alert`/`.hc-stream-seg`                                              |
| 鉴权/注册策略/邀请码                                             | `server/routes/auth.ts`、`server/routes/auth.test.ts`、`server/auth/*`、`shared/schemas/auth.ts`、`web/src/pages/RegisterPage.tsx`                                                                                                        |
| 登录 / 注册页 UI                                                 | `web/src/pages/LoginPage.tsx`、`RegisterPage.tsx`、`web/src/components/auth/*`、`web/src/index.css` 的 `.hc-auth-*`、`scripts/auth-ui-e2e.ts`                                                                                             |
| 部署                                                             | `README.md`、`server/index.ts` 末尾静态托管段                                                                                                                                                                                             |
