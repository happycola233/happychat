import { Hono } from 'hono'
import type { Context } from 'hono'
import { desc, eq } from 'drizzle-orm'
import {
  modelCreateSchema,
  modelAccessUpdateSchema,
  modelImportSchema,
  modelReorderSchema,
  modelUpdateSchema,
  providerCreateSchema,
  providerUpdateSchema,
} from '@shared/schemas/model-config'
import {
  customIconNameSchema,
  modelGroupAssignSchema,
  modelGroupCreateSchema,
  modelGroupReorderSchema,
  modelGroupUpdateSchema,
  modelIconBatchSchema,
} from '@shared/schemas/model-group'
import { MAX_CUSTOM_ICON_BYTES } from '@shared/util/modelIcon'
import { normalizeModelCapabilitiesForKind } from '@shared/util/modelCapabilities'
import { inviteCreateSchema, statsFilterSchema, userUpdateSchema } from '@shared/schemas/admin'
import { appConfigUpdateSchema } from '@shared/schemas/app-config'
import {
  hasAnthropicMaxOutputTokens,
  hasAnthropicThinkingBudgetConflict,
} from '@shared/util/anthropic'
import { normalizeReasoningEffortOptions } from '@shared/util/reasoning'
import { providerProtocolSupportsModelKind } from '@shared/util/providerProtocol'
import { normalizeSearchParamsForModelKind } from '@shared/util/searchTools'
import { announcementCreateSchema, announcementUpdateSchema } from '@shared/schemas/announcement'
import { db } from '../db/client'
import {
  attachments,
  inviteCodes,
  modelGroups,
  modelIcons,
  models,
  providers,
  usageLogs,
  users,
} from '../db/schema'
import { genInviteCode, newId } from '../lib/id'
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
  applyModelIcons,
  assignModelsToGroup,
  clearCustomIconReferences,
  createModelGroup,
  deleteModelGroup,
  listAdminModelGroups,
  reorderModelGroups,
  updateModelGroup,
} from '../services/model-groups'
import { modelIconReferencesExist } from '../services/model-icon-references'
import {
  createModel,
  getModelAccess,
  getProviderDetail,
  listAdminModels,
  listProviders,
  reorderModels,
  updateModelAccess,
} from '../services/models'
import {
  getProviderModelCatalog,
  importProviderModels,
  ProviderConnectionChangedError,
  syncProviderModels,
} from '../services/providers'
import { removeUpload, removeUploadStrict, saveUpload } from '../storage/files'
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
  const { name, baseUrl, apiKey, protocol } = c.req.valid('json')
  const rows = await db.insert(providers).values({ name, baseUrl, apiKey, protocol }).returning()
  const row = rows[0]
  if (!row) return c.json({ error: { message: '创建失败' } }, 500)
  return c.json({ id: row.id })
})

adminRoutes.patch('/providers/:id', jsonValidator(providerUpdateSchema), async (c) => {
  const id = c.req.param('id')
  const input = c.req.valid('json')
  const result = db.transaction(
    (tx) => {
      const existing = tx.select().from(providers).where(eq(providers.id, id)).limit(1).get()
      if (!existing) return 'missing' as const

      const patch: Partial<typeof providers.$inferInsert> = {}
      if (input.name !== undefined) patch.name = input.name
      if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl
      if (input.enabled !== undefined) patch.enabled = input.enabled
      if (input.apiKey !== undefined) patch.apiKey = input.apiKey
      if (input.protocol !== undefined && input.protocol !== existing.protocol) {
        const providerModels = tx
          .select({ kind: models.kind })
          .from(models)
          .where(eq(models.providerId, id))
          .all()
        if (
          providerModels.some(
            (model) => !providerProtocolSupportsModelKind(input.protocol!, model.kind),
          )
        ) {
          return 'protocol_in_use' as const
        }
        patch.protocol = input.protocol
      }
      tx.update(providers).set(patch).where(eq(providers.id, id)).run()
      return 'updated' as const
    },
    { behavior: 'immediate' },
  )
  if (result === 'missing') {
    return c.json({ error: { message: '提供商不存在', code: 'not_found' } }, 404)
  }
  if (result === 'protocol_in_use') {
    return c.json(
      {
        error: {
          message: '该提供商已有模型，切换协议前请先删除这些模型。',
          code: 'provider_protocol_in_use',
        },
      },
      400,
    )
  }
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
  const [p] = await db
    .select()
    .from(providers)
    .where(eq(providers.id, c.req.param('id')))
    .limit(1)
  if (!p) return c.json({ error: { message: '提供商不存在', code: 'not_found' } }, 404)
  const upstream = await providerClientFromRow(p).listModels()
  return c.json({ ok: true, modelCount: upstream.length })
})

