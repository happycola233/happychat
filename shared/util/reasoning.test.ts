import { describe, expect, it } from 'vitest'
import type { ReasoningModelConfig } from './reasoning'
import {
  effectiveReasoningEffort,
  isReasoningEnabled,
  normalizeReasoningEffortOptions,
} from './reasoning'

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

  it('accepts canonical object options and forwards custom values unchanged', () => {
    const m = model({
      allowedEfforts: [
        { value: 'none', description: '关闭' },
        { value: 'max', description: '极高' },
        { value: 'turbo', description: '极速推理' },
      ],
      defaultEffort: 'max',
    })

    expect(effectiveReasoningEffort(m, { reasoning_effort: 'turbo' })).toBe('turbo')
    expect(isReasoningEnabled(m, { reasoning_effort: 'max' })).toBe(true)
  })
})

describe('normalizeReasoningEffortOptions', () => {
  it('preserves legacy order and subsets without filling missing levels', () => {
    expect(normalizeReasoningEffortOptions(['high', 'xhigh'])).toEqual([
      { value: 'high', description: '高' },
      { value: 'xhigh', description: '超高' },
    ])
  })

  it('falls back to the raw value for unknown legacy levels and drops duplicates', () => {
    expect(
      normalizeReasoningEffortOptions([
        'vendor-ultra',
        { value: 'vendor-ultra', description: '重复项' },
      ]),
    ).toEqual([{ value: 'vendor-ultra', description: 'vendor-ultra' }])
  })
})
