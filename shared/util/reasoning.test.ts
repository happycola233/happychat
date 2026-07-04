import { describe, expect, it } from 'vitest'
import type { ReasoningModelConfig } from './reasoning'
import { effectiveReasoningEffort, isReasoningEnabled } from './reasoning'

const model = (overrides: Partial<ReasoningModelConfig> = {}): ReasoningModelConfig => ({
  kind: 'responses',
  capabilities: { reasoning: true },
  allowedEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
  defaultParams: null,
  defaultEffort: null,
  ...overrides,
})

describe('reasoning settings', () => {
  it('treats explicit none as disabled even when the model default enables reasoning', () => {
    expect(isReasoningEnabled(model({ defaultEffort: 'high' }), { reasoning_effort: 'none' })).toBe(
      false,
    )
  })

  it('falls back to the model default when the user has not pinned an effort', () => {
    const m = model({ defaultEffort: 'medium' })

    expect(effectiveReasoningEffort(m, {})).toBe('medium')
    expect(isReasoningEnabled(m, {})).toBe(true)
  })

  it('ignores a pinned effort unsupported by the current model', () => {
    const m = model({ allowedEfforts: ['low', 'medium'], defaultEffort: 'low' })

    expect(effectiveReasoningEffort(m, { reasoning_effort: 'xhigh' })).toBe('low')
    expect(isReasoningEnabled(m, { reasoning_effort: 'xhigh' })).toBe(true)
  })

  it('does not let unsupported none disable a model that cannot use none', () => {
    const m = model({ allowedEfforts: ['high'], defaultEffort: 'high' })

    expect(effectiveReasoningEffort(m, { reasoning_effort: 'none' })).toBe('high')
    expect(isReasoningEnabled(m, { reasoning_effort: 'none' })).toBe(true)
  })

  it('does not enable reasoning for image models', () => {
    expect(isReasoningEnabled(model({ kind: 'image', defaultEffort: 'high' }), {})).toBe(false)
  })
})
