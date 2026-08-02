import { describe, expect, it } from 'vitest'
import { COLOR_PRESETS, MODEL_TAG_TONE_COLORS } from './colorPresets'

describe('COLOR_PRESETS', () => {
  it('包含全部模型标签自动配色色系', () => {
    expect(COLOR_PRESETS).toEqual(expect.arrayContaining(Object.values(MODEL_TAG_TONE_COLORS)))
  })
})
