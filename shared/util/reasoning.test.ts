import { describe, expect, it } from 'vitest'
import type { ReasoningModelConfig } from './reasoning'
import { effectiveReasoningEffort, isReasoningEnabled } from './reasoning'

const model = (overrides: Partial<ReasoningModelConfig> = {}): ReasoningModelConfig => ({
  kind: 'responses',
  capabilities: { reasoning: true },
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

  it('does not enable reasoning for image models', () => {
    expect(isReasoningEnabled(model({ kind: 'image', defaultEffort: 'high' }), {})).toBe(false)
  })
})
