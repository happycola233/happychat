import { and, eq, isNotNull, ne, or, sql } from 'drizzle-orm'
import type {
  AdminModelDTO,
  ModelAccessDTO,
  ModelDTO,
  ProviderDTO,
  ProviderDetailDTO,
} from '@shared/types/api'
import type { ModelAccessUpdateInput, ModelCreateInput } from '@shared/schemas/model-config'
import {
  hasAnthropicMaxOutputTokens,
  hasAnthropicThinkingBudgetConflict,
} from '@shared/util/anthropic'
import { normalizeModelCapabilitiesForKind } from '@shared/util/modelCapabilities'
import { normalizeModelIcon } from '@shared/util/modelIcon'
import { normalizeModelTags } from '@shared/util/modelTags'
import { normalizeReasoningEffortOptions } from '@shared/util/reasoning'
import { providerProtocolSupportsModelKind } from '@shared/util/providerProtocol'
import { normalizeSearchParamsForModelKind } from '@shared/util/searchTools'
import { db } from '../db/client'
import { models, modelGroups, modelUserAccess, providers, users } from '../db/schema'
import { must } from '../lib/assert'
import { maskSecret } from '../lib/mask'
import { modelIconReferencesExist } from './model-icon-references'

type ModelRow = typeof models.$inferSelect
type ProviderRow = typeof providers.$inferSelect
const MODEL_ACCESS_INSERT_BATCH_SIZE = 250

export function toModelDTO(m: ModelRow): ModelDTO {
  const capabilities = normalizeModelCapabilitiesForKind(m.kind, m.capabilities)
  const isChatCompletions = m.kind === 'chat'
  return {
    id: m.id,
    modelId: m.modelId,
    displayName: m.displayName,
    kind: m.kind,
    // 老记录可能缺少后加入的能力位，出参前统一补齐。
    capabilities,
    description: m.description ?? null,
    // 旧记录的 string[] 与新对象数组在 API 边界统一升级，非法颜色安全回退为自动配色。
    tags: normalizeModelTags(m.tags),
    // 图标要拼进 URL 与 CSS mask，出参前统一归一化，非法值降级为 null（前端回退自动识别）。
    icon: normalizeModelIcon(m.icon),
    groupId: m.groupId ?? null,
    // API 只公开规范对象；旧 string[] 记录在这里无损升级，保留原顺序和子集。
    allowedEfforts: normalizeReasoningEffortOptions(m.allowedEfforts),
    defaultEffort: m.defaultEffort ?? null,
    defaultWebSearch: isChatCompletions ? false : m.defaultWebSearch,
    defaultXSearch: isChatCompletions ? false : m.defaultXSearch,
    defaultParams: normalizeSearchParamsForModelKind(m.kind, m.defaultParams) ?? null,
  }
}

export function toAdminModelDTO(
  m: ModelRow,
  providerName: string,
  allowedUserCount = 0,
): AdminModelDTO {
  return {
    ...toModelDTO(m),
    providerId: m.providerId,
    providerName,
    enabled: m.enabled,
    accessMode: m.accessMode,
    // all 模式下关联行不参与语义；即使遇到历史脏数据，也不向前端报告误导性人数。
    allowedUserCount: m.accessMode === 'selected' ? allowedUserCount : 0,
    defaultSystemPrompt: m.defaultSystemPrompt,
    replayProviderContext: m.replayProviderContext,
    hardParams: m.hardParams ?? null,
    pricing: m.pricing ?? null,
    sort: m.sort,
  }
}

export function toProviderDTO(p: ProviderRow, modelCount: number): ProviderDTO {
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    protocol: p.protocol,
    enabled: p.enabled,
    hasApiKey: Boolean(p.apiKey),
    apiKeyMask: p.apiKey ? maskSecret(p.apiKey) : null,
    modelCount,
    createdAt: p.createdAt.getTime(),
  }
}

