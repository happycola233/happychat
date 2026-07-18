import { describe, expect, it } from 'vitest'
import {
  effortSchema,
  MODEL_ACCESS_USER_LIMIT,
  modelAccessUpdateSchema,
  modelCreateSchema,
  modelUpdateSchema,
  reasoningEffortOptionsSchema,
} from './model-config'

describe('reasoning effort schemas', () => {
  it.each(['max', 'turbo-v2', 'provider.custom'])(
    'accepts the custom upstream value %s',
    (value) => {
      expect(effortSchema.parse(value)).toBe(value)
    },
  )

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

describe('model access schema', () => {
  it('accepts explicit all and empty selected policies', () => {
    expect(modelAccessUpdateSchema.parse({ accessMode: 'all', userIds: [] })).toEqual({
      accessMode: 'all',
      userIds: [],
    })
    expect(modelAccessUpdateSchema.parse({ accessMode: 'selected', userIds: [] })).toEqual({
      accessMode: 'selected',
      userIds: [],
    })
  })

  it('normalizes user IDs and rejects empty or duplicate entries', () => {
    expect(
      modelAccessUpdateSchema.parse({ accessMode: 'selected', userIds: [' user-a '] }),
    ).toEqual({ accessMode: 'selected', userIds: ['user-a'] })
    expect(
      modelAccessUpdateSchema.safeParse({ accessMode: 'selected', userIds: ['user-a', 'user-a'] })
        .success,
    ).toBe(false)
    expect(
      modelAccessUpdateSchema.safeParse({ accessMode: 'selected', userIds: [' '] }).success,
    ).toBe(false)
    expect(
      modelAccessUpdateSchema.safeParse({
        accessMode: 'selected',
        userIds: Array.from({ length: MODEL_ACCESS_USER_LIMIT + 1 }, (_, index) => `user-${index}`),
      }).success,
    ).toBe(false)
  })
})

describe('reasoning replay model config', () => {
  const createInput = {
    providerId: 'provider-1',
    modelId: 'gpt-test',
    displayName: 'GPT Test',
  }

  it('defaults new models to not replay encrypted reasoning context', () => {
    expect(modelCreateSchema.parse(createInput).replayReasoning).toBe(false)
  })

  it('accepts explicit create and partial update values', () => {
    expect(modelCreateSchema.parse({ ...createInput, replayReasoning: true }).replayReasoning).toBe(
      true,
    )
    expect(modelUpdateSchema.parse({ replayReasoning: true })).toEqual({ replayReasoning: true })
    expect(modelUpdateSchema.parse({})).toEqual({})
  })
})