/** 同步模型：拉取上游 /models，新模型按推断默认配置入库（已存在的不覆盖管理员配置）。 */
adminRoutes.post('/providers/:id/sync', async (c) => {
  const [p] = await db
    .select()
    .from(providers)
    .where(eq(providers.id, c.req.param('id')))
    .limit(1)
  if (!p) return c.json({ error: { message: '提供商不存在', code: 'not_found' } }, 404)
  try {
    return c.json(await syncProviderModels(p))
  } catch (error) {
    if (!(error instanceof ProviderConnectionChangedError)) throw error
    return c.json({ error: { message: error.message, code: 'provider_connection_changed' } }, 409)
  }
})

/** 上游模型目录：带「已添加实例数」标注，供管理端挑选后按需添加。 */
adminRoutes.get('/providers/:id/catalog', async (c) => {
  const [p] = await db
    .select()
    .from(providers)
    .where(eq(providers.id, c.req.param('id')))
    .limit(1)
  if (!p) return c.json({ error: { message: '提供商不存在', code: 'not_found' } }, 404)
  return c.json({ models: await getProviderModelCatalog(p) })
})

/** 手动挑选添加：每个 id 新建一个模型实例（同 id 可多实例）。 */
adminRoutes.post('/providers/:id/import-models', jsonValidator(modelImportSchema), async (c) => {
  const [p] = await db
    .select()
    .from(providers)
    .where(eq(providers.id, c.req.param('id')))
    .limit(1)
  if (!p) return c.json({ error: { message: '提供商不存在', code: 'not_found' } }, 404)
  try {
    return c.json(await importProviderModels(p, c.req.valid('json').modelIds))
  } catch (error) {
    if (!(error instanceof ProviderConnectionChangedError)) throw error
    return c.json({ error: { message: error.message, code: 'provider_connection_changed' } }, 409)
  }
})

// ---------------- Models ----------------

function includesReasoningEffort(
  allowedEfforts: Parameters<typeof normalizeReasoningEffortOptions>[0],
  defaultEffort: string | null | undefined,
): boolean {
  if (!defaultEffort) return true
  return normalizeReasoningEffortOptions(allowedEfforts).some(
    (option) => option.value === defaultEffort,
  )
}

adminRoutes.get('/models', async (c) => {
  return c.json({ models: await listAdminModels() })
})

/** 单个模型的完整用户访问名单（管理员配置面板按需加载，避免塞进模型列表响应）。 */
adminRoutes.get('/models/:id/access', async (c) => {
  const access = await getModelAccess(c.req.param('id'))
  if (!access) return c.json({ error: { message: '模型不存在', code: 'not_found' } }, 404)
  return c.json(access)
})

/** 原子替换模型用户访问范围；未知用户会使整次修改失败。 */
adminRoutes.put('/models/:id/access', jsonValidator(modelAccessUpdateSchema), async (c) => {
  const result = await updateModelAccess(c.req.param('id'), c.req.valid('json'))
  if (!result.ok) {
    if (result.code === 'model_missing') {
      return c.json({ error: { message: '模型不存在', code: 'not_found' } }, 404)
    }
    return c.json(
      {
        error: {
          message: '部分用户已不存在，请刷新用户列表后重试',
          code: result.code,
          detail: { userIds: result.unknownUserIds },
        },
      },
      400,
    )
  }
  return c.json({ ok: true })
})

