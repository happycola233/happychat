import { DEFAULT_REASONING_EFFORT_OPTIONS } from '@shared/constants'
import type { ReasoningEffortOption } from '@shared/types/domain'
import { isSafeReasoningEffortValue } from '@shared/util/reasoning'

let nextDraftId = 0

/** 表单专用稳定 id：默认档位绑定行而不是 value，编辑 value 时不会丢失关联。 */
export interface ReasoningEffortDraft extends ReasoningEffortOption {
  draftId: string
}

export interface ReasoningEffortDraftFieldErrors {
  value?: string
  description?: string
}

export type ReasoningEffortDraftErrors = Record<string, ReasoningEffortDraftFieldErrors>

export function createReasoningEffortDraft(
  option: ReasoningEffortOption = { value: '', description: '' },
): ReasoningEffortDraft {
  nextDraftId += 1
  return { ...option, draftId: `reasoning-effort-${nextDraftId}` }
}

/** 手动新建模型的通用预设；max 仅在已确认支持的模型上由供应商推断路径添加。 */
export function createManualModelReasoningEffortDrafts(): ReasoningEffortDraft[] {
  return DEFAULT_REASONING_EFFORT_OPTIONS.filter((option) => option.value !== 'max').map((option) =>
    createReasoningEffortDraft(option),
  )
}

/**
 * 返回逐行、逐字段的错误，供表单把提示与具体输入框关联。
 * 重复值会标记所有重复行，避免只改其中一行后仍不知道另一处冲突在哪里。
 */
export function getReasoningEffortDraftErrors(
  drafts: readonly ReasoningEffortDraft[],
): ReasoningEffortDraftErrors {
  const valueCounts = new Map<string, number>()
  for (const draft of drafts) {
    const value = draft.value.trim()
    if (value) valueCounts.set(value, (valueCounts.get(value) ?? 0) + 1)
  }

  const errors: ReasoningEffortDraftErrors = {}
  for (const draft of drafts) {
    const value = draft.value.trim()
    const fieldErrors: ReasoningEffortDraftFieldErrors = {}

    if (!value) {
      fieldErrors.value = '请填写上游值'
    } else if (!isSafeReasoningEffortValue(value)) {
      fieldErrors.value = `推理等级值「${value}」不能包含空白、控制或不可见字符`
    } else if (value.length > 64) {
      fieldErrors.value = `推理等级值「${value}」不能超过 64 个字符`
    } else if ((valueCounts.get(value) ?? 0) > 1) {
      fieldErrors.value = `推理等级值「${value}」重复`
    }

    const description = draft.description.trim()
    const effortName = value || '未命名等级'
    if (!description) {
      fieldErrors.description = `请填写推理等级「${effortName}」的显示描述`
    } else if (description.length > 80) {
      fieldErrors.description = `推理等级「${effortName}」的描述不能超过 80 个字符`
    }

    if (fieldErrors.value || fieldErrors.description) errors[draft.draftId] = fieldErrors
  }
  return errors
}

/** 保留表单底部摘要：从字段错误的同一真值中按行、字段顺序取首条。 */
export function validateReasoningEffortDrafts(drafts: readonly ReasoningEffortDraft[]): string | null {
  const errors = getReasoningEffortDraftErrors(drafts)
  for (const draft of drafts) {
    const fieldErrors = errors[draft.draftId]
    if (fieldErrors?.value) return fieldErrors.value
    if (fieldErrors?.description) return fieldErrors.description
  }
  return null
}
