import { eq } from 'drizzle-orm'
import { EXCLUDED_MODEL_IDS } from '@shared/constants'
import type { AnthropicCatalogCapabilities } from '@shared/util/anthropic'
import type {
  ImportModelsResult,
  SyncModelsResult,
  UpstreamCatalogModelDTO,
} from '@shared/types/api'
import { db } from '../db/client'
import { models, providers } from '../db/schema'
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
    current.apiKey === fetchedFrom.apiKey
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
    providerId: provider.id,
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

      const existing = tx
        .select({ modelId: models.modelId })
        .from(models)
        .where(eq(models.providerId, provider.id))
        .all()
      const existingIds = new Set(existing.map((model) => model.modelId))
      let added = 0
      const result: { modelId: string; isNew: boolean }[] = []
      for (const upstreamModel of upstream) {
        const isNew = !existingIds.has(upstreamModel.id)
        if (isNew) {
          tx.insert(models).values(inferredModelValues(provider, upstreamModel)).run()
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
  const existing = await db
    .select({ modelId: models.modelId })
    .from(models)
    .where(eq(models.providerId, provider.id))
  const counts = new Map<string, number>()
  for (const row of existing) counts.set(row.modelId, (counts.get(row.modelId) ?? 0) + 1)
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
        tx.insert(models)
          .values(inferredModelValues(provider, catalogById.get(modelId) ?? { id: modelId }))
          .run()
      }
      return { added: uniqueIds.length }
    },
    { behavior: 'immediate' },
  )
}
