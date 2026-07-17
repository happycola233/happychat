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
    description: null,
    tags: null,
    kind: 'responses',
    enabled: true,
    accessMode: 'all',
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
  it('uses the model default web search setting when no request override is provided', () => {
    const body = buildResponseBody({
      model: model({ defaultParams: {}, defaultWebSearch: true }),
      input: [],
      instructions: null,
      userParams: {},
      stream: true,
    })

    expect(body.tools).toEqual([{ type: 'web_search' }])
  })

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

  it('does not inject a Responses image generation tool from the legacy capability flag', () => {
    const body = buildResponseBody({
      model: model({
        capabilities: {
          vision: true,
          file_input: false,
          web_search: true,
          image_generation: true,
          reasoning: false,
        },
        defaultParams: { image: { size: '1024x1024', quality: 'low' } },
        defaultWebSearch: true,
      }),
      input: [],
      instructions: null,
      userParams: {},
      stream: true,
    })

    expect(body.tools).toEqual([{ type: 'web_search' }])
  })

  it('merges advanced JSON tools with the generated web search tool', () => {
    const body = buildResponseBody({
      model: model({
        capabilities: {
          vision: false,
          file_input: false,
          web_search: true,
          image_generation: false,
          reasoning: true,
        },
        allowedEfforts: ['low', 'medium', 'high', 'xhigh'],
        defaultEffort: 'low',
        hardParams: {
          reasoning: { summary: 'auto' },
          tools: [{ type: 'image_generation', partial_images: 3 }],
        },
      }),
      input: [],
      instructions: null,
      userParams: { web_search: true },
      stream: true,
    })

    expect(body.reasoning).toEqual({ effort: 'low', summary: 'auto' })
    expect(body.tools).toEqual([
      { type: 'web_search' },
      { type: 'image_generation', partial_images: 3 },
    ])
  })

  it('falls back to a supported model default when the requested reasoning effort is unsupported', () => {
    const body = buildResponseBody({
      model: model({
        capabilities: {
          vision: false,
          file_input: false,
          web_search: false,
          image_generation: false,
          reasoning: true,
        },
        allowedEfforts: ['low', 'medium'],
        defaultEffort: 'low',
      }),
      input: [],
      instructions: null,
      userParams: { reasoning_effort: 'xhigh' },
      stream: true,
    })

    expect(body.reasoning).toEqual({ effort: 'low' })
  })

  it.each(['max', 'vendor-ultra'])(
    'forwards the configured custom reasoning effort %s unchanged',
    (reasoningEffort) => {
      const body = buildResponseBody({
        model: model({
          capabilities: {
            vision: false,
            file_input: false,
            web_search: false,
            image_generation: false,
            reasoning: true,
          },
          allowedEfforts: [
            { value: 'medium', description: '中' },
            { value: reasoningEffort, description: '自定义' },
          ],
          defaultEffort: 'medium',
        }),
        input: [],
        instructions: null,
        userParams: { reasoning_effort: reasoningEffort },
        stream: true,
      })

      expect(body.reasoning).toEqual({ effort: reasoningEffort })
      expect(body.max_output_tokens).toBe(25_000)
    },
  )

  it('lets advanced JSON replace the generated web search tool config', () => {
    const body = buildResponseBody({
      model: model({
        hardParams: {
          tools: [{ type: 'web_search', search_context_size: 'low' }],
        },
      }),
      input: [],
      instructions: null,
      userParams: { web_search: true },
      stream: true,
    })

    expect(body.tools).toEqual([{ type: 'web_search', search_context_size: 'low' }])
  })

  it('keeps an explicit empty advanced JSON tools array as an override', () => {
    const body = buildResponseBody({
      model: model({
        hardParams: { tools: [] },
      }),
      input: [],
      instructions: null,
      userParams: { web_search: true },
      stream: true,
    })

    expect(body.tools).toEqual([])
  })

  it('lets advanced hard params override the generated key and pass arbitrary upstream fields', () => {
    const body = buildResponseBody({
      model: model({
        hardParams: { prompt_cache_key: 'bad-key', prompt_cache_retention: 'in_memory' },
      }),
      input: [],
      instructions: null,
      stream: true,
      promptCacheKey: 'happychat:conversation:one',
    })

    expect(body).toMatchObject({
      prompt_cache_key: 'bad-key',
      prompt_cache_retention: 'in_memory',
    })
  })

  it('preserves prompt_cache_retention supplied through advanced hard params', () => {
    const body = buildResponseBody({
      model: model({ hardParams: { prompt_cache_retention: 'in_memory' } }),
      input: [],
      instructions: null,
      stream: true,
      promptCacheKey: 'happychat:conversation:one',
    })

    expect(body.prompt_cache_key).toBe('happychat:conversation:one')
    expect(body.prompt_cache_retention).toBe('in_memory')
  })

  it('does not generate prompt_cache_retention without an advanced hard param', () => {
    const body = buildResponseBody({
      model: model(),
      input: [],
      instructions: null,
      stream: true,
      promptCacheKey: 'happychat:conversation:one',
    })

    expect(body.prompt_cache_key).toBe('happychat:conversation:one')
    expect(body).not.toHaveProperty('prompt_cache_retention')
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
