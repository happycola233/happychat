import type { PromptCacheRetention } from '@shared/types/domain'

/** 会话是普通聊天产品中最自然、最稳定的缓存路由粒度。 */
export function promptCacheKeyForConversation(conversationId: string): string {
  return `happychat:conversation:${conversationId}`
}

/** 写入应用生成的缓存参数默认值；管理员 hardParams 可在之后显式覆盖。 */
export function applyPromptCacheParameters(
  body: Record<string, unknown>,
  promptCacheKey?: string,
  promptCacheRetention?: PromptCacheRetention | null,
): void {
  if (promptCacheKey) body.prompt_cache_key = promptCacheKey
  if (promptCacheRetention) body.prompt_cache_retention = promptCacheRetention
}