adminRoutes.post('/models', jsonValidator(modelCreateSchema), async (c) => {
  const input = c.req.valid('json')
  if (!includesReasoningEffort(input.allowedEfforts, input.defaultEffort)) {
    return c.json(
      { error: { message: '默认思考等级必须包含在可用等级中', code: 'invalid_default_effort' } },
      400,
    )
  }

  const result = await createModel(input)
  if (!result.ok) {
    const errorMessages = {
      provider_missing: '所属供应商不存在',
      provider_protocol_mismatch: '模型类型与所属供应商协议不匹配',
      group_missing: '所选分组不存在，请刷新后重试',
      icon_missing: '所选图标不存在，请刷新后重试',
      anthropic_max_output_tokens_required:
        'Anthropic Messages API 必须配置正整数 max_output_tokens',
      anthropic_thinking_budget_conflict:
        'Anthropic thinking.budget_tokens 必须小于最终 max_tokens',
    } as const
    return c.json(
      {
        error: {
          message: errorMessages[result.code],
          code: result.code,
        },
      },
      400,
    )
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
  const result = db.transaction(
    (tx) => {
      const existing = tx.select().from(models).where(eq(models.id, id)).limit(1).get()
      if (!existing) return { ok: false, code: 'model_missing' } as const

      if (input.kind !== undefined && input.kind !== existing.kind) {
        const provider = tx
          .select({ protocol: providers.protocol })
          .from(providers)
          .where(eq(providers.id, existing.providerId))
          .limit(1)
          .get()
        if (!provider || !providerProtocolSupportsModelKind(provider.protocol, input.kind)) {
          return { ok: false, code: 'provider_protocol_mismatch' } as const
        }
      }

      const nextKind = input.kind ?? existing.kind
      const nextCapabilities = normalizeModelCapabilitiesForKind(
        nextKind,
        input.capabilities ?? existing.capabilities,
      )
      const nextDefaultParams =
        normalizeSearchParamsForModelKind(
          nextKind,
          input.defaultParams !== undefined ? input.defaultParams : existing.defaultParams,
        ) ?? null
      const nextHardParams =
        input.hardParams !== undefined ? input.hardParams : existing.hardParams
      if (nextKind === 'anthropic' && !hasAnthropicMaxOutputTokens(nextDefaultParams)) {
        return { ok: false, code: 'anthropic_max_output_tokens_required' } as const
      }
      if (
        nextKind === 'anthropic' &&
        hasAnthropicThinkingBudgetConflict(
          nextHardParams?.max_tokens ?? nextDefaultParams?.max_output_tokens,
          nextHardParams?.thinking,
        )
      ) {
        return { ok: false, code: 'anthropic_thinking_budget_conflict' } as const
      }

      let nextReasoningConfig:
        | Pick<typeof models.$inferInsert, 'allowedEfforts' | 'defaultEffort'>
        | undefined
      if (input.allowedEfforts !== undefined || input.defaultEffort !== undefined) {
        const nextAllowedEfforts = input.allowedEfforts ?? existing.allowedEfforts
        const nextDefaultEffort =
          input.defaultEffort !== undefined ? input.defaultEffort : existing.defaultEffort
        if (!includesReasoningEffort(nextAllowedEfforts, nextDefaultEffort)) {
          return { ok: false, code: 'invalid_default_effort' } as const
        }
        // 两项作为一个一致性单元写入，并发的部分 PATCH 不会落下不合法的半份配置。
        nextReasoningConfig = {
          allowedEfforts: nextAllowedEfforts,
          defaultEffort: nextDefaultEffort,
        }
      }

      if (input.groupId) {
        const group = tx
          .select({ id: modelGroups.id })
          .from(modelGroups)
          .where(eq(modelGroups.id, input.groupId))
          .limit(1)
          .get()
        if (!group) return { ok: false, code: 'group_missing' } as const
      }
      if (input.icon !== undefined && !modelIconReferencesExist(tx, [input.icon])) {
        return { ok: false, code: 'icon_missing' } as const
      }

      const patch: Partial<typeof models.$inferInsert> = {}
      // 同 id 多实例：修改 modelId 不再检查供应商内是否重复。
      if (input.modelId !== undefined) patch.modelId = input.modelId
      if (input.displayName !== undefined) patch.displayName = input.displayName
      if (input.description !== undefined) patch.description = input.description
      if (input.tags !== undefined) patch.tags = input.tags
      if (input.icon !== undefined) patch.icon = input.icon
      if (input.groupId !== undefined) patch.groupId = input.groupId
      if (input.enabled !== undefined) patch.enabled = input.enabled
      if (input.kind !== undefined) patch.kind = input.kind
      if (input.capabilities !== undefined || nextKind === 'chat') {
        patch.capabilities = nextCapabilities
      }
      if (input.defaultSystemPrompt !== undefined) {
        patch.defaultSystemPrompt = input.defaultSystemPrompt
      }
      if (
        input.defaultParams !== undefined ||
        input.hardParams !== undefined ||
        nextKind === 'chat'
      ) {
        patch.defaultParams = nextDefaultParams
        patch.hardParams = nextHardParams
      }
      if (input.pricing !== undefined) patch.pricing = input.pricing
      if (nextReasoningConfig) {
        patch.allowedEfforts = nextReasoningConfig.allowedEfforts
        patch.defaultEffort = nextReasoningConfig.defaultEffort
      }
      if (input.replayProviderContext !== undefined) {
        patch.replayProviderContext = input.replayProviderContext
      }
      if (nextKind === 'chat') {
        patch.defaultWebSearch = false
        patch.defaultXSearch = false
      } else {
        if (input.defaultWebSearch !== undefined) patch.defaultWebSearch = input.defaultWebSearch
        if (input.defaultXSearch !== undefined) patch.defaultXSearch = input.defaultXSearch
      }
      if (input.sort !== undefined) patch.sort = input.sort
      tx.update(models).set(patch).where(eq(models.id, id)).run()
      return { ok: true } as const
    },
    { behavior: 'immediate' },
  )

  if (!result.ok) {
    if (result.code === 'model_missing') {
      return c.json({ error: { message: '模型不存在', code: 'not_found' } }, 404)
    }
    const messages = {
      provider_protocol_mismatch: '模型类型与所属供应商协议不匹配',
      anthropic_max_output_tokens_required:
        'Anthropic Messages API 必须配置正整数 max_output_tokens',
      anthropic_thinking_budget_conflict:
        'Anthropic thinking.budget_tokens 必须小于最终 max_tokens',
      invalid_default_effort: '默认思考等级必须包含在可用等级中',
      group_missing: '所选分组不存在，请刷新后重试',
      icon_missing: '所选图标不存在，请刷新后重试',
    } as const
    return c.json({ error: { message: messages[result.code], code: result.code } }, 400)
  }
  return c.json({ ok: true })
})

adminRoutes.delete('/models/:id', async (c) => {
  await db.delete(models).where(eq(models.id, c.req.param('id')))
  return c.json({ ok: true })
})

/** 批量套用图标（管理端「批量识别图标」）。任一模型不存在则整批失败。 */
adminRoutes.post('/models/icons/batch', jsonValidator(modelIconBatchSchema), async (c) => {
  const result = await applyModelIcons(c.req.valid('json').items)
  if (!result.ok) {
    if (result.code === 'icon_missing') {
      return c.json(
        { error: { message: '所选图标不存在，请刷新后重试', code: result.code } },
        400,
      )
    }
    return c.json(
      {
        error: {
          message: '部分模型已不存在，请刷新后重试',
          code: result.code,
          detail: { modelIds: result.invalidIds },
        },
      },
      400,
    )
  }
  return c.json({ ok: true, updated: result.updated })
})

// ---------------- 模型分组 ----------------

adminRoutes.get('/model-groups', async (c) => {
  return c.json({ groups: await listAdminModelGroups() })
})

adminRoutes.post('/model-groups', jsonValidator(modelGroupCreateSchema), async (c) => {
  const result = await createModelGroup(c.req.valid('json'))
  if (!result.ok) {
    return c.json(
      { error: { message: '所选图标不存在，请刷新后重试', code: result.code } },
      400,
    )
  }
  return c.json({ group: result.group })
})

adminRoutes.patch('/model-groups/:id', jsonValidator(modelGroupUpdateSchema), async (c) => {
  const result = await updateModelGroup(c.req.param('id'), c.req.valid('json'))
  if (!result.ok) {
    if (result.code === 'group_missing') {
      return c.json({ error: { message: '分组不存在', code: 'not_found' } }, 404)
    }
    return c.json(
      { error: { message: '所选图标不存在，请刷新后重试', code: result.code } },
      400,
    )
  }
  return c.json({ group: result.group })
})

/** 删除分组：组内模型回到未分组，不会被删除。 */
adminRoutes.delete('/model-groups/:id', async (c) => {
  const removed = await deleteModelGroup(c.req.param('id'))
  if (!removed) return c.json({ error: { message: '分组不存在', code: 'not_found' } }, 404)
  return c.json({ ok: true })
})

adminRoutes.post('/model-groups/reorder', jsonValidator(modelGroupReorderSchema), async (c) => {
  const result = await reorderModelGroups(c.req.valid('json').groupIds)
  if (!result.ok) {
    return c.json(
      {
        error: {
          message: '分组列表已变化，请刷新后重试',
          code: result.code,
          detail: { invalidIds: result.invalidIds },
        },
      },
      400,
    )
  }
  return c.json({ ok: true })
})

/** 批量把模型移入分组（groupId=null 为移出分组）。 */
adminRoutes.post('/model-groups/assign', jsonValidator(modelGroupAssignSchema), async (c) => {
  const { groupId, modelIds } = c.req.valid('json')
  const result = await assignModelsToGroup(groupId, modelIds)
  if (!result.ok) {
    if (result.code === 'group_missing') {
      return c.json({ error: { message: '分组不存在，请刷新后重试', code: 'not_found' } }, 404)
    }
    return c.json(
      {
        error: {
          message: '部分模型已不存在，请刷新后重试',
          code: result.code,
          detail: { modelIds: result.invalidIds },
        },
      },
      400,
    )
  }
  return c.json({ ok: true, moved: result.moved })
})

// ---------------- 自定义图标库 ----------------

/** 图标是小图；1MB 足以容纳任何合理的 SVG/PNG，也能挡住误传的大图。 */
const CUSTOM_ICON_MIMES = new Set([
  'image/svg+xml',
  'image/png',
  'image/webp',
  'image/jpeg',
  'image/gif',
])

adminRoutes.get('/model-icons/custom', async (c) => {
  const rows = await db.select().from(modelIcons).orderBy(desc(modelIcons.createdAt))
  return c.json({
    icons: rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.getTime(),
    })),
  })
})

