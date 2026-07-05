import { Hono } from 'hono'
import type { Context } from 'hono'
import { and, eq } from 'drizzle-orm'
import {
  modelCreateSchema,
  modelReorderSchema,
  modelUpdateSchema,
  providerCreateSchema,
  providerUpdateSchema,
} from '@shared/schemas/model-config'
import { inviteCreateSchema, statsFilterSchema, userUpdateSchema } from '@shared/schemas/admin'
import { appConfigUpdateSchema } from '@shared/schemas/app-config'
import {
  announcementCreateSchema,
  announcementUpdateSchema,
} from '@shared/schemas/announcement'
import { db } from '../db/client'
import { attachments, inviteCodes, models, providers, usageLogs, users } from '../db/schema'
import { genInviteCode } from '../lib/id'
import { providerClientFromRow } from '../provider/client'
import { requireAdmin } from '../auth/middleware'
import { destroyAllUserSessions } from '../auth/session'
import { jsonValidator } from '../http/validator'
import { getStats, listAdminUsers, listInvites } from '../services/admin'
import {
  getAnalytics,
  getOverview,
  getUserStats,
  listErrorEvents,
  listUsageEvents,
  type StatsFilter,
} from '../services/stats'
import { listSessions, revokeSession } from '../services/sessions'
import { getAppConfig, updateAppConfig } from '../services/appConfig'
import {
  createAnnouncement,
  deleteAnnouncement,
  listAdminAnnouncements,
  listAnnouncementReaders,
  resetAnnouncementReads,
  updateAnnouncement,
} from '../services/announcements'
import { listAllShares, revokeShare } from '../services/shares'
import {
  createModel,
  getProviderDetail,
  listAdminModels,
  listProviders,
  reorderModels,
} from '../services/models'
import { syncProviderModels } from '../services/providers'
import { removeUpload } from '../storage/files'
import type { AppEnv } from '../http/types'

export const adminRoutes = new Hono<AppEnv>()

adminRoutes.use('*', requireAdmin)

/** 解析统计/事件查询筛选；失败返回 null（由调用方回 400）。 */
function readFilter(c: Context): StatsFilter | null {
  const parsed = statsFilterSchema.safeParse(c.req.query())
  return parsed.success ? parsed.data : null
}

// ---------------- Providers ----------------

adminRoutes.get('/providers', async (c) => {
  return c.json({ providers: await listProviders() })
})

adminRoutes.get('/providers/:id', async (c) => {
  const provider = await getProviderDetail(c.req.param('id'))
  if (!provider) return c.json({ error: { message: '提供商不存在', code: 'not_found' } }, 404)
  return c.json({ provider })
})

adminRoutes.post('/providers', jsonValidator(providerCreateSchema), async (c) => {
  const { name, baseUrl, apiKey, promptCacheRetention } = c.req.valid('json')
  const rows = await db
    .insert(providers)
    .values({ name, baseUrl, apiKey, promptCacheRetention: promptCacheRetention ?? null })
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
  if (input.promptCacheRetention !== undefined) {
    patch.promptCacheRetention = input.promptCacheRetention
  }
  await db.update(providers).set(patch).where(eq(providers.id, id))
  return c.json({ ok: true })
})

