/** 会话是普通聊天产品中最自然、最稳定的缓存路由粒度。 */
export function promptCacheKeyForConversation(conversationId: string): string {
  return `happychat:conversation:${conversationId}`
}

/** 写入应用生成的稳定缓存路由 key；管理员 hardParams 可在之后显式覆盖。 */
export function applyPromptCacheKey(body: Record<string, unknown>, promptCacheKey?: string): void {
  if (promptCacheKey) body.prompt_cache_key = promptCacheKey
}