adminRoutes.post('/model-icons/custom', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']
  if (!(file instanceof File)) {
    return c.json({ error: { message: '未收到文件', code: 'no_file' } }, 400)
  }
  const mime = (file.type.split(';')[0] ?? '').trim().toLowerCase()
  if (!CUSTOM_ICON_MIMES.has(mime)) {
    return c.json(
      { error: { message: '图标需为 SVG/PNG/WebP/JPEG/GIF', code: 'bad_type' } },
      400,
    )
  }
  if (file.size === 0) return c.json({ error: { message: '文件为空', code: 'empty' } }, 400)
  if (file.size > MAX_CUSTOM_ICON_BYTES) {
    return c.json({ error: { message: '图标最大 1MB', code: 'too_large' } }, 400)
  }
  const nameField =
    typeof body['name'] === 'string' ? body['name'] : file.name.replace(/\.[^.]+$/, '')
  const parsedName = customIconNameSchema.safeParse(nameField)
  if (!parsedName.success) {
    return c.json(
      { error: { message: parsedName.error.issues[0]?.message ?? '图标名称不合法', code: 'invalid_request' } },
      400,
    )
  }

  const id = newId()
  const buf = Buffer.from(await file.arrayBuffer())
  // 复用附件落盘层：第一个参数是子目录名，图标不属于任何用户，统一放 uploads/model-icons/。
  // 走这一层的好处是文件必然落在受管上传目录内，removeUpload 的越界删除防护同样生效。
  const storagePath = saveUpload('model-icons', id, file.name || `${id}.svg`, mime, buf)
  try {
    await db.insert(modelIcons).values({ id, name: parsedName.data, storagePath, mime })
  } catch (error) {
    // 落盘成功但写库失败：回滚磁盘文件，避免留下无人引用的孤儿。
    removeUpload(storagePath)
    throw error
  }
  return c.json({ icon: { id, name: parsedName.data, createdAt: Date.now() } })
})

