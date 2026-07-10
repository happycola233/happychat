import { describe, expect, it } from 'vitest'
import {
  createReasoningEffortDraft,
  getReasoningEffortDraftErrors,
  validateReasoningEffortDrafts,
} from './reasoningEffortDrafts'

describe('reasoning effort draft validation', () => {
  it('accepts a custom visible value and description', () => {
    const draft = createReasoningEffortDraft({ value: 'vendor-ultra', description: '供应商极高' })

    expect(getReasoningEffortDraftErrors([draft])).toEqual({})
    expect(validateReasoningEffortDrafts([draft])).toBeNull()
  })

  it('associates missing fields with their row', () => {
    const draft = createReasoningEffortDraft()

    expect(getReasoningEffortDraftErrors([draft])[draft.draftId]).toEqual({
      value: '请填写上游值',
      description: '请填写推理等级「未命名等级」的显示描述',
    })
  })

  it('marks every row participating in a duplicate value', () => {
    const first = createReasoningEffortDraft({ value: 'max', description: '极高' })
    const second = createReasoningEffortDraft({ value: ' max ', description: '另一档' })
    const errors = getReasoningEffortDraftErrors([first, second])

    expect(errors[first.draftId]?.value).toContain('重复')
    expect(errors[second.draftId]?.value).toContain('重复')
  })

  it.each(['zero\u200Bwidth', 'bidi\u202Eoverride', 'control\u009Bchar'])(
    'rejects the invisible or control value %j',
    (value) => {
      const draft = createReasoningEffortDraft({ value, description: '危险值' })

      expect(getReasoningEffortDraftErrors([draft])[draft.draftId]?.value).toContain('不可见字符')
    },
  )
})
