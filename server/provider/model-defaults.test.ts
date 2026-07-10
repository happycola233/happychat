import { describe, expect, it } from 'vitest'
import { inferModelDefaults } from './model-defaults'

describe('inferModelDefaults', () => {
  it('enables image input for GPT Image models', () => {
    const defaults = inferModelDefaults('gpt-image-2')

    expect(defaults.kind).toBe('image')
    expect(defaults.capabilities).toMatchObject({
      vision: true,
      image_generation: true,
      file_input: false,
    })
  })

  it.each(['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'])(
    'treats %s as a multimodal Responses chat model without the legacy image generation flag',
    (modelId) => {
      const defaults = inferModelDefaults(modelId)

      expect(defaults.kind).toBe('responses')
      expect(defaults.capabilities.image_generation).toBe(false)
      expect(defaults.capabilities.vision).toBe(true)
      expect(defaults.capabilities.reasoning).toBe(true)
    },
  )

  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])(
    'gives %s all six documented reasoning efforts including max',
    (modelId) => {
      const defaults = inferModelDefaults(modelId)

      expect(defaults.allowedEfforts.map((option) => option.value)).toEqual([
        'none',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ])
      expect(defaults.allowedEfforts.find((option) => option.value === 'xhigh')?.description).toBe(
        '超高',
      )
      expect(defaults.defaultEffort).toBe('medium')
    },
  )

  it('does not expose max as a default for earlier GPT-5 models', () => {
    expect(inferModelDefaults('gpt-5.5').allowedEfforts.map((option) => option.value)).not.toContain(
      'max',
    )
  })

  it.each(['gpt-5.6', 'gpt-5.6-preview', 'gpt-5.6-unknown'])(
    'does not assume undocumented model %s supports max',
    (modelId) => {
      expect(
        inferModelDefaults(modelId).allowedEfforts.map((option) => option.value),
      ).not.toContain('max')
    },
  )
})