export function toProviderDetailDTO(p: ProviderRow, modelCount: number): ProviderDetailDTO {
  return {
    ...toProviderDTO(p, modelCount),
    apiKey: p.apiKey,
  }
}

export async function listProviders(): Promise<ProviderDTO[]> {
  const provs = await db.select().from(providers).orderBy(providers.createdAt)
  const counts = await db
    .select({ pid: models.providerId, c: sql<number>`count(*)` })
    .from(models)
    .groupBy(models.providerId)
  const countMap = new Map(counts.map((c) => [c.pid, c.c]))
  return provs.map((p) => toProviderDTO(p, countMap.get(p.id) ?? 0))
}

export async function getProviderDetail(id: string): Promise<ProviderDetailDTO | null> {
  const [p] = await db.select().from(providers).where(eq(providers.id, id)).limit(1)
  if (!p) return null
  const [count] = await db
    .select({ c: sql<number>`count(*)` })
    .from(models)
    .where(eq(models.providerId, id))
  return toProviderDetailDTO(p, Number(count?.c ?? 0))
}

/**
 * 用户级可用性的关联与谓词。管理员没有隐式绕过：控制面能配置全部模型，
 * 但用户端模型列表和生成请求都服从同一条件。
 *
 * 导出供 `services/model-groups.ts` 复用——分组的可见性必须与模型列表**逐字一致**，
 * 各写一份迟早会漂移，进而让用户看到点进去是空的分组。
 */
export const accessJoinForUser = (userId: string) =>
  and(eq(modelUserAccess.modelId, models.id), eq(modelUserAccess.userId, userId))

export const accessibleToUser = () =>
  or(eq(models.accessMode, 'all'), isNotNull(modelUserAccess.userId))

export async function listEnabledModels(userId: string): Promise<ModelDTO[]> {
  const rows = await db
    .select({ model: models })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .leftJoin(modelUserAccess, accessJoinForUser(userId))
    .where(and(eq(models.enabled, true), eq(providers.enabled, true), accessibleToUser()))
    .orderBy(models.sort, models.displayName)
  return rows.map((r) => toModelDTO(r.model))
}

/** 取当前用户可用于生成的模型，并返回其提供商行。 */
export async function getRunnableModel(
  id: string,
  userId: string,
): Promise<{ model: ModelRow; provider: ProviderRow } | null> {
  const [row] = await db
    .select({ model: models, provider: providers })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .leftJoin(modelUserAccess, accessJoinForUser(userId))
    .where(
      and(
        eq(models.id, id),
        eq(models.enabled, true),
        eq(providers.enabled, true),
        accessibleToUser(),
      ),
    )
    .limit(1)
  if (!row) return null
  return row
}

/** 标题总结回退用：取当前用户可用的首个文本模型，避免后台任务绕过用户白名单。 */
export async function getFirstRunnableTextModel(
  userId: string,
): Promise<{ model: ModelRow; provider: ProviderRow } | null> {
  const [row] = await db
    .select({ model: models, provider: providers })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .leftJoin(modelUserAccess, accessJoinForUser(userId))
    .where(
      and(
        eq(models.enabled, true),
        eq(providers.enabled, true),
        ne(models.kind, 'image'),
        accessibleToUser(),
      ),
    )
    .orderBy(models.sort, models.displayName)
    .limit(1)
  return row ?? null
}

export async function listAdminModels(): Promise<AdminModelDTO[]> {
  const rows = await db
    .select()
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .orderBy(models.sort, models.displayName)
  const accessCounts = await db
    .select({ modelId: modelUserAccess.modelId, count: sql<number>`count(*)` })
    .from(modelUserAccess)
    .groupBy(modelUserAccess.modelId)
  const accessCountByModel = new Map(accessCounts.map((row) => [row.modelId, row.count]))
  return rows.map((r) =>
    toAdminModelDTO(r.models, r.providers.name, accessCountByModel.get(r.models.id) ?? 0),
  )
}

