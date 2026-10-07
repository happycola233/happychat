import { describe, expect, it } from 'vitest'
import { parseImageGenerationUsage } from './image-usage'

describe('image generation usage boundary', () => {
  it('reads image output details and mutually exclusive input/cache details', () => {
    expect(
      parseImageGenerationUsage(
        {
          input_tokens: 20,
          input_tokens_details: {
            text_tokens: 5,
            image_tokens: 15,
            cached_tokens_details: { text_tokens: 2, image_tokens: 10 },
          },
          output_tokens: 40,
          output_tokens_details: { image_tokens: 30, text_tokens: 10 },
        },
        1,
        { size: '1024x1024', quality: 'high' },
        { model: 'gpt-image-test', quality: 'auto' },
      ),
    ).toEqual({
      model: 'gpt-image-test',
      imageCount: 1,
      size: '1024x1024',
      quality: 'high',
      textInputTokens: 5,
      imageInputTokens: 15,
      imageOutputTokens: 30,
      cachedTextInputTokens: 2,
      cachedImageInputTokens: 10,
    })
  })
  it('keeps missing, auto and invalid upstream values unknown', () => {
    expect(
      parseImageGenerationUsage(undefined, 2, {}, { size: 'auto', quality: 'auto' }),
    ).toMatchObject({
      imageCount: 2,
      size: null,
      quality: null,
      textInputTokens: null,
      imageInputTokens: null,
      imageOutputTokens: null,
    })
    expect(parseImageGenerationUsage({ input_tokens: 12, output_tokens: -5 }, 1, {})).toMatchObject(
      { textInputTokens: null, imageInputTokens: null, imageOutputTokens: null },
    )
    expect(parseImageGenerationUsage({ input_tokens: 0, output_tokens: 0 }, 0, {})).toMatchObject({
      textInputTokens: 0,
      imageInputTokens: 0,
      imageOutputTokens: 0,
    })
  })
})
