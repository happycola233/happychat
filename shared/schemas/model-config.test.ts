import { describe, expect, it } from 'vitest'
import { effortSchema, reasoningEffortOptionsSchema } from './model-config'

describe('reasoning effort schemas', () => {
  it.each(['max', 'turbo-v2', 'provider.custom'])('accepts the custom upstream value %s', (value) => {
    expect(effortSchema.parse(value)).toBe(value)
  })

  it.each([
    '',
    'two words',
    'line\nbreak',
    'zero\u200Bwidth',
    'bidi\u202Eoverride',
    'control\u009Bchar',
  ])('rejects an invalid upstream value', (value) => {
    expect(effortSchema.safeParse(value).success).toBe(false)
  })

  it('normalizes legacy string arrays and uses the new xhigh description', () => {
    expect(reasoningEffortOptionsSchema.parse(['low', 'xhigh', 'vendor-max'])).toEqual([
      { value: 'low', description: '低' },
      { value: 'xhigh', description: '超高' },
      { value: 'vendor-max', description: 'vendor-max' },
    ])
  })

  it('keeps custom values and descriptions', () => {
    expect(
      reasoningEffortOptionsSchema.parse([
        { value: 'max', description: '极高' },
        { value: 'turbo', description: '极速推理' },
      ]),
    ).toEqual([
      { value: 'max', description: '极高' },
      { value: 'turbo', description: '极速推理' },
    ])
  })

  it('rejects duplicate values and empty descriptions', () => {
    expect(
      reasoningEffortOptionsSchema.safeParse([
        { value: 'high', description: '高' },
        { value: 'high', description: '另一个高' },
      ]).success,
    ).toBe(false)
    expect(
      reasoningEffortOptionsSchema.safeParse([{ value: 'high', description: ' ' }]).success,
    ).toBe(false)
  })
})
