# HappyChat

HappyChat 是一个开源、可自托管的 AI 聊天站。服务端统一代理多家上游模型（**OpenAI Responses API** 与 **chat/completions API**），把结果实时流式返回浏览器，并内置断线续传、对话分支与提示词缓存优化。

## 功能

- 邀请码注册（首位用户自动成为管理员）、分账号、聊天记录
- 流式输出（文字逐段渐入）、生成中可停止、失败可重试
- **断线续传**：刷新页面后自动重连，继续接收未完成的生成（基于 `run_events` + `sequence_number` 游标）
- **对话分支**：编辑用户消息后重发形成新分支，可在 `‹ 1/2 ›` 间切换回旧分支；助手消息可重新生成
- **两种上游协议**：模型可配置走 Responses API 或 chat/completions（后者把 chat 流翻译为统一事件，前端零差异）
- **提示词缓存优化**：文本会话始终使用稳定 `prompt_cache_key`；每轮发送时间以隐藏的 runtime context system 消息冻结并重放，避免动态时间破坏历史前缀；Provider 可配置 24 小时扩展缓存，并由各文本模型决定是否应用；统一记录缓存写入与缓存读取 Token，支持分别定价、统计和展示
- 思考模型（GPT-5.6 等）：思考深度调节（GPT-5.6 默认含 none/low/medium/high/xhigh/max）+ 官方思考摘要展示；管理员可按模型自由增删、排序并编辑上游值与中文描述，不受前端枚举限制；思考/联网为「临时一次 vs 固定默认」解耦，切换会话自动恢复其上次使用的模型与参数
- 联网搜索开关 + 引用来源展示
- **聚合模型选择器**：模型/思考深度/联网搜索（图片模型为分辨率/画质）收进一个菜单——思考深度为分段选择 + 一键固定默认，分辨率带宽高比缩略图；模型列表直接显示管理员配置的**标签**（如「内测」「禁止滥用」），配置了**描述**的模型带 ⓘ（桌面悬浮气泡 / 移动端点按展开）；切换模型时面板高度平滑过渡；桌面端在输入框内弹出，移动端为底部弹层（bottom sheet）
- **现代输入体验**：桌面端新对话输入框居中 + 重点色光晕，发出首条消息后平滑落底（免责声明延迟淡入，切换会话瞬时落位不闪烁）；输入框单行⇄多行自适应、行扩展动画保证输入文字全程可见，图片/文件上传聚合进「＋」菜单；顶栏为模糊交叉渐变悬浮层，右上角有会话三点菜单（分享/重命名/置顶/删除）
- **消息时间轴导航**（桌面端，可在设置关闭）：聊天右缘小横条随滚动高亮当前位置，悬停展开你发过的消息列表，点击快速跳转
- **聊天文件夹与批量管理**：侧边栏「聊天」标题右侧一键新建文件夹归类聊天；文件夹支持自定义颜色（预设色板 + 自定义取色）与 Emoji 图标（中文搜索的表情选择器，数据同源自托管、不依赖公网 CDN）、可置顶、展开状态记忆；「批量管理」进入多选模式后可批量删除或批量移动到文件夹；会话菜单含「移动到文件夹」，删除文件夹不删聊天
- 图片输入、文件输入（内联 base64）、图片生成（GPT-Image-2）
- 完整 Markdown：GFM 表格、GitHub Alerts、LaTeX 公式（KaTeX）、代码高亮 + 复制、CJK 友好强调语法（粗体/斜体/删除线内容以中日韩标点结尾后可紧跟正文），安全渲染（仅允许小范围安全 HTML）
- **用户设置**（ChatGPT 风弹窗，服务端持久化）：主题、字号、Enter 发送（桌面/手机分别配置）、自动滚动、消息时间/模型名/Token（含缓存写入/读取）·TPS·耗时明细、头像（**上传前可裁切**）/密码/删号、清空对话、「我的分享」独立管理页
- **聊天标题自动总结**（管理员可配模型与提示词）、提示词模板变量（`{{current_date}}`/`{{current_user}}` 等；时间变量会提示缓存影响）
- **分享聊天**：快照式公开只读链接，可设是否显示名称/头像与有效期，用户可管理自己的分享，管理员可全局/按用户开关并查看全部分享
- **站内公告**：管理员在后台发布 Markdown 公告，分级别（通知/更新/提醒/重要）与三种触达渠道（仅通知中心铃铛 / 顶部横幅 / 强提示弹窗），支持置顶、受众（全体/仅管理员）、定时发布与自动过期；用户端铃铛未读徽章 + 通知中心；强弹窗可配「通知次数」上限并按用户记录曝光；管理员可查看「谁已读」名单、重置已读以再次推送
- **管理后台**（现代化、分组侧栏、recharts 可视化、移动端可用）：概览 / 分析（分用户、成本估算、趋势）/ 请求事件 / 错误日志 / 账号中心（用户+邀请码+会话）/ 分享管理 / 供应商（一键同步 + **从上游目录挑选添加**）/ 模型（**拖拽排序**、标签与描述、**同 id 多实例**、手动添加、定价、请求体硬参数 JSON、思考等级拖拽排序 + 行内默认）/ 公告 / 系统设置（标题提示词默认已填写、可直接改）
- 全简体中文界面，浅色/深色/跟随系统主题，**全面适配手机**（侧栏抽屉 + 触摸优化）

