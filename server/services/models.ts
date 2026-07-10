import { and, eq, sql } from 'drizzle-orm'
import type { AdminModelDTO, ModelDTO, ProviderDTO, ProviderDetailDTO } from '@shared/types/api'
import type { ModelCreateInput } from '@shared/schemas/model-config'
import { normalizeReasoningEffortOptions } from '@shared/util/reasoning'
import { db } from '../db/client'
import { models, providers } from '../db/schema'
import { must } from '../lib/assert'
import { maskSecret } from '../lib/mask'

type ModelRow = typeof models.$inferSelect
type ProviderRow = typeof providers.$inferSelect

export function toModelDTO(m: ModelRow): ModelDTO {
  return {
    id: m.id,
    modelId: m.modelId,
    displayName: m.displayName,
    kind: m.kind,
    capabilities: m.capabilities,
    description: m.description ?? null,
    tags: m.tags ?? [],
    // API 只公开规范对象；旧 string[] 记录在这里无损升级，保留原顺序和子集。
    allowedEfforts: normalizeReasoningEffortOptions(m.allowedEfforts),
    defaultEffort: m.defaultEffort ?? null,
    defaultWebSearch: m.defaultWebSearch,
    defaultParams: m.defaultParams ?? null,
  }
}

export function toAdminModelDTO(m: ModelRow, providerName: string): AdminModelDTO {
  return {
    ...toModelDTO(m),
    providerId: m.providerId,
    providerName,
    enabled: m.enabled,
    promptCacheRetentionEnabled: m.promptCacheRetentionEnabled,
    defaultSystemPrompt: m.defaultSystemPrompt,
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
    promptCacheRetention: p.promptCacheRetention,
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

export async function listEnabledModels(): Promise<ModelDTO[]> {
  const rows = await db
    .select()
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(and(eq(models.enabled, true), eq(providers.enabled, true)))
    .orderBy(models.sort, models.displayName)
  return rows.map((r) => toModelDTO(r.models))
}

/** 取可用于生成的模型（模型与提供商都已启用），并返回其提供商行。 */
export async function getRunnableModel(
  id: string,
): Promise<{ model: ModelRow; provider: ProviderRow } | null> {
  const [row] = await db
    .select()
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(eq(models.id, id))
    .limit(1)
  if (!row) return null
  if (!row.models.enabled || !row.providers.enabled) return null
  return { model: row.models, provider: row.providers }
}

export async function listAdminModels(): Promise<AdminModelDTO[]> {
  const rows = await db
    .select()
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .orderBy(models.sort, models.displayName)
  return rows.map((r) => toAdminModelDTO(r.models, r.providers.name))
}

export type CreateModelResult =
  | { ok: true; model: AdminModelDTO }
  | { ok: false; code: 'provider_missing' }

/**
 * 手动添加模型：校验供应商存在后入库。
 * 同一供应商下允许多条同 modelId 记录（参数不同视为不同的模型实例）。
 */
export async function createModel(input: ModelCreateInput): Promise<CreateModelResult> {
  const [provider] = await db
    .select()
    .from(providers)
    .where(eq(providers.id, input.providerId))
    .limit(1)
  if (!provider) return { ok: false, code: 'provider_missing' }

  const row = must(
    await db
      .insert(models)
      .values({
        providerId: input.providerId,
        modelId: input.modelId,
        displayName: input.displayName,
        description: input.description ?? null,
        tags: input.tags,
        kind: input.kind,
        enabled: input.enabled,
        promptCacheRetentionEnabled: input.promptCacheRetentionEnabled,
        capabilities: input.capabilities,
        defaultSystemPrompt: input.defaultSystemPrompt ?? null,
        defaultParams: input.defaultParams ?? null,
        hardParams: input.hardParams ?? null,
        pricing: input.pricing ?? null,
        allowedEfforts: input.allowedEfforts,
        defaultEffort: input.defaultEffort ?? null,
        defaultWebSearch: input.defaultWebSearch,
        sort: input.sort,
      })
      .returning()
      .then((r) => r[0]),
  )
  return { ok: true, model: toAdminModelDTO(row, provider.name) }
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
