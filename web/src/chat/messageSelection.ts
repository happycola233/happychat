import type { MessageDTO } from '@shared/types/api'

export type SelectableMessage = Pick<MessageDTO, 'id' | 'role'>

export type MessageSelectionPreset = 'all' | 'user' | 'assistant'

/** 按当前分支顺序生成快捷选择预设，保证提交给服务端的消息顺序稳定。 */
export function messageIdsForPreset(
  messages: readonly SelectableMessage[],
  preset: MessageSelectionPreset,
): string[] {
  if (preset === 'all') return messages.map((message) => message.id)
  return messages.filter((message) => message.role === preset).map((message) => message.id)
}
