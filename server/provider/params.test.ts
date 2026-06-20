import { describe, expect, it } from 'vitest'
import type { BuildBodyOptions } from './params'
import { buildImageEditBody, buildResponseBody } from './params'

type ModelForBuild = BuildBodyOptions['model']

function model(overrides: Partial<ModelForBuild> = {}): ModelForBuild {
  return {
    id: 'model-1',
    providerId: 'provider-1',
    modelId: 'gpt-test',
    displayName: 'GPT Test',
    kind: 'responses',
    enabled: true,
    capabilities: {
      vision: false,
      file_input: false,
      web_search: true,
      image_generation: false,
      reasoning: false,
    },
    defaultSystemPrompt: null,
    defaultParams: null,
    hardParams: null,
    pricing: null,
    allowedEfforts: null,
    defaultEffort: null,
    defaultWebSearch: true,
    sort: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }
}

describe('buildResponseBody', () => {
  it('respects explicit web_search false over model defaults', () => {
    const body = buildResponseBody({
      model: model({ defaultParams: { web_search: true }, defaultWebSearch: true }),
      input: [],
      instructions: null,
      userParams: { web_search: false },
      stream: true,
    })

    expect(body.tools).toBeUndefined()
  })

  it('enables web search when the current request explicitly turns it on', () => {
    const body = buildResponseBody({
      model: model({ defaultParams: { web_search: false }, defaultWebSearch: false }),
      input: [],
      instructions: null,
      userParams: { web_search: true },
      stream: true,
    })

    expect(body.tools).toEqual([{ type: 'web_search' }])
  })
})

describe('buildImageEditBody', () => {
  it('builds an image edit request with shared image options', () => {
    const body = buildImageEditBody(
      model({
        modelId: 'gpt-image-2',
        kind: 'image',
        capabilities: {
          vision: true,
          file_input: false,
          web_search: false,
          image_generation: true,
          reasoning: false,
        },
      }),
      'Make the reference image red',
      ['data:image/png;base64,abc'],
      { image: { size: '1024x1024', quality: 'low' } },
    )

    expect(body).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'Make the reference image red',
      n: 1,
      size: '1024x1024',
      quality: 'low',
      images: [{ image_url: 'data:image/png;base64,abc' }],
    })
  })
})
