import { useQuery, type QueryClient } from '@tanstack/react-query'
import type { MyQuotaDTO } from '@shared/types/api'
import { getMyQuota } from '../api/quota'

export const MY_QUOTA_QUERY_KEY = ['quota', 'me'] as const

/**
 * 当前用户的额度。生成结束后由 `ChatView` 主动失效，因此这里给一个较宽的 staleTime——
 * 额度变化的真实触发点是「刚发完一条消息」，而不是定时轮询。
 */
export function useMyQuota() {
  return useQuery({
    queryKey: MY_QUOTA_QUERY_KEY,
    queryFn: getMyQuota,
    staleTime: 30_000,
  })
}

export function invalidateMyQuota(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: MY_QUOTA_QUERY_KEY })
}

/** 额度提示条的状态：仅在开启限额且存在有限额度规则时才可能出现。 */
export type QuotaNoticeLevel = 'none' | 'warning' | 'exhausted' | 'model-exhausted' | 'paused'

export interface QuotaNoticeState {
  level: QuotaNoticeLevel
  /** 触发提示的那条规则（取最紧张的一条） */
  rule: MyQuotaDTO['rules'][number] | null
  /** 是否只影响当前所选模型（其他模型仍可用） */
  modelScoped: boolean
}

/**
 * 由额度快照派生输入区提示条的状态。纯函数，便于单测覆盖各分支。
 *
 * 优先级：当前模型被限 > 全局已耗尽 > 接近上限 > 暂停中说明。
 * 「暂停限额」不拦截，但仍要让用户知道自己实际已超支（管理员随时可能恢复）。
 */
export function resolveQuotaNotice(
  quota: MyQuotaDTO | undefined,
  activeModelId: string | null | undefined,
): QuotaNoticeState {
  const idle: QuotaNoticeState = { level: 'none', rule: null, modelScoped: false }
  if (!quota?.enabled || quota.unlimited) return idle

  const limited = quota.rules.filter((rule) => rule.limit.kind === 'amount' && !rule.invalid)
  if (limited.length === 0) return idle

  const blocked = limited.filter((rule) => rule.blocked)
  if (blocked.length > 0) {
    if (quota.paused) return { level: 'paused', rule: blocked[0] ?? null, modelScoped: false }
    const modelBlocked = Boolean(activeModelId && quota.blockedModelIds.includes(activeModelId))
    // 只有部分模型被限时，明确告诉用户「换个模型还能继续」。
    const someModelsAvailable = blocked.every((rule) => rule.scope.type !== 'all')
    if (modelBlocked) {
      return {
        level: someModelsAvailable ? 'model-exhausted' : 'exhausted',
        rule: blocked[0] ?? null,
        modelScoped: someModelsAvailable,
      }
    }
    // 当前模型没被限（例如别的模型的独立额度用尽）：不打扰用户。
    return idle
  }

  const nearest = limited.reduce<MyQuotaDTO['rules'][number] | null>(
    (max, rule) => ((rule.percent ?? 0) > (max?.percent ?? 0) ? rule : max),
    null,
  )
  if (nearest && (nearest.percent ?? 0) >= quota.warnThreshold) {
    return { level: 'warning', rule: nearest, modelScoped: nearest.scope.type !== 'all' }
  }
  return idle
}
