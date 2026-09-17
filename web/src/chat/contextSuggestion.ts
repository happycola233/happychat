import type { MessageDTO } from '@shared/types/api'

/** messages 已是当前分支的有序路径；缺失用量时不以文字长度或更早一轮代替。 */
export function lastRequestInputTokens(
  messages: readonly Pick<MessageDTO, 'role' | 'status' | 'usage'>[],
): number | null {
  const latestReply = messages.findLast((message) => message.role === 'assistant')
  if (!latestReply || latestReply.status === 'streaming') return null
  return latestReply.usage?.lastInputTokens ?? latestReply.usage?.inputTokens ?? null
}