adminRoutes.delete('/providers/:id', async (c) => {
  const id = c.req.param('id')
  // usage_logs.provider_label 保留历史快照；先断开 provider_id，避免早期迁移里的外键阻止删除。
  await db.update(usageLogs).set({ providerId: null }).where(eq(usageLogs.providerId, id))
  await db.delete(providers).where(eq(providers.id, id))
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

adminRoutes.post('/models', jsonValidator(modelCreateSchema), async (c) => {
  const result = await createModel(c.req.valid('json'))
  if (!result.ok) {
    const message =
      result.code === 'duplicate' ? '该供应商下已存在相同模型 ID' : '所属供应商不存在'
    return c.json({ error: { message, code: result.code } }, 400)
  }
  return c.json({ model: result.model })
})

adminRoutes.post('/models/reorder', jsonValidator(modelReorderSchema), async (c) => {
  const result = await reorderModels(c.req.valid('json').modelIds)
  if (!result.ok) {
    return c.json(
      {
        error: {
          message: '模型列表已变化，请刷新后重试',
          code: result.code,
          detail: { invalidIds: result.invalidIds },
        },
      },
      400,
    )
  }
  return c.json({ ok: true })
})

adminRoutes.patch('/models/:id', jsonValidator(modelUpdateSchema), async (c) => {
  const id = c.req.param('id')
  const input = c.req.valid('json')
  const [existing] = await db.select().from(models).where(eq(models.id, id)).limit(1)
  if (!existing) return c.json({ error: { message: '模型不存在', code: 'not_found' } }, 404)

  const patch: Partial<typeof models.$inferInsert> = {}
  if (input.modelId !== undefined && input.modelId !== existing.modelId) {
    const [dup] = await db
      .select({ id: models.id })
      .from(models)
      .where(and(eq(models.providerId, existing.providerId), eq(models.modelId, input.modelId)))
      .limit(1)
    if (dup) {
      return c.json({ error: { message: '该供应商下已存在相同模型 ID', code: 'duplicate' } }, 400)
    }
    patch.modelId = input.modelId
  }
  if (input.displayName !== undefined) patch.displayName = input.displayName
  if (input.enabled !== undefined) patch.enabled = input.enabled
  if (input.promptCacheRetentionEnabled !== undefined) {
    patch.promptCacheRetentionEnabled = input.promptCacheRetentionEnabled
  }
  if (input.kind !== undefined) patch.kind = input.kind
  if (input.capabilities !== undefined) patch.capabilities = input.capabilities
  if (input.defaultSystemPrompt !== undefined) patch.defaultSystemPrompt = input.defaultSystemPrompt
  if (input.defaultParams !== undefined) patch.defaultParams = input.defaultParams
  if (input.hardParams !== undefined) patch.hardParams = input.hardParams
  if (input.pricing !== undefined) patch.pricing = input.pricing
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
  if (input.canShare !== undefined) patch.canShare = input.canShare
  await db.update(users).set(patch).where(eq(users.id, id))
  return c.json({ ok: true })
})

adminRoutes.delete('/users/:id', async (c) => {
  const id = c.req.param('id')
  if (id === c.get('user').id) {
    return c.json({ error: { message: '不能删除自己', code: 'self' } }, 400)
  }
  const [targetUser] = await db
    .select({ avatarPath: users.avatarPath })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
  const attachmentRows = await db
    .select({ storagePath: attachments.storagePath })
    .from(attachments)
    .where(eq(attachments.userId, id))

  await db.delete(users).where(eq(users.id, id))
  for (const attachment of attachmentRows) removeUpload(attachment.storagePath)
  if (targetUser?.avatarPath) removeUpload(targetUser.avatarPath)
  return c.json({ ok: true })
})

// ---------------- 会话（账号中心）----------------

adminRoutes.get('/sessions', async (c) => {
  const userId = c.req.query('userId') || undefined
  return c.json({ sessions: await listSessions(userId) })
})

adminRoutes.delete('/sessions/:id', async (c) => {
  await revokeSession(c.req.param('id'))
  return c.json({ ok: true })
})

adminRoutes.post('/users/:id/revoke-sessions', async (c) => {
  await destroyAllUserSessions(c.req.param('id'))
  return c.json({ ok: true })
})

// ---------------- 统计 / 分析 / 事件 ----------------

const badFilter = (c: Context) =>
  c.json({ error: { message: '筛选参数有误', code: 'invalid_request' } }, 400)

// ---------------- 全局设置 / 分享管理 ----------------

adminRoutes.get('/app-config', async (c) => c.json({ config: await getAppConfig() }))

adminRoutes.patch('/app-config', jsonValidator(appConfigUpdateSchema), async (c) => {
  return c.json({ config: await updateAppConfig(c.req.valid('json')) })
})

// ---------------- 站内公告 ----------------

adminRoutes.get('/announcements', async (c) => {
  return c.json({ announcements: await listAdminAnnouncements() })
})

adminRoutes.post('/announcements', jsonValidator(announcementCreateSchema), async (c) => {
  const announcement = await createAnnouncement(c.req.valid('json'), c.get('user').id)
  return c.json({ announcement })
})

adminRoutes.patch('/announcements/:id', jsonValidator(announcementUpdateSchema), async (c) => {
  const announcement = await updateAnnouncement(c.req.param('id'), c.req.valid('json'))
  if (!announcement) return c.json({ error: { message: '公告不存在', code: 'not_found' } }, 404)
  return c.json({ announcement })
})

adminRoutes.delete('/announcements/:id', async (c) => {
  await deleteAnnouncement(c.req.param('id'))
  return c.json({ ok: true })
})

/** 「谁已读」名单。 */
adminRoutes.get('/announcements/:id/readers', async (c) => {
  return c.json({ readers: await listAnnouncementReaders(c.req.param('id')) })
})

/** 重置已读：清空该公告的所有已读/曝光回执，之后会对全部受众再次推送。 */
adminRoutes.post('/announcements/:id/reset-reads', async (c) => {
  const ok = await resetAnnouncementReads(c.req.param('id'))
  if (!ok) return c.json({ error: { message: '公告不存在', code: 'not_found' } }, 404)
  return c.json({ ok: true })
})

adminRoutes.get('/shares', async (c) => c.json({ shares: await listAllShares() }))

adminRoutes.post('/shares/:id/revoke', async (c) => {
  await revokeShare(c.req.param('id'), null)
  return c.json({ ok: true })
})

adminRoutes.get('/stats', async (c) => c.json(await getStats()))

adminRoutes.get('/overview', async (c) => {
  const f = readFilter(c)
  if (!f) return badFilter(c)
  return c.json({ overview: await getOverview(f) })
})

adminRoutes.get('/analytics', async (c) => {
  const f = readFilter(c)
  if (!f) return badFilter(c)
  return c.json({ analytics: await getAnalytics(f) })
})

adminRoutes.get('/user-stats', async (c) => {
  const f = readFilter(c)
  if (!f) return badFilter(c)
  return c.json({ users: await getUserStats(f) })
})

adminRoutes.get('/usage-events', async (c) => {
  const f = readFilter(c)
  if (!f) return badFilter(c)
  return c.json(await listUsageEvents(f))
})

adminRoutes.get('/error-events', async (c) => {
  const f = readFilter(c)
  if (!f) return badFilter(c)
  return c.json(await listErrorEvents(f))
})
