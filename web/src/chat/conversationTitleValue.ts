/** 仅会话路由可展示动态标题；打字机片段优先于已持久化的完整标题。 */
export function resolveConversationDocumentTitle(
  conversationId: string | undefined,
  persistedTitle: string | null | undefined,
  typingTitle: string | undefined,
): string | null | undefined {
  if (!conversationId) return null
  return typingTitle ?? persistedTitle
}