/** 读取一个模型的完整用户访问名单；仅供管理员配置面板使用。 */
export async function getModelAccess(id: string): Promise<ModelAccessDTO | null> {
  const [model] = await db
    .select({ accessMode: models.accessMode })
    .from(models)
    .where(eq(models.id, id))
    .limit(1)
  if (!model) return null
  if (model.accessMode === 'all') return { accessMode: 'all', userIds: [] }

  const rows = await db
    .select({ userId: modelUserAccess.userId })
    .from(modelUserAccess)
    .where(eq(modelUserAccess.modelId, id))
    .orderBy(modelUserAccess.userId)
  return { accessMode: 'selected', userIds: rows.map((row) => row.userId) }
}

export type UpdateModelAccessResult =
  | { ok: true; access: ModelAccessDTO }
  | { ok: false; code: 'model_missing' }
  | { ok: false; code: 'unknown_users'; unknownUserIds: string[] }

/**
 * 原子替换模型的完整用户访问范围。selected 模式先在同一事务内确认名单用户都存在，
 * 再一次性更新 access_mode 和关联行；任何未知用户都会让整次修改无副作用地失败。
 */
export async function updateModelAccess(
  id: string,
  input: ModelAccessUpdateInput,
): Promise<UpdateModelAccessResult> {
  return db.transaction(
    (tx): UpdateModelAccessResult => {
      const model = tx.select({ id: models.id }).from(models).where(eq(models.id, id)).get()
      if (!model) return { ok: false, code: 'model_missing' }

      // all 必须先规范为空名单，避免客户端残留选择影响“对所有用户开放”的保存操作。
      // schema 已拒绝重复项；这里仍去重，保证服务函数被内部直接调用时也不会触发主键冲突。
      const storedUserIds = input.accessMode === 'selected' ? [...new Set(input.userIds)] : []
      // 不对最多 10000 个 ID 生成单条 IN (...)，避免撞到不同 SQLite 构建的参数上限。
      const existingUserIdSet = new Set(
        storedUserIds.length > 0
          ? tx
              .select({ id: users.id })
              .from(users)
              .all()
              .map((user) => user.id)
          : [],
      )
      const unknownUserIds = storedUserIds.filter((userId) => !existingUserIdSet.has(userId))
      if (unknownUserIds.length > 0) {
        return { ok: false, code: 'unknown_users', unknownUserIds }
      }

      tx.update(models)
        .set({ accessMode: input.accessMode, updatedAt: new Date() })
        .where(eq(models.id, id))
        .run()
      tx.delete(modelUserAccess).where(eq(modelUserAccess.modelId, id)).run()
      for (
        let offset = 0;
        offset < storedUserIds.length;
        offset += MODEL_ACCESS_INSERT_BATCH_SIZE
      ) {
        const batch = storedUserIds.slice(offset, offset + MODEL_ACCESS_INSERT_BATCH_SIZE)
        tx.insert(modelUserAccess)
          .values(batch.map((userId) => ({ modelId: id, userId })))
          .run()
      }

      return {
        ok: true,
        access: { accessMode: input.accessMode, userIds: storedUserIds },
      }
    },
    { behavior: 'immediate' },
  )
}

export type CreateModelResult =
  | { ok: true; model: AdminModelDTO }
  | {
      ok: false
      code:
        | 'provider_missing'
        | 'provider_protocol_mismatch'
        | 'group_missing'
        | 'icon_missing'
        | 'anthropic_max_output_tokens_required'
        | 'anthropic_thinking_budget_conflict'
    }

/**
 * 手动添加模型：校验供应商存在后入库。
 * 同一供应商下允许多条同 modelId 记录（参数不同视为不同的模型实例）。
 */
