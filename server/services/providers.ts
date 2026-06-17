import { eq } from 'drizzle-orm'
import { EXCLUDED_MODEL_IDS } from '@shared/constants'
import type { SyncModelsResult } from '@shared/types/api'
import { db } from '../db/client'
import { models } from '../db/schema'
import { providerClientFromRow } from '../provider/client'
import { inferModelDefaults } from '../provider/model-defaults'
import type { ProviderRow } from '../runs/types'

/**
 * 拉取上游 /models，新模型按推断默认配置入库（已存在的不覆盖管理员配置）。
 * 供管理后台「同步模型」使用。
 */
export async function syncProviderModels(provider: ProviderRow): Promise<SyncModelsResult> {
  const upstream = await providerClientFromRow(provider).listModels()
  const existing = await db.select().from(models).where(eq(models.providerId, provider.id))
  const existingIds = new Set(existing.map((m) => m.modelId))

  let added = 0
  const result: { modelId: string; isNew: boolean }[] = []
  for (const um of upstream) {
    const isNew = !existingIds.has(um.id)
    if (isNew) {
      const d = inferModelDefaults(um.id)
      await db.insert(models).values({
        providerId: provider.id,
        modelId: um.id,
        displayName: um.id,
        kind: d.kind,
        enabled: !EXCLUDED_MODEL_IDS.includes(um.id),
        capabilities: d.capabilities,
        defaultParams: {},
        hardParams: d.hardParams,
        allowedEfforts: d.allowedEfforts,
        defaultEffort: d.defaultEffort,
        defaultWebSearch: d.defaultWebSearch,
      })
      added++
    }
    result.push({ modelId: um.id, isNew })
  }
  return { added, total: upstream.length, models: result }
}
