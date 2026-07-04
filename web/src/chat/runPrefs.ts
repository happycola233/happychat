import type { ModelDTO } from '@shared/types/api'
import type { ModelParams, ReasoningEffort } from '@shared/types/domain'
import { effectiveReasoningEffort } from '@shared/util/reasoning'
import { effectiveWebSearchEnabled } from '@shared/util/webSearch'

export type ConversationRunPrefs = {
  web_search?: boolean
  reasoning_effort?: ReasoningEffort
}

/**
 * 前端乐观缓存会话详情时，按服务端 getConversationLastRun 的口径记录本次 run 的有效偏好。
 * 请求体可能省略“沿用模型默认”的项，因此不能只回填 requestParams。
 */
export function getConversationRunPrefs(
  model: ModelDTO | null | undefined,
  requestParams?: ModelParams | null,
): ConversationRunPrefs | null {
  const params: ConversationRunPrefs = {}

  if (model) {
    if (model.capabilities.web_search) {
      params.web_search = effectiveWebSearchEnabled(model, requestParams)
    }
    const effort = effectiveReasoningEffort(model, requestParams)
    if (effort) params.reasoning_effort = effort
  } else {
    if (requestParams?.web_search !== undefined) params.web_search = requestParams.web_search
    if (requestParams?.reasoning_effort !== undefined) {
      params.reasoning_effort = requestParams.reasoning_effort
    }
  }

  return Object.keys(params).length ? params : null
}
