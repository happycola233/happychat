import { describe, expect, it } from 'vitest'
import { DEFAULT_FOLDER_COLOR } from '../constants'
import { resolveModelGroupColor } from './modelGroupAppearance'

describe('resolveModelGroupColor', () => {
  it('keeps a chosen color and falls back to the default yellow for the folder glyph', () => {
    expect(resolveModelGroupColor(null, '#ef4444')).toBe('#ef4444')
    expect(resolveModelGroupColor(undefined, undefined)).toBe(DEFAULT_FOLDER_COLOR)
  })

  it.each([
    { type: 'lobe', slug: 'openai' } as const,
    { type: 'custom', id: '12345678' } as const,
    { type: 'emoji', char: '🧠' } as const,
  ])('ignores hidden colors for $type icons', (icon) => {
    expect(resolveModelGroupColor(icon, '#ef4444')).toBeNull()
  })
})
