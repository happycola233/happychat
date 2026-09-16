import type { ContextPolicy } from '@shared/types/context'
import { selectContext, type ContextMessage } from '@shared/util/contextPolicy'

/** 轻量文本估算只用于建议，不用于计费或请求裁剪；中文等非 ASCII 字符按约 1 token 计。 */
export function estimateContextTextTokens(
  messages: readonly ContextMessage[],
  policy: ContextPolicy,
): number {
  const selected = selectContext(messages, policy)
  let weightedLength = 0
  for (const message of selected.messages) {
    for (const part of message.content) {
      if (part.type !== 'input_text' && part.type !== 'output_text') continue
      for (const character of part.text) weightedLength += character.charCodeAt(0) > 127 ? 1 : 0.25
    }
  }
  return Math.ceil(weightedLength)
}
