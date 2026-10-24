import type {
  QuotaLimit,
  QuotaRule,
  QuotaRuleOverride,
  QuotaWindow,
  UserQuotaOverrides,
} from '@shared/types/domain'

type QuotaRuleOverrides = NonNullable<UserQuotaOverrides['rules']>

export interface QuotaRuleOverrideDraft {
  mode: 'inherit' | 'override' | 'disabled'
  limitUnlimited: boolean
  limitInput: string
  /** 空串=沿用模板周期 */
  windowChoice: '' | 'day' | 'week' | 'month' | 'total'
}

export function quotaRuleOverrideDraftFromRule(
  rule: QuotaRule,
  overrides: UserQuotaOverrides,
): QuotaRuleOverrideDraft {
  const override = overrides.rules?.[rule.id]
  if (override?.disabled) {
    return { mode: 'disabled', limitUnlimited: false, limitInput: '', windowChoice: '' }
  }
  if (override?.limit || override?.window) {
    return {
      mode: 'override',
      limitUnlimited: override.limit?.kind === 'unlimited',
      limitInput: override.limit?.kind === 'amount' ? String(override.limit.value) : '',
      windowChoice:
        override.window?.type === 'calendar'
          ? override.window.period
          : override.window?.type === 'total'
            ? 'total'
            : '',
    }
  }
  return {
    mode: 'inherit',
    limitUnlimited: rule.limit.kind === 'unlimited',
    limitInput: rule.limit.kind === 'amount' ? String(rule.limit.value) : '',
    windowChoice: '',
  }
}

/** 覆写草稿 → 覆写载荷；返回 null 表示该规则保持继承（不写入覆写）。 */
export function quotaRuleOverrideFromDraft(
  draft: QuotaRuleOverrideDraft,
): QuotaRuleOverride | null {
  if (draft.mode === 'disabled') return { disabled: true }
  if (draft.mode === 'inherit') return null
  const amount = Number(draft.limitInput)
  // 空输入表示沿用模板上限；显式填 0 才表示零额度，不能直接依赖 Number('') 的结果。
  const limit: QuotaLimit | undefined = draft.limitUnlimited
    ? { kind: 'unlimited' }
    : draft.limitInput.trim() && Number.isFinite(amount) && amount >= 0
      ? { kind: 'amount', value: amount }
      : undefined
  const window: QuotaWindow | undefined =
    draft.limitUnlimited || draft.windowChoice === ''
      ? undefined
      : draft.windowChoice === 'total'
        ? { type: 'total' }
        : { type: 'calendar', period: draft.windowChoice }
  // 覆写模式但没填任何有效值时按继承处理，避免写入空覆写被 zod 拒绝。
  if (!limit && !window) return null
  return { ...(limit ? { limit } : {}), ...(window ? { window } : {}) }
}

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
