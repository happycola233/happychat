import { describe, expect, it } from 'vitest'
import { resolveModelGroupColor } from './modelGroupAppearance'

describe('resolveModelGroupColor', () => {
  it('keeps the chosen color only for the default folder glyph', () => {
    expect(resolveModelGroupColor(null, '#ef4444')).toBe('#ef4444')
    expect(resolveModelGroupColor(undefined, undefined)).toBeNull()
  })

  it.each([
    { type: 'lobe', slug: 'openai' } as const,
    { type: 'custom', id: '12345678' } as const,
    { type: 'emoji', char: '🧠' } as const,
  ])('ignores hidden colors for $type icons', (icon) => {
    expect(resolveModelGroupColor(icon, '#ef4444')).toBeNull()
  })
})
