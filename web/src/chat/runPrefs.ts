import type { ModelDTO } from '@shared/types/api'
import type { ModelParams, ReasoningEffort } from '@shared/types/domain'
import { isReasoningEffortAllowed } from '@shared/util/reasoning'
import {
  effectiveWebSearchEnabled,
  effectiveXSearchEnabled,
  modelKindSupportsSearchTools,
} from '@shared/util/searchTools'

export type ConversationRunPrefs = {
  web_search?: boolean
  x_search?: boolean
  reasoning_effort?: ReasoningEffort
}

/**
 * 前端乐观缓存会话详情时，按服务端 getConversationLastRun 的口径记录本次 run 的偏好。
 * 检索开关回填实际生效值；推理强度只回填用户显式选择，省略时保持「自动」。
 */
export function getConversationRunPrefs(
  model: ModelDTO | null | undefined,
  requestParams?: ModelParams | null,
): ConversationRunPrefs | null {
  const params: ConversationRunPrefs = {}

  if (model) {
    const supportsSearchTools = modelKindSupportsSearchTools(model.kind)
    if (supportsSearchTools && model.capabilities.web_search) {
      params.web_search = effectiveWebSearchEnabled(model, requestParams)
    }
    if (supportsSearchTools && model.capabilities.x_search) {
      params.x_search = effectiveXSearchEnabled(model, requestParams)
    }
    const requestedEffort = requestParams?.reasoning_effort
    if (isReasoningEffortAllowed(model, requestedEffort)) {
      params.reasoning_effort = requestedEffort
    }
  } else {
    if (requestParams?.web_search !== undefined) params.web_search = requestParams.web_search
    if (requestParams?.x_search !== undefined) params.x_search = requestParams.x_search
    if (requestParams?.reasoning_effort !== undefined) {
      params.reasoning_effort = requestParams.reasoning_effort
    }
  }

  return Object.keys(params).length ? params : null
}
