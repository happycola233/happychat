import { and, eq, inArray } from 'drizzle-orm'
import type { ExportOptions } from '@shared/schemas/export'
import { requestedReasoningEffort } from '@shared/util/reasoning'
import { db } from '../db/client'
import { models, runs, usageLogs } from '../db/schema'
import type { MsgRow } from '../runs/types'
import type { ChatlogMetadata } from './types'

/**
 * V2 元数据直接读取持久化事实。普通 MessageDTO 的 usage 会补零，且仅 totalTokens
 * 存在时才创建，不能用它导出缺失字段或部分用量；审计日志的用量列也有默认零值。
 */
export async function collectChatlogMetadata(
  rows: MsgRow[],
  options: ExportOptions,
): Promise<Map<string, ChatlogMetadata>> {
  const assistantRows = rows.filter((message) => message.role === 'assistant')
  const runIds = [
    ...new Set(assistantRows.flatMap((message) => (message.runId ? [message.runId] : []))),
  ]
  const modelConfigIds = [
    ...new Set(assistantRows.flatMap((message) => (message.modelId ? [message.modelId] : []))),
  ]
  const [modelRows, runRows, usageRows] = await Promise.all([
    options.includeModel && modelConfigIds.length > 0
      ? db
          .select({
            configId: models.id,
            upstreamModelId: models.modelId,
            displayName: models.displayName,
          })
          .from(models)
          .where(inArray(models.id, modelConfigIds))
      : [],
    options.includeReasoning && runIds.length > 0
      ? db
          .select({ id: runs.id, requestParams: runs.requestParams })
          .from(runs)
          .where(inArray(runs.id, runIds))
      : [],
    (options.includeModel || options.includeReasoning) && runIds.length > 0
      ? db
          .select({
            runId: usageLogs.runId,
            modelConfigId: usageLogs.modelId,
            upstreamModelId: usageLogs.modelLabel,
            modelName: usageLogs.modelDisplayName,
            reasoningEffort: usageLogs.reasoningEffort,
          })
          .from(usageLogs)
          .where(and(inArray(usageLogs.runId, runIds), eq(usageLogs.kind, 'chat')))
      : [],
  ])
  const modelByConfigId = new Map(modelRows.map((model) => [model.configId, model]))
  const runById = new Map(runRows.map((run) => [run.id, run]))
  const usageByRunId = new Map(usageRows.map((usage) => [usage.runId, usage]))

  return new Map(
    rows.map((message) => {
      const metadata: ChatlogMetadata = {}
      if (message.role === 'assistant') {
        const snapshot = message.runId ? usageByRunId.get(message.runId) : undefined
        if (options.includeModel) {
          const currentModel = message.modelId ? modelByConfigId.get(message.modelId) : undefined
          const id = snapshot?.upstreamModelId ?? currentModel?.upstreamModelId
          // 同一配置可以调整上游 ID 或渠道别名；旧日志没有名称快照时仍可补充其显示名。
          // 名称快照始终优先，补名不改写请求时 ID，也不按 ID 搜索其他配置借用名称。
          const canUseCurrentName =
            currentModel &&
            (snapshot?.modelConfigId === currentModel.configId || currentModel.upstreamModelId === id)
          const name = snapshot?.modelName ?? (canUseCurrentName ? currentModel.displayName : undefined)
          if (id || name) metadata.model = { ...(id ? { id } : {}), ...(name ? { name } : {}) }
        }
        if (options.includeReasoning) {
          const run = message.runId ? runById.get(message.runId) : undefined
          const effort = snapshot?.reasoningEffort ?? requestedReasoningEffort(run?.requestParams)
          if (effort !== null && effort !== undefined) metadata.reasoning = { effort }
        }
      }
      if (options.includeUsage) {
        // 输入、输出已经由上游适配器归一化为包含缓存/推理的完整量；不重复加明细，
        // 不自行计算 total_tokens，以保留上游总量与分量不一致的原始记录。
        const usage: NonNullable<ChatlogMetadata['usage']> = {
          ...(message.inputTokens !== null ? { input_tokens: message.inputTokens } : {}),
          ...(message.outputTokens !== null ? { output_tokens: message.outputTokens } : {}),
          ...(message.cachedTokens !== null ? { cache_read_tokens: message.cachedTokens } : {}),
          ...(message.cacheWriteTokens !== null
            ? { cache_write_tokens: message.cacheWriteTokens }
            : {}),
          ...(message.reasoningTokens !== null
            ? { reasoning_tokens: message.reasoningTokens }
            : {}),
          ...(message.totalTokens !== null ? { total_tokens: message.totalTokens } : {}),
        }
        if (Object.keys(usage).length > 0) metadata.usage = usage
      }
      return [message.id, metadata]
    }),
  )
}
