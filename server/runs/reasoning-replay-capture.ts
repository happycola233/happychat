import type { ModelParams } from '@shared/types/domain'
import { effectiveReasoningEffort, type ReasoningModelConfig } from '@shared/util/reasoning'
import type { ReasoningReplayContextV1 } from '../provider/reasoning-replay'
import type { UpstreamResponse } from '../provider/upstream-types'

const MAX_REASONING_REPLAY_ITEMS_BYTES = 256 * 1024

interface CaptureModel extends ReasoningModelConfig {
  kind: 'responses' | 'chat' | 'image'
  modelId: string
  replayReasoning: boolean
}

interface CaptureProvider {
  id: string
  baseUrl: string
}

interface BuildReasoningReplayContextOptions {
  runId: string
  terminalState: 'completed' | 'incomplete' | 'failed' | 'canceled'
  model: CaptureModel
  provider: CaptureProvider
  requestParams?: ModelParams | null
  response?: UpstreamResponse
  warn?: (message: string) => void
}

/**
 * 从未净化的终态 Response 构造服务端私有重放信封。
 * 终态外、开关/effort 门控不满足或整轮密文过大时均静默不保存。
 */
export function buildReasoningReplayContext(
  options: BuildReasoningReplayContextOptions,
): ReasoningReplayContextV1 | null {
  if (options.terminalState !== 'completed' && options.terminalState !== 'incomplete') return null
  if (options.model.kind !== 'responses' || !options.model.replayReasoning) return null

  const effort = effectiveReasoningEffort(options.model, options.requestParams)
  if (!effort || effort === 'none') return null

  const items = (options.response?.output ?? []).filter((item) => item.type === 'reasoning')
  if (items.length === 0) return null

  let serializedItems: string
  try {
    serializedItems = JSON.stringify(items)
  } catch {
    options.warn?.(`run ${options.runId} 的 reasoning replay context 无法序列化，已放弃保存`)
    return null
  }

  if (Buffer.byteLength(serializedItems, 'utf8') > MAX_REASONING_REPLAY_ITEMS_BYTES) {
    options.warn?.(`run ${options.runId} 的 reasoning replay context 超过 256KB，已放弃保存`)
    return null
  }

  const echoedContext = options.response?.reasoning?.context
  return {
    version: 1,
    source: {
      providerId: options.provider.id,
      providerBaseUrl: options.provider.baseUrl,
      upstreamModelId: options.model.modelId,
    },
    reasoningContext: typeof echoedContext === 'string' ? echoedContext : null,
    items,
  }
}
