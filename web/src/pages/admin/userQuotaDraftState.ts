import type { UserQuotaOverrides } from '@shared/types/domain'

type QuotaRuleOverrides = NonNullable<UserQuotaOverrides['rules']>

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    return Object.fromEntries(
      Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
    )
  })
}

/** 周期调整只能作用于已保存的策略与规则；草稿变化时必须先保存或撤销。 */
export function hasUnsavedQuotaDefinitionChanges(
  savedPolicyId: string | null,
  draftPolicyId: string | null | undefined,
  savedOverrides: UserQuotaOverrides,
  draftOverrides: UserQuotaOverrides,
): boolean {
  if ((draftPolicyId ?? null) !== savedPolicyId) return true
  return stableJson(draftOverrides) !== stableJson(savedOverrides)
}

/**
 * 策略切换或模板删规则时，旧覆写暂时不可见但仍属于用户配置；编辑其他字段不能顺手清掉。
 */
export function hiddenQuotaRuleOverrides(
  savedOverrides: UserQuotaOverrides,
  visibleRuleIds: readonly string[],
): QuotaRuleOverrides {
  const visible = new Set(visibleRuleIds)
  return Object.fromEntries(
    Object.entries(savedOverrides.rules ?? {}).filter(([ruleId]) => !visible.has(ruleId)),
  )
}
