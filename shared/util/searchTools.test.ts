import { describe, expect, it } from 'vitest'
import type { ModelCapabilities, ModelKind } from '../types/domain'
import { normalizeModelCapabilitiesForKind } from './modelCapabilities'
import {
  effectiveWebSearchEnabled,
  effectiveXSearchEnabled,
  modelKindSupportsSearchTools,
  normalizeSearchParamsForModelKind,
} from './searchTools'

const searchCapabilities: ModelCapabilities = {
  vision: false,
  file_input: false,
  web_search: true,
  x_search: true,
  image_generation: false,
  reasoning: false,
}

function model(kind: ModelKind) {
  return {
    kind,
    capabilities: searchCapabilities,
    defaultParams: { web_search: true, x_search: true },
    defaultWebSearch: true,
    defaultXSearch: true,
  }
}

describe('search tool protocol boundary', () => {
  it('disables Web/X Search for Chat Completions even when stale settings enable both', () => {
    expect(modelKindSupportsSearchTools('chat')).toBe(false)
    expect(effectiveWebSearchEnabled(model('chat'), { web_search: true })).toBe(false)
    expect(effectiveXSearchEnabled(model('chat'), { x_search: true })).toBe(false)
    expect(normalizeModelCapabilitiesForKind('chat', searchCapabilities)).toMatchObject({
      web_search: false,
      x_search: false,
    })
    expect(
      normalizeSearchParamsForModelKind('chat', {
        temperature: 0.5,
        web_search: true,
        x_search: true,
      }),
    ).toEqual({ temperature: 0.5 })
  })

  it('keeps Responses and Anthropic search behavior unchanged', () => {
    expect(effectiveWebSearchEnabled(model('responses'))).toBe(true)
    expect(effectiveXSearchEnabled(model('responses'))).toBe(true)
    expect(effectiveWebSearchEnabled(model('anthropic'))).toBe(true)
    const responsesParams = { web_search: true, x_search: true }
    const anthropicParams = { web_search: true }
    expect(normalizeSearchParamsForModelKind('responses', responsesParams)).toBe(responsesParams)
    expect(normalizeSearchParamsForModelKind('anthropic', anthropicParams)).toBe(anthropicParams)
  })
})
