import { describe, expect, it } from 'vitest'
import { imagePreviewMaxHeightClass } from './imagePreviewLayout'

describe('imagePreviewMaxHeightClass', () => {
  it('reserves room for the caption when previewing generated images', () => {
    const className = imagePreviewMaxHeightClass(true)

    expect(className).toContain('calc(100dvh-13.25rem)')
    expect(className).toContain('sm:max-h-[min(82dvh,calc(100dvh-14.75rem))]')
  })

  it('keeps the larger preview budget when no caption is shown', () => {
    const className = imagePreviewMaxHeightClass(false)

    expect(className).toBe('max-h-[min(82dvh,calc(100dvh-8.5rem))]')
  })
})
