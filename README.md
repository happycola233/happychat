# HappyChat

HappyChat 是一个给自己和朋友使用的私有 AI 聊天站。它使用 Vite + React + TypeScript 前端、Hono + Node.js 后端、SQLite + Drizzle ORM、本地文件存储和 SSE 流式输出，不依赖 WSL、Docker、PostgreSQL、Redis 或独立 worker。

## 功能

- 邀请码注册；第一个注册用户自动成为管理员。
- 管理员可添加 OpenAI 兼容 Provider，配置 Base URL 与 API Key，并从 `/models` 拉取模型后一键导入。
- 支持 OpenAI Responses API 流式聊天、`previous_response_id` 优先上下文、断线后通过本地 `run_events` 回放续传。
- 支持 `reasoning.effort`、管理员硬参数 `reasoning.summary: "auto"`、联网搜索工具 `{ "type": "web_search" }`。
- 支持图片输入、文件输入、GPT Image 模型图片生成，并将生成图片保存到本地附件。
- 支持会话树分支：编辑用户消息后创建新分支，旧分支保留且可切换。
- 前端提供中文聊天页、个人设置、管理后台、Markdown/GFM/LaTeX/代码高亮/表格渲染。
- 后台包含用户、邀请码、Provider、模型、统计、错误日志等基础管理能力。

## 本地启动

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

默认地址：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:8787`

第一次启动时，如果 `.env` 没有设置 `APP_SECRET` 或 `ENCRYPTION_KEY`，服务端会在 `data/.generated-env` 中生成随机值提示。生产部署前请把它们写入真实环境变量或 `.env`。

## 常用命令

```powershell
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
```

真实上游冒烟测试请临时传入密钥，不要写进仓库：

```powershell
$env:SMOKE_BASE_URL="https://api.example.com/v1"
$env:SMOKE_API_KEY="<只在当前终端设置>"
npm run smoke:upstream
```

脚本会跳过 `gpt-5.3-codex-spark` 与 `codex-auto-review`，对其余模型执行基础流式、图片生成，以及首个聊天模型的联网/思考、图片输入、文件输入测试。

## 架构

- `src/client`：React 页面、聊天 UI、Markdown 渲染、管理后台。
- `src/server`：Hono API、认证、Provider Client、run 状态机、文件服务、统计日志。
- `src/shared`：前后端共享类型、Zod schema、统一 API 响应。
- `src/server/db`：Drizzle schema 与 SQLite 初始化。
- `data`：本地 SQLite、上传文件、生成图片和冒烟输出，默认不提交。

核心后端对象包括 `providers`、`models`、`conversations`、`conversation_nodes`、`messages`、`attachments`、`runs`、`run_events`、`usage_logs`、`error_logs`。SQLite 开启 WAL 与 `busy_timeout`，适合私有小团队并发使用；表结构与服务边界保留以后迁移 PostgreSQL 的空间。

## API 与降级说明

- Provider 请求统一走 `OpenAICompatibleClient`，避免 API Key 或上游请求逻辑散落在路由里。
- 聊天优先使用同 Provider、同模型、同分支上一次助手消息的 `previous_response_id`；没有可用响应 ID 时按当前分支路径重放本地上下文。
- 文件输入优先上传到上游 Files API 并使用 `input_file`；如果 Provider 不支持 `/files`，本次请求会失败并记录错误日志，前端显示中文错误。
- 刷新页面后的实时续传依赖本地 `run_events`；服务进程重启后仍可回放已落库事件，但尚未实现自动从上游 `starting_after` 恢复未完成流，后续可在 run 恢复器中补上。
- 用户不可覆盖管理员硬参数，例如 `reasoning.summary: "auto"`；前端只展示模型能力允许的开关。

## 安全

- API Key 加密后入库，明文不会返回前端。
- `.env`、`data/`、上传文件与生成图片默认在 `.gitignore` 中。
- 错误日志会脱敏常见 token、Bearer 与 API Key 片段。
- 普通用户只能访问自己的会话、附件和 run；管理员可以查看后台管理数据。
