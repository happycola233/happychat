import { eq } from 'drizzle-orm'
import { EXCLUDED_MODEL_IDS } from '@shared/constants'
import type {
  ImportModelsResult,
  SyncModelsResult,
  UpstreamCatalogModelDTO,
} from '@shared/types/api'
import { db } from '../db/client'
import { models } from '../db/schema'
import { providerClientFromRow } from '../provider/client'
import { inferModelDefaults } from '../provider/model-defaults'
import type { ProviderRow } from '../runs/types'

/** 按推断默认配置为某供应商插入一个上游模型（同步与手动挑选共用）。 */
async function insertInferredModel(providerId: string, upstreamModelId: string): Promise<void> {
  const d = inferModelDefaults(upstreamModelId)
  await db.insert(models).values({
    providerId,
    modelId: upstreamModelId,
    displayName: upstreamModelId,
    kind: d.kind,
    enabled: !EXCLUDED_MODEL_IDS.includes(upstreamModelId),
    capabilities: d.capabilities,
    defaultParams: {},
    hardParams: d.hardParams,
    allowedEfforts: d.allowedEfforts,
    defaultEffort: d.defaultEffort,
    defaultWebSearch: d.defaultWebSearch,
  })
}

/**
 * 拉取上游 /models，新模型按推断默认配置入库（已存在的不覆盖管理员配置）。
 * 供管理后台「同步模型」使用。
 */
export async function syncProviderModels(provider: ProviderRow): Promise<SyncModelsResult> {
  const upstream = await providerClientFromRow(provider).listModels()
  const existing = await db
    .select({ modelId: models.modelId })
    .from(models)
    .where(eq(models.providerId, provider.id))
  const existingIds = new Set(existing.map((m) => m.modelId))

  let added = 0
  const result: { modelId: string; isNew: boolean }[] = []
  for (const um of upstream) {
    const isNew = !existingIds.has(um.id)
    if (isNew) {
      await insertInferredModel(provider.id, um.id)
      added++
    }
    result.push({ modelId: um.id, isNew })
  }
  return { added, total: upstream.length, models: result }
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
  for (const modelId of uniqueIds) {
    await insertInferredModel(provider.id, modelId)
  }
  return { added: uniqueIds.length }
}
