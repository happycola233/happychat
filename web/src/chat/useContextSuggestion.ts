import { useMemo, useState } from 'react'
import type { ConversationDTO, MessageDTO } from '@shared/types/api'
import { useContextOptimizationSuggestion } from '../hooks/useModels'
import { estimateContextTextTokens } from './contextSuggestion'

function wasDismissed(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export function useContextSuggestion(
  conversation: ConversationDTO,
  messages: readonly MessageDTO[],
  enabled: boolean,
) {
  const { data: config } = useContextOptimizationSuggestion()
  const storageKey = `happychat-context-suggestion:${conversation.id}`
  const [dismissed, setDismissed] = useState(() => wasDismissed(storageKey))
  const tokens = useMemo(
    () =>
      enabled && config?.enabled && !dismissed
        ? estimateContextTextTokens(messages, conversation.contextPolicy)
        : 0,
    [enabled, config?.enabled, dismissed, messages, conversation.contextPolicy],
  )
  const dismiss = () => {
    setDismissed(true)
    try {
      sessionStorage.setItem(storageKey, '1')
    } catch {
      /* 标签页存储不可用时仍保留本次页面的关闭状态。 */
    }
  }
  return {
    tokens,
    visible: Boolean(enabled && config?.enabled && !dismissed && tokens >= config.tokenThreshold),
    dismiss,
  }
}
