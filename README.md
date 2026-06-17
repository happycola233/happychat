# happychat

一个**私有**的 AI 聊天站（自用 + 少数朋友），服务端代理上游 **OpenAI Responses API** 并把结果流式返回浏览器。非商业 SaaS，无支付/复杂商业化。

## 功能

- 邀请码注册（首位用户自动成为管理员）、分账号、聊天记录
- 流式输出（逐字光标）、生成中可停止、失败可重试
- **断线续传**：刷新页面后自动重连，继续接收未完成的生成（基于 `run_events` + `sequence_number` 游标）
- **对话分支**：编辑用户消息后重发形成新分支，可在 `‹ 1/2 ›` 间切换回旧分支；助手消息可重新生成
- 思考模型（GPT-5.5 等）：思考深度调节（low/medium/high/xhigh）+ 官方思考摘要展示（`reasoning.summary="auto"`）
- 联网搜索开关（`tools:[{type:"web_search"}]`）+ 引用来源展示
- 图片输入、文件输入（内联 base64）、图片生成（GPT-Image-2）
- 完整 Markdown：GFM 表格、LaTeX 公式（KaTeX）、代码高亮 + 复制、引用/列表/分割线，安全渲染（不执行不可信 HTML）
- 管理后台：统计、Provider 管理、模型管理（能力/默认参数/系统提示词/思考等级）、用户管理、邀请码、错误日志、系统设置
- 全简体中文界面，浅色/深色/跟随系统主题

## 技术栈

- 前端：Vite + React + TypeScript + Tailwind v4 + TanStack Query + Zustand
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
3. 在「模型」页按需调整能力/默认参数/思考等级；回到聊天即可使用。
4. 在「邀请码」页生成邀请码，分享给朋友注册。

也可分别运行：`npm run dev:server` / `npm run dev:web`。

## 自检脚本

```bash
npm run typecheck     # 前后端类型检查
npm run lint          # ESLint
npm run test          # Vitest 单元测试
```

`scripts/` 下有基于 Playwright 的端到端冒烟脚本（流式、续传、分支、思考、联网、图片输入、图片生成、Markdown、管理后台、全模型冒烟），需先 `npm run dev` 起站后用 `npx tsx scripts/<name>.ts` 运行。

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
- 附件以内联 base64 发送给上游（跳过 Files API，最大化 OpenAI 兼容性）；大文件/长上下文会增大请求体。
- 代码当前用 SQLite，但 Drizzle schema 保持 PostgreSQL 可迁移（JSON 文本、整型时间戳、无 SQLite 专有特性）。
