import { describe, expect, it } from 'vitest'
import {
  GPT_IMAGE_2_SIZE_OPTIONS,
  formatImageSizeForButton,
  parseImageSize,
  shouldValidateGptImage2Size,
  validateGptImage2Size,
} from './imageSize'

describe('gpt-image-2 image size rules', () => {
  it('exposes common 1K, 2K, and 4K choices', () => {
    expect(GPT_IMAGE_2_SIZE_OPTIONS.map((item) => item.value)).toEqual([
      'auto',
      '1024x1024',
      '1536x1024',
      '1024x1536',
      '2048x1152',
      '1152x2048',
      '2048x2048',
      '3840x2160',
      '2160x3840',
    ])
  })

  it('accepts auto and normalizes valid custom sizes', () => {
    expect(validateGptImage2Size('auto')).toMatchObject({
      ok: true,
      normalizedSize: 'auto',
      parsed: null,
    })
    expect(validateGptImage2Size(' 3840X2160 ')).toMatchObject({
      ok: true,
      normalizedSize: '3840x2160',
    })
  })

  it('marks sizes above 2560x1440 total pixels as experimental', () => {
    expect(parseImageSize('2048x2048')?.experimental).toBe(true)
    expect(parseImageSize('2048x1152')?.experimental).toBe(false)
  })

  it('rejects sizes outside OpenAI gpt-image-2 constraints', () => {
    expect(validateGptImage2Size('1025x1024')).toMatchObject({ ok: false })
    expect(validateGptImage2Size('4000x1024')).toMatchObject({ ok: false })
    expect(validateGptImage2Size('3840x1024')).toMatchObject({ ok: false })
    expect(validateGptImage2Size('512x512')).toMatchObject({ ok: false })
    expect(validateGptImage2Size('3840x3840')).toMatchObject({ ok: false })
  })

  it('formats custom sizes for compact button display', () => {
    expect(formatImageSizeForButton('1536x1024')).toBe('1536×1024 横')
    expect(formatImageSizeForButton('1280x720')).toBe('1280×720')
  })

  it('recognizes gpt-image-2 ids with compatible-provider prefixes', () => {
    expect(shouldValidateGptImage2Size('gpt-image-2')).toBe(true)
    expect(shouldValidateGptImage2Size('openai/gpt-image-2')).toBe(true)
    expect(shouldValidateGptImage2Size('gpt-image-1')).toBe(false)
  })
})
