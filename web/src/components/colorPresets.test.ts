import { describe, expect, it } from 'vitest'
import { DEFAULT_FOLDER_COLOR } from '@shared/constants'
import {
  FOLDER_COLOR_PRESETS,
  FOLDER_CUSTOM_COLOR_SEED,
  FOLDER_CUSTOM_COLOR_SWATCH_BACKGROUND,
  FOLDER_CUSTOM_COLOR_SWATCH_ICON_COLOR,
  MODEL_TAG_COLOR_PRESETS,
  MODEL_TAG_TONE_COLORS,
} from './colorPresets'

describe('color presets', () => {
  it('包含全部模型标签自动配色色系', () => {
    expect(MODEL_TAG_COLOR_PRESETS).toEqual(
      expect.arrayContaining(Object.values(MODEL_TAG_TONE_COLORS)),
    )
  })

  it('为聊天文件夹和模型分组提供独立的柔和浅色色板', () => {
    expect(FOLDER_COLOR_PRESETS).toHaveLength(12)
    expect(DEFAULT_FOLDER_COLOR).toBe('#ffd96f')
    expect(FOLDER_COLOR_PRESETS).toContain(DEFAULT_FOLDER_COLOR)
    expect(FOLDER_COLOR_PRESETS).toContain('#9dceff')
    expect(FOLDER_COLOR_PRESETS).toContain('#aee3a1')
    expect(new Set(FOLDER_COLOR_PRESETS).size).toBe(FOLDER_COLOR_PRESETS.length)
    expect(MODEL_TAG_COLOR_PRESETS as readonly string[]).not.toContain(FOLDER_COLOR_PRESETS[0])
    expect(FOLDER_COLOR_PRESETS as readonly string[]).not.toContain(FOLDER_CUSTOM_COLOR_SEED)
    expect(FOLDER_CUSTOM_COLOR_SWATCH_BACKGROUND).toContain(DEFAULT_FOLDER_COLOR)
    expect(FOLDER_CUSTOM_COLOR_SWATCH_BACKGROUND).not.toContain('#ef4444')
    expect(FOLDER_CUSTOM_COLOR_SWATCH_ICON_COLOR).toBe('#6f6a86')
  })
})
