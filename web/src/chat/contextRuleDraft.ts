import type { AttachmentRetention, ContextPolicy } from '@shared/types/context'
import { contextPolicySchema } from '@shared/schemas/context'

export type RuleDraft = { mode: AttachmentRetention['mode']; limit: string }
export type PolicyDraft = {
  history: { mode: 'all' | 'rounds' | 'none'; limit: string }
  uploads: RuleDraft
  generatedImages: RuleDraft
}

export function draftFromPolicy(policy: ContextPolicy): PolicyDraft {
  const rule = (value: AttachmentRetention): RuleDraft => ({
    mode: value.mode,
    limit: 'limit' in value ? String(value.limit) : '3',
  })
  return {
    history: {
      mode: policy.historyTurns === null ? 'all' : policy.historyTurns === 0 ? 'none' : 'rounds',
      limit: String(policy.historyTurns || 10),
    },
    uploads: rule(policy.uploads),
    generatedImages: rule(policy.generatedImages),
  }
}

export function policyFromDraft(draft: PolicyDraft): ContextPolicy | null {
  const count = (value: string) => (/^\d+$/.test(value) ? Number(value) : NaN)
  const rule = (value: RuleDraft) =>
    value.mode === 'items' || value.mode === 'rounds'
      ? { mode: value.mode, limit: count(value.limit) }
      : { mode: value.mode }
  const result = contextPolicySchema.safeParse({
    historyTurns:
      draft.history.mode === 'all'
        ? null
        : draft.history.mode === 'none'
          ? 0
          : count(draft.history.limit),
    uploads: rule(draft.uploads),
    generatedImages: rule(draft.generatedImages),
  })
  // 「按轮」至少一轮；仅本次使用独立选项，避免 0 同时承担两个含义。
  if (draft.history.mode === 'rounds' && count(draft.history.limit) === 0) return null
  return result.success ? result.data : null
}
