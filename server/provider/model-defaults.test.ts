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
})
