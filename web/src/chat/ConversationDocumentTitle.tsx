import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useTitleTypingStore } from '../store/titleTyping'
import { resolveConversationDocumentTitle } from './conversationTitleValue'

interface ConversationDocumentTitleProps {
  conversationId: string | undefined
  persistedTitle: string | null | undefined
}

/** 独立订阅打字机，避免每次逐字更新都重渲染完整聊天消息树。 */
export function ConversationDocumentTitle({
  conversationId,
  persistedTitle,
}: ConversationDocumentTitleProps) {
  const typingTitle = useTitleTypingStore((state) =>
    conversationId ? state.byConversation[conversationId]?.text : undefined,
  )
  useDocumentTitle(resolveConversationDocumentTitle(conversationId, persistedTitle, typingTitle))
  return null
}
