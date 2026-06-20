import { readFileSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { env } from './env'
import { db } from './db/client'
import { errorLogs } from './db/schema'
import { runMigrations } from './db/migrate'
import { authRoutes } from './routes/auth'
import { adminRoutes } from './routes/admin'
import { modelRoutes } from './routes/models'
import { conversationRoutes } from './routes/conversations'
import { runRoutes } from './routes/runs'
import { attachmentRoutes } from './routes/attachments'
import { shareRoutes } from './routes/shares'
import { recoverInterruptedRuns } from './runs/manager'
import { UpstreamError } from './provider/errors'
import type { AppEnv } from './http/types'

// 启动时执行数据库迁移（migrate-on-boot）+ 恢复中断的生成任务
runMigrations()
void recoverInterruptedRuns()

const app = new Hono<AppEnv>()

app.get('/api/health', (c) =>
  c.json({ ok: true, service: 'happychat', env: env.NODE_ENV, ts: Date.now() }),
)

app.route('/api/auth', authRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api/models', modelRoutes)
app.route('/api/conversations', conversationRoutes)
app.route('/api/runs', runRoutes)
app.route('/api/attachments', attachmentRoutes)
app.route('/api/shares', shareRoutes)

// 生产环境：由后端静态托管构建后的前端（单体部署）
const isProd = env.NODE_ENV === 'production'
if (isProd) {
  app.use('/*', serveStatic({ root: './dist/web' }))
}

app.notFound((c) => {
  if (c.req.path.startsWith('/api')) {
    return c.json({ error: { message: '接口不存在', code: 'not_found' } }, 404)
  }
  // SPA 回退：非 /api 路由返回 index.html，交给前端路由
  if (isProd) {
    try {
      return c.html(readFileSync('./dist/web/index.html', 'utf8'))
    } catch {
      // 未构建前端
    }
  }
  return c.json({ error: { message: '接口不存在', code: 'not_found' } }, 404)
})

app.onError((err, c) => {
  if (err instanceof UpstreamError) {
    return c.json({ error: { message: err.message, code: err.type ?? 'upstream_error' } }, 502)
  }
  console.error('未处理的服务器错误：', err)
  // 服务端未处理异常落库（scope=server），便于后台错误日志排查。
  try {
    db.insert(errorLogs)
      .values({
        scope: 'server',
        message: err instanceof Error ? err.message : String(err),
        httpStatus: 500,
        detail: { path: c.req.path, method: c.req.method },
      })
      .run()
  } catch {
    // 落库失败不影响错误响应
  }
  return c.json({ error: { message: '服务器内部错误', code: 'internal_error' } }, 500)
})

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`happychat 后端已启动： http://localhost:${info.port}`)
})
