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
})
