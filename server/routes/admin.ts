import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import {
  modelUpdateSchema,
  providerCreateSchema,
  providerUpdateSchema,
} from '@shared/schemas/model-config'
import { inviteCreateSchema, userUpdateSchema } from '@shared/schemas/admin'
import { db } from '../db/client'
import { inviteCodes, models, providers, users } from '../db/schema'
import { genInviteCode } from '../lib/id'
import { providerClientFromRow } from '../provider/client'
import { requireAdmin } from '../auth/middleware'
import { jsonValidator } from '../http/validator'
import {
  getStats,
  listAdminUsers,
  listErrorLogs,
  listInvites,
  listUsageLogs,
} from '../services/admin'
import { listAdminModels, listProviders } from '../services/models'
import { syncProviderModels } from '../services/providers'
import type { AppEnv } from '../http/types'

export const adminRoutes = new Hono<AppEnv>()

adminRoutes.use('*', requireAdmin)

// ---------------- Providers ----------------

adminRoutes.get('/providers', async (c) => {
  return c.json({ providers: await listProviders() })
})

adminRoutes.post('/providers', jsonValidator(providerCreateSchema), async (c) => {
  const { name, baseUrl, apiKey } = c.req.valid('json')
  const rows = await db
    .insert(providers)
    .values({ name, baseUrl, apiKey })
    .returning()
  const row = rows[0]
  if (!row) return c.json({ error: { message: '创建失败' } }, 500)
  return c.json({ id: row.id })
})

adminRoutes.patch('/providers/:id', jsonValidator(providerUpdateSchema), async (c) => {
  const id = c.req.param('id')
  const input = c.req.valid('json')
  const [existing] = await db.select().from(providers).where(eq(providers.id, id)).limit(1)
  if (!existing) return c.json({ error: { message: '提供商不存在', code: 'not_found' } }, 404)

  const patch: Partial<typeof providers.$inferInsert> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl
  if (input.enabled !== undefined) patch.enabled = input.enabled
  if (input.apiKey !== undefined) patch.apiKey = input.apiKey
  await db.update(providers).set(patch).where(eq(providers.id, id))
  return c.json({ ok: true })
})

adminRoutes.delete('/providers/:id', async (c) => {
  await db.delete(providers).where(eq(providers.id, c.req.param('id')))
  return c.json({ ok: true })
})

/** 测试连接：拉取 /models，返回模型数量（失败由全局 UpstreamError 处理为友好中文）。 */
adminRoutes.post('/providers/:id/test', async (c) => {
  const [p] = await db.select().from(providers).where(eq(providers.id, c.req.param('id'))).limit(1)
  if (!p) return c.json({ error: { message: '提供商不存在', code: 'not_found' } }, 404)
  const upstream = await providerClientFromRow(p).listModels()
  return c.json({ ok: true, modelCount: upstream.length })
})

/** 同步模型：拉取上游 /models，新模型按推断默认配置入库（已存在的不覆盖管理员配置）。 */
adminRoutes.post('/providers/:id/sync', async (c) => {
  const [p] = await db.select().from(providers).where(eq(providers.id, c.req.param('id'))).limit(1)
  if (!p) return c.json({ error: { message: '提供商不存在', code: 'not_found' } }, 404)
  return c.json(await syncProviderModels(p))
})

// ---------------- Models ----------------

adminRoutes.get('/models', async (c) => {
  return c.json({ models: await listAdminModels() })
})

adminRoutes.patch('/models/:id', jsonValidator(modelUpdateSchema), async (c) => {
  const id = c.req.param('id')
  const input = c.req.valid('json')
  const [existing] = await db.select().from(models).where(eq(models.id, id)).limit(1)
  if (!existing) return c.json({ error: { message: '模型不存在', code: 'not_found' } }, 404)

  const patch: Partial<typeof models.$inferInsert> = {}
  if (input.displayName !== undefined) patch.displayName = input.displayName
  if (input.enabled !== undefined) patch.enabled = input.enabled
  if (input.kind !== undefined) patch.kind = input.kind
  if (input.capabilities !== undefined) patch.capabilities = input.capabilities
  if (input.defaultSystemPrompt !== undefined) patch.defaultSystemPrompt = input.defaultSystemPrompt
  if (input.defaultParams !== undefined) patch.defaultParams = input.defaultParams
  if (input.hardParams !== undefined) patch.hardParams = input.hardParams
  if (input.allowedEfforts !== undefined) patch.allowedEfforts = input.allowedEfforts
  if (input.defaultEffort !== undefined) patch.defaultEffort = input.defaultEffort
  if (input.defaultWebSearch !== undefined) patch.defaultWebSearch = input.defaultWebSearch
  if (input.sort !== undefined) patch.sort = input.sort
  await db.update(models).set(patch).where(eq(models.id, id))
  return c.json({ ok: true })
})

adminRoutes.delete('/models/:id', async (c) => {
  await db.delete(models).where(eq(models.id, c.req.param('id')))
  return c.json({ ok: true })
})

// ---------------- 邀请码 ----------------

adminRoutes.get('/invites', async (c) => c.json({ invites: await listInvites() }))

adminRoutes.post('/invites', jsonValidator(inviteCreateSchema), async (c) => {
  const { note, maxUses, expiresInDays } = c.req.valid('json')
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null
  const code = genInviteCode()
  await db
    .insert(inviteCodes)
    .values({ code, note: note ?? null, maxUses, expiresAt, createdBy: c.get('user').id })
  return c.json({ ok: true, code })
})

adminRoutes.patch('/invites/:id', async (c) => {
  const [inv] = await db
    .select()
    .from(inviteCodes)
    .where(eq(inviteCodes.id, c.req.param('id')))
    .limit(1)
  if (!inv) return c.json({ error: { message: '邀请码不存在', code: 'not_found' } }, 404)
  await db.update(inviteCodes).set({ disabled: !inv.disabled }).where(eq(inviteCodes.id, inv.id))
  return c.json({ ok: true })
})

adminRoutes.delete('/invites/:id', async (c) => {
  await db.delete(inviteCodes).where(eq(inviteCodes.id, c.req.param('id')))
  return c.json({ ok: true })
})

// ---------------- 用户 ----------------

adminRoutes.get('/users', async (c) => c.json({ users: await listAdminUsers() }))

adminRoutes.patch('/users/:id', jsonValidator(userUpdateSchema), async (c) => {
  const id = c.req.param('id')
  if (id === c.get('user').id) {
    return c.json({ error: { message: '不能修改自己的角色或状态', code: 'self' } }, 400)
  }
  const input = c.req.valid('json')
  const patch: Partial<typeof users.$inferInsert> = {}
  if (input.role !== undefined) patch.role = input.role
  if (input.disabled !== undefined) patch.disabled = input.disabled
  await db.update(users).set(patch).where(eq(users.id, id))
  return c.json({ ok: true })
})

adminRoutes.delete('/users/:id', async (c) => {
  const id = c.req.param('id')
  if (id === c.get('user').id) {
    return c.json({ error: { message: '不能删除自己', code: 'self' } }, 400)
  }
  await db.delete(users).where(eq(users.id, id))
  return c.json({ ok: true })
})

// ---------------- 统计 / 日志 ----------------

adminRoutes.get('/stats', async (c) => c.json(await getStats()))
adminRoutes.get('/error-logs', async (c) => c.json({ logs: await listErrorLogs() }))
adminRoutes.get('/usage-logs', async (c) => c.json({ logs: await listUsageLogs() }))
