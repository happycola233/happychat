import type { ModelDTO } from '@shared/types/api'
import type { ModelParams, ReasoningEffort } from '@shared/types/domain'
import { effectiveReasoningEffort } from '@shared/util/reasoning'
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
 * 前端乐观缓存会话详情时，按服务端 getConversationLastRun 的口径记录本次 run 的有效偏好。
 * 请求体可能省略“沿用模型默认”的项，因此不能只回填 requestParams。
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
    const effort = effectiveReasoningEffort(model, requestParams)
    if (effort) params.reasoning_effort = effort
  } else {
    if (requestParams?.web_search !== undefined) params.web_search = requestParams.web_search
    if (requestParams?.x_search !== undefined) params.x_search = requestParams.x_search
    if (requestParams?.reasoning_effort !== undefined) {
      params.reasoning_effort = requestParams.reasoning_effort
    }
  }

  return Object.keys(params).length ? params : null
}