export async function createModel(input: ModelCreateInput): Promise<CreateModelResult> {
  return db.transaction(
    (tx) => {
      const provider = tx
        .select()
        .from(providers)
        .where(eq(providers.id, input.providerId))
        .limit(1)
        .get()
      if (!provider) return { ok: false, code: 'provider_missing' } as const
      if (!providerProtocolSupportsModelKind(provider.protocol, input.kind)) {
        return { ok: false, code: 'provider_protocol_mismatch' } as const
      }
      if (input.kind === 'anthropic' && !hasAnthropicMaxOutputTokens(input.defaultParams)) {
        return { ok: false, code: 'anthropic_max_output_tokens_required' } as const
      }
      if (
        input.kind === 'anthropic' &&
        hasAnthropicThinkingBudgetConflict(
          input.hardParams?.max_tokens ?? input.defaultParams?.max_output_tokens,
          input.hardParams?.thinking,
        )
      ) {
        return { ok: false, code: 'anthropic_thinking_budget_conflict' } as const
      }
      // 分组存在性显式校验：FK 违例会抛成 500，这里换成可读的 400。
      if (input.groupId) {
        const group = tx
          .select({ id: modelGroups.id })
          .from(modelGroups)
          .where(eq(modelGroups.id, input.groupId))
          .limit(1)
          .get()
        if (!group) return { ok: false, code: 'group_missing' } as const
      }
      if (!modelIconReferencesExist(tx, [input.icon])) {
        return { ok: false, code: 'icon_missing' } as const
      }

      const capabilities = normalizeModelCapabilitiesForKind(input.kind, input.capabilities)
      const isChatCompletions = input.kind === 'chat'
      const defaultParams =
        normalizeSearchParamsForModelKind(input.kind, input.defaultParams ?? null) ?? null
      const row = must(
        tx
          .insert(models)
          .values({
            providerId: input.providerId,
            modelId: input.modelId,
            displayName: input.displayName,
            description: input.description ?? null,
            tags: input.tags,
            icon: input.icon ?? null,
            groupId: input.groupId ?? null,
            kind: input.kind,
            enabled: input.enabled,
            capabilities,
            defaultSystemPrompt: input.defaultSystemPrompt ?? null,
            defaultParams,
            hardParams: input.hardParams ?? null,
            pricing: input.pricing ?? null,
            allowedEfforts: input.allowedEfforts,
            defaultEffort: input.defaultEffort ?? null,
            replayProviderContext: input.replayProviderContext,
            defaultWebSearch: isChatCompletions ? false : input.defaultWebSearch,
            defaultXSearch: isChatCompletions ? false : input.defaultXSearch,
            sort: input.sort,
          })
          .returning()
          .get(),
      )
      return { ok: true, model: toAdminModelDTO(row, provider.name) } as const
    },
    { behavior: 'immediate' },
  )
}

export type ReorderModelsResult =
  | { ok: true }
  | { ok: false; code: 'invalid_order'; invalidIds: string[] }

/**
 * 按管理员提交的完整列表重写模型顺序。
 * sort 使用稀疏步长，后续单个模型插队时仍有空间，不必立刻整体重排。
 */
export async function reorderModels(modelIds: string[]): Promise<ReorderModelsResult> {
  const existing = await db.select({ id: models.id }).from(models)
  const existingIds = new Set(existing.map((m) => m.id))
  const submittedIds = new Set(modelIds)
  const unknownIds = modelIds.filter((id) => !existingIds.has(id))
  const omittedIds = existing.map((m) => m.id).filter((id) => !submittedIds.has(id))
  if (unknownIds.length || omittedIds.length) {
    return { ok: false, code: 'invalid_order', invalidIds: [...unknownIds, ...omittedIds] }
  }

  db.transaction((tx) => {
    for (const [index, id] of modelIds.entries()) {
      tx.update(models)
        .set({ sort: (index + 1) * 100 })
        .where(eq(models.id, id))
        .run()
    }
  })

  return { ok: true }
}
