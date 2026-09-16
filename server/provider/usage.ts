import type { MessageUsage } from '@shared/types/domain'

/** 累加续跑与重试中已经由上游报告的用量，不推测缺失用量。 */
export function addMessageUsage(left: MessageUsage, right: MessageUsage): MessageUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    cachedTokens: left.cachedTokens + right.cachedTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  }
}
