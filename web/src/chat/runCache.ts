import type { QueryClient } from '@tanstack/react-query'
import type { ConversationDetail, ConversationDTO, MessageDTO } from '@shared/types/api'
import type { ConversationRunPrefs } from './runPrefs'

export interface RunResult {
  runId: string
  conversation: ConversationDTO
  assistantMessage: MessageDTO
  userMessage?: MessageDTO
}

/** 手动发送和队列发送共用缓存入口，避免后台发送改变当前路由或模型选择。 */
export function cacheRunResult(
  qc: QueryClient,
  res: RunResult,
  lastParams: ConversationRunPrefs | null,
): void {
  qc.setQueryData<ConversationDetail>(['conversation', res.conversation.id], (old) => {
    const base: ConversationDetail = old ?? {
      conversation: res.conversation,
      messages: [],
      lastModelId: res.assistantMessage.modelId,
      lastParams,
      messageCostDisplay: { currency: 'USD', usdToCnyRate: null },
    }
    const ids = new Set(base.messages.map((message) => message.id))
    const toAdd = [res.userMessage, res.assistantMessage].filter(
      (message): message is MessageDTO => message !== undefined && !ids.has(message.id),
    )
    return {
      ...base,
      conversation: res.conversation,
      messages: [...base.messages, ...toAdd],
      lastModelId: res.assistantMessage.modelId,
      lastParams,
    }
  })
  void qc.invalidateQueries({ queryKey: ['conversations'] })
}