/** 删除自定义图标：同时把引用它的模型/分组图标置空（JSON 列无法靠 FK 级联）。 */
adminRoutes.delete('/model-icons/custom/:id', async (c) => {
  const id = c.req.param('id')
  const removed = db.transaction(
    (tx) => {
      const icon = tx.select().from(modelIcons).where(eq(modelIcons.id, id)).limit(1).get()
      if (!icon) return false
      clearCustomIconReferences(tx, id)
      tx.delete(modelIcons).where(eq(modelIcons.id, id)).run()
      // SQL 已执行但事务尚未提交；删盘失败会抛错并回滚引用与图标库记录。
      removeUploadStrict(icon.storagePath)
      return true
    },
    { behavior: 'immediate' },
  )
  if (!removed) return c.json({ error: { message: '图标不存在', code: 'not_found' } }, 404)
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
  // 与用户自删一致：事务内同时快照文件路径并级联删行，防止并发附件/分支写入漏清理。
  const deletedResources = db.transaction(
    (tx) => {
      const targetUser = tx
        .select({ avatarPath: users.avatarPath })
        .from(users)
        .where(eq(users.id, id))
        .get()
      const attachmentRows = tx
        .select({ storagePath: attachments.storagePath })
        .from(attachments)
        .where(eq(attachments.userId, id))
        .all()

      tx.delete(users).where(eq(users.id, id)).run()
      return { attachmentRows, avatarPath: targetUser?.avatarPath ?? null }
    },
    { behavior: 'immediate' },
  )
  for (const attachment of deletedResources.attachmentRows) removeUpload(attachment.storagePath)
  if (deletedResources.avatarPath) removeUpload(deletedResources.avatarPath)
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
