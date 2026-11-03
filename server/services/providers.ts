import { eq, sql } from 'drizzle-orm'
import { EXCLUDED_MODEL_IDS } from '@shared/constants'
import type { AnthropicCatalogCapabilities } from '@shared/util/anthropic'
import type {
  ImportModelsResult,
  SyncModelsResult,
  UpstreamCatalogModelDTO,
} from '@shared/types/api'
import { db } from '../db/client'
import { modelRoutes, models, providers } from '../db/schema'
import { must } from '../lib/assert'
import type { DbTransaction } from './model-icon-references'
import { providerClientFromRow } from '../provider/client'
import { inferModelDefaults } from '../provider/model-defaults'
import type { ProviderRow } from '../runs/types'

type CatalogModel = {
  id: string
  capabilities?: AnthropicCatalogCapabilities
  max_tokens?: number
}

export class ProviderConnectionChangedError extends Error {
  constructor() {
    super('拉取模型目录期间提供商连接配置已变化，请重试。')
    this.name = 'ProviderConnectionChangedError'
  }
}

function sameProviderConnection(current: ProviderRow, fetchedFrom: ProviderRow): boolean {
  return (
    current.protocol === fetchedFrom.protocol &&
    current.baseUrl === fetchedFrom.baseUrl &&
    current.apiKey === fetchedFrom.apiKey &&
    JSON.stringify(current.extraHeaders) === JSON.stringify(fetchedFrom.extraHeaders)
  )
}

/** 按目录能力推断模型配置；同步与手动挑选共用同一组可见默认值。 */
function inferredModelValues(
  provider: ProviderRow,
  upstreamModel: CatalogModel,
): typeof models.$inferInsert {
  const d = inferModelDefaults(
    upstreamModel.id,
    provider.protocol,
    upstreamModel.capabilities,
    upstreamModel.max_tokens,
  )
  return {
    modelId: upstreamModel.id,
    displayName: upstreamModel.id,
    kind: d.kind,
    enabled: !EXCLUDED_MODEL_IDS.includes(upstreamModel.id),
    capabilities: d.capabilities,
    defaultParams: d.defaultParams,
    hardParams: d.hardParams,
    allowedEfforts: d.allowedEfforts,
    defaultEffort: d.defaultEffort,
    replayProviderContext: d.replayProviderContext,
    defaultWebSearch: d.defaultWebSearch,
    defaultXSearch: d.defaultXSearch,
  }
}

/** 目录模型入库：新建模型配置，并以该供应商作为它的唯一线路。 */
function insertCatalogModel(tx: DbTransaction, provider: ProviderRow, upstreamModel: CatalogModel) {
  const model = must(
    tx.insert(models).values(inferredModelValues(provider, upstreamModel)).returning().get(),
  )
  tx.insert(modelRoutes).values({ modelId: model.id, providerId: provider.id, sort: 100 }).run()
}

/** 已经通过该供应商承接的上游模型 ID（线路未单独指定时取模型 ID）。 */
function routedUpstreamIds(executor: Pick<DbTransaction, 'select'>, providerId: string) {
  return executor
    .select({
      upstreamModelId: sql<string>`coalesce(${modelRoutes.upstreamModelId}, ${models.modelId})`,
    })
    .from(modelRoutes)
    .innerJoin(models, eq(modelRoutes.modelId, models.id))
    .where(eq(modelRoutes.providerId, providerId))
}

/**
 * 拉取上游 /models，新模型按推断默认配置入库（已存在的不覆盖管理员配置）。
 * 供管理后台「同步模型」使用。
 */
export async function syncProviderModels(provider: ProviderRow): Promise<SyncModelsResult> {
  const upstream = await providerClientFromRow(provider).listModels()
  return db.transaction(
    (tx) => {
      const currentProvider = tx
        .select()
        .from(providers)
        .where(eq(providers.id, provider.id))
        .limit(1)
        .get()
      if (!currentProvider || !sameProviderConnection(currentProvider, provider)) {
        throw new ProviderConnectionChangedError()
      }

      const existingIds = new Set(
        routedUpstreamIds(tx, provider.id)
          .all()
          .map((row) => row.upstreamModelId),
      )
      let added = 0
      const result: { modelId: string; isNew: boolean }[] = []
      for (const upstreamModel of upstream) {
        const isNew = !existingIds.has(upstreamModel.id)
        if (isNew) {
          insertCatalogModel(tx, provider, upstreamModel)
          existingIds.add(upstreamModel.id)
          added += 1
        }
        result.push({ modelId: upstreamModel.id, isNew })
      }
      return { added, total: upstream.length, models: result }
    },
    { behavior: 'immediate' },
  )
}

/** 拉取上游 /models 目录并标注每个 id 在本站已有的实例数，供管理端「挑选模型」勾选。 */
export async function getProviderModelCatalog(
  provider: ProviderRow,
): Promise<UpstreamCatalogModelDTO[]> {
  const upstream = await providerClientFromRow(provider).listModels()
  const existing = await routedUpstreamIds(db, provider.id)
  const counts = new Map<string, number>()
  for (const row of existing)
    counts.set(row.upstreamModelId, (counts.get(row.upstreamModelId) ?? 0) + 1)
  return upstream.map((um) => ({ modelId: um.id, existingCount: counts.get(um.id) ?? 0 }))
}

/**
 * 手动挑选的上游模型入库：每个 id 新建一个实例（同 id 可多实例，勾选已存在的
 * id 表示有意再加一份配置不同的实例）。
 */
export async function importProviderModels(
  provider: ProviderRow,
  modelIds: string[],
): Promise<ImportModelsResult> {
  // 去重防止重复提交同一个 id 时一次插入多份。
  const uniqueIds = [...new Set(modelIds)]
  const catalog = await providerClientFromRow(provider).listModels()
  const catalogById = new Map(catalog.map((model) => [model.id, model]))
  return db.transaction(
    (tx) => {
      const currentProvider = tx
        .select()
        .from(providers)
        .where(eq(providers.id, provider.id))
        .limit(1)
        .get()
      if (!currentProvider || !sameProviderConnection(currentProvider, provider)) {
        throw new ProviderConnectionChangedError()
      }
      for (const modelId of uniqueIds) {
        insertCatalogModel(tx, provider, catalogById.get(modelId) ?? { id: modelId })
      }
      return { added: uniqueIds.length }
    },
    { behavior: 'immediate' },
  )
}
