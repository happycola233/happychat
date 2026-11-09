import { describe, expect, it } from 'vitest'
import {
  IMAGE_ASPECT_RATIOS,
  formatImageSizeLabel,
  imageModelProfile,
  imageSizeChoice,
  imageSizeForChoice,
  imageSizeOptions,
  parseImageSize,
  resolveImageOptions,
  validateImageSize,
} from './imageOptions'

const v26 = imageModelProfile('gpt-image-2.6-flare')
const v25 = imageModelProfile('openai/gpt-image-2.5-sunburst-2026-09-08')
const v2 = imageModelProfile('gpt-image-2')
const standard = imageModelProfile('gpt-image-1.5')

describe('imageModelProfile', () => {
  it('recognizes model families including provider prefixes and snapshots', () => {
    expect(v26).toMatchObject({ family: 'gpt-image-2.6', gif: true, svg: true, complexity: true })
    expect(v25).toMatchObject({ family: 'gpt-image-2.5', gif: false, svg: false })
    expect(v25.qualities).toContain('max')
    expect(imageModelProfile('GPT-Image-2-2026-04-21')).toMatchObject({ family: 'gpt-image-2' })
    expect(v2.qualities).not.toContain('xhigh')
    expect(standard).toMatchObject({ family: 'standard', flexibleSize: false })
  })
})

describe('比例 × 清晰度 → 尺寸', () => {
  it('1K follows the official standard sizes (short edge 1024)', () => {
    expect(imageSizeForChoice('1:1', '1k')).toBe('1024x1024')
    expect(imageSizeForChoice('3:2', '1k')).toBe('1536x1024')
    expect(imageSizeForChoice('2:3', '1k')).toBe('1024x1536')
    expect(imageSizeForChoice('16:9', '1k')).toBe('1824x1024')
  })

  it('2K stays within the stable 2560x1440 pixel budget and 4K reaches the maximum', () => {
    expect(imageSizeForChoice('16:9', '2k')).toBe('2560x1440')
    expect(imageSizeForChoice('1:1', '2k')).toBe('1920x1920')
    expect(imageSizeForChoice('16:9', '4k')).toBe('3840x2160')
    expect(imageSizeForChoice('9:16', '4k')).toBe('2160x3840')
    expect(imageSizeForChoice('1:1', '4k')).toBe('2880x2880')
  })

  it('every preset size is accepted by the upstream constraints', () => {
    for (const ratio of IMAGE_ASPECT_RATIOS)
      for (const resolution of ['1k', '2k', '4k'] as const)
        expect(validateImageSize(imageSizeForChoice(ratio.id, resolution), v26)).toMatchObject({
          ok: true,
        })
    for (const ratio of IMAGE_ASPECT_RATIOS)
      for (const resolution of ['gif-standard', 'gif-hd'] as const)
        expect(
          validateImageSize(imageSizeForChoice(ratio.id, resolution), v26, {
            frameCount: 16,
          }),
        ).toMatchObject({ ok: true })
  })

  it('maps a size back to its choice and treats others as custom', () => {
    expect(imageSizeChoice('2560x1440', v26, false)).toEqual({ ratio: '16:9', resolution: '2k' })
    expect(imageSizeChoice('auto', v26, false)).toEqual({ ratio: 'auto', resolution: null })
    expect(imageSizeChoice('1280x720', v26, false)).toEqual({ ratio: 'custom', resolution: null })
  })

  it('standard-size models only offer the three official sizes', () => {
    const options = imageSizeOptions(standard, false)
    expect(options.ratios.map((ratio) => ratio.id)).toEqual(['1:1', '3:2', '2:3'])
    expect(options.resolutions.map((resolution) => resolution.id)).toEqual(['1k'])
    expect(validateImageSize('2048x2048', standard)).toMatchObject({ ok: false })
  })
})

describe('validateImageSize', () => {
  it('enforces still-image limits', () => {
    expect(validateImageSize(' 3840X2160 ', v2)).toEqual({ ok: true, normalizedSize: '3840x2160' })
    expect(validateImageSize('1025x1024', v2)).toMatchObject({ ok: false })
    expect(validateImageSize('3840x1024', v2)).toMatchObject({ ok: false })
    expect(validateImageSize('512x512', v2)).toMatchObject({ ok: false })
    expect(validateImageSize('3840x3840', v2)).toMatchObject({ ok: false })
  })

  it('limits GIF frames by edge and by the sheet budget for the frame count', () => {
    expect(validateImageSize('960x960', v26, { frameCount: 9 })).toMatchObject({ ok: true })
    expect(validateImageSize('960x960', v26, { frameCount: 16 })).toMatchObject({ ok: false })
    expect(validateImageSize('1024x1024', v26, { frameCount: 2 })).toMatchObject({ ok: false })
  })

  it('formats labels', () => {
    expect(formatImageSizeLabel('auto')).toBe('自动')
    expect(formatImageSizeLabel('1536x1024')).toBe('1536×1024')
    expect(parseImageSize('abc')).toBeNull()
  })
})

describe('resolveImageOptions', () => {
  const generate = { editing: false }

  it('uses built-in defaults: lowest moderation and three progressive previews', () => {
    expect(resolveImageOptions(v26, null, null, generate)).toEqual({
      size: 'auto',
      quality: 'auto',
      output_format: 'png',
      output_compression: null,
      background: 'auto',
      moderation: 'low',
      partial_images: 3,
      n: 1,
      complexity: null,
      frame_count: null,
      frame_duration_ms: null,
    })
  })

  it('prefers user choices over admin defaults, per key', () => {
    const resolved = resolveImageOptions(
      v26,
      { quality: 'high', moderation: 'auto', size: '1536x1024' },
      { quality: 'low' },
      generate,
    )
    expect(resolved).toMatchObject({ quality: 'low', moderation: 'auto', size: '1536x1024' })
  })

  it('drops values the model does not support', () => {
    const resolved = resolveImageOptions(
      v2,
      null,
      { quality: 'max', output_format: 'gif', complexity: 'low' },
      generate,
    )
    expect(resolved).toMatchObject({ quality: 'auto', output_format: 'png', complexity: null })
  })

  it('GIF and SVG produce one file without progressive previews', () => {
    const gif = resolveImageOptions(
      v26,
      null,
      { output_format: 'gif', n: 3, size: '2560x1440' },
      generate,
    )
    expect(gif).toMatchObject({
      n: 1,
      partial_images: 0,
      frame_count: 9,
      frame_duration_ms: 200,
      // 静图 2K 尺寸不适合 GIF：保留比例换到 GIF 标准档。
      size: imageSizeForChoice('16:9', 'gif-standard'),
    })
    const svg = resolveImageOptions(v26, null, { output_format: 'svg', n: 2 }, generate)
    expect(svg).toMatchObject({ n: 1, partial_images: 0, output_compression: null })
  })

  it('SVG is text-to-image only and falls back to PNG when editing', () => {
    expect(
      resolveImageOptions(v26, null, { output_format: 'svg' }, { editing: true }).output_format,
    ).toBe('png')
  })

  it('keeps parameter dependencies consistent', () => {
    expect(
      resolveImageOptions(
        v26,
        null,
        { output_format: 'jpeg', background: 'transparent' },
        generate,
      ),
    ).toMatchObject({ background: 'auto', output_compression: 100 })
    expect(resolveImageOptions(v26, null, { n: 2 }, generate).partial_images).toBe(0)
    expect(resolveImageOptions(standard, null, { size: '2560x1440' }, generate).size).toBe(
      '1536x1024',
    )
  })
})