## 技术栈

- 前端：Vite + React + TypeScript + Tailwind v4 + TanStack Query + Zustand + recharts
- 后端：Hono + Node.js（`tsx` 运行）
- 数据库：SQLite + Drizzle ORM（WAL）；本地文件存储；SSE 流式与续传
- 单仓库（非 monorepo）：`shared/`（前后端共享类型与 zod schema）、`server/`、`web/`
- 不依赖 Next.js / 独立 worker / PostgreSQL / Redis / Docker

## 本地开发（Windows，无需 WSL/Docker）

```bash
npm install
cp .env.example .env        # 可按需修改端口、数据目录、数据库路径；开发环境 SESSION_SECRET 可留空
npm run dev                 # 同时启动后端(8787)与前端(5173)
```

打开 `http://localhost:5173`：

1. 首次访问 → 注册页会提示「首位用户将成为管理员」，无需邀请码。
2. 登录后进入「管理后台 → 提供商」，添加 OpenAI 兼容上游（Base URL + API Key），点「测试连接」「同步模型」。
3. 在「模型」页按需调整能力/默认参数/思考等级（值与显示描述均可自定义）；回到聊天即可使用。
4. 在「邀请码」页生成邀请码，分享给朋友注册。

也可分别运行：`npm run dev:server` / `npm run dev:web`。

## 自检脚本

```bash
npm run typecheck     # 前后端类型检查
npm run lint          # ESLint
npm run test          # Vitest 单元测试
```

`scripts/` 下有基于 Playwright 的端到端冒烟脚本（流式、续传、分支、思考、联网、图片输入、图片生成、Markdown、管理后台、侧栏搜索、文件夹与批量管理、全模型冒烟），需先 `npm run dev` 起站后用 `npx tsx scripts/<name>.ts` 运行。

## 生产构建与运行

```bash
npm run build         # 构建前端到 dist/web
NODE_ENV=production npm run start
```

生产模式下后端直接静态托管 `dist/web`（含 SPA 回退），单端口（默认 8787）即可提供完整应用。生产环境必须设置高强度的 `SESSION_SECRET`（否则启动会被拒绝）。

## 部署到 Ubuntu

```bash
# 需 Node 20+（推荐 22/24）
git clone <repo> && cd happychat
npm ci
npm run build

# .env（生产）
cat > .env <<'EOF'
NODE_ENV=production
PORT=8787
DATA_DIR=./data
DATABASE_URL=./data/happychat.db
SESSION_SECRET=<openssl rand -hex 32>
EOF

npm run start   # 数据库迁移在启动时自动执行
```

用 systemd 常驻：

```ini
# /etc/systemd/system/happychat.service
[Unit]
Description=happychat
After=network.target

[Service]
WorkingDirectory=/opt/happychat
ExecStart=/usr/bin/npm run start
Restart=always
EnvironmentFile=/opt/happychat/.env

[Install]
WantedBy=multi-user.target
```

nginx 反向代理（**SSE 路由必须关闭缓冲**）：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;          # 关键：SSE 流式不被缓冲
    proxy_cache off;
    proxy_read_timeout 3600s;
}
location / {
    proxy_pass http://127.0.0.1:8787;
}
```

## 数据与备份

所有数据在 `data/`：`happychat.db`（SQLite）与 `uploads/`（图片/文件/生成图）。备份直接复制该目录即可。

## 限制说明

- 采用**本地上下文重放**（每轮重发完整历史），因上游 `store` 默认 false，不依赖 `previous_response_id`。
- 续传基于进程内 RunManager + `run_events`：进程重启会把未完成的生成标记为「已中断」（无独立 worker / Redis）。
- 附件以内联 base64 发送给上游（跳过 Files API，最大化 OpenAI 兼容性）；文件输入遵循 OpenAI 限制（单文件严格小于 50MB、单次请求合计不超过 50MB），base64 膨胀与长上下文仍会增大请求体。
- 代码当前用 SQLite，但 Drizzle schema 保持 PostgreSQL 可迁移（JSON 文本、整型时间戳、无 SQLite 专有特性）。
