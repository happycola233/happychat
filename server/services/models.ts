import { and, eq, sql } from 'drizzle-orm'
import type { AdminModelDTO, ModelDTO, ProviderDTO, ProviderDetailDTO } from '@shared/types/api'
import { db } from '../db/client'
import { models, providers } from '../db/schema'
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
    allowedEfforts: m.allowedEfforts ?? [],
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
    defaultSystemPrompt: m.defaultSystemPrompt,
    hardParams: m.hardParams ?? null,
    sort: m.sort,
  }
}

export function toProviderDTO(p: ProviderRow, modelCount: number): ProviderDTO {
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
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
