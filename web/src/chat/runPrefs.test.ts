import { describe, expect, it } from 'vitest'
import type { ModelDTO } from '@shared/types/api'
import { getConversationRunPrefs } from './runPrefs'

const baseModel: ModelDTO = {
  id: 'model-1',
  modelId: 'gpt-test',
  displayName: 'GPT Test',
  description: null,
  tags: [],
  kind: 'responses',
  capabilities: {
    reasoning: true,
    vision: false,
    file_input: false,
    image_generation: false,
    web_search: true,
  },
  allowedEfforts: [
    { value: 'none', description: '关闭' },
    { value: 'low', description: '低' },
    { value: 'medium', description: '中' },
    { value: 'high', description: '高' },
  ],
  defaultEffort: 'medium',
  defaultWebSearch: true,
  defaultParams: null,
}

describe('getConversationRunPrefs', () => {
  it('keeps explicit web search and reasoning choices for optimistic conversation cache', () => {
    expect(
      getConversationRunPrefs(baseModel, { web_search: false, reasoning_effort: 'high' }),
    ).toEqual({
      web_search: false,
      reasoning_effort: 'high',
    })
  })

  it('fills omitted params from model defaults like the server conversation detail endpoint', () => {
    expect(getConversationRunPrefs(baseModel, {})).toEqual({
      web_search: true,
      reasoning_effort: 'medium',
    })
  })

  it('does not carry text-model params onto image runs', () => {
    expect(
      getConversationRunPrefs(
        {
          ...baseModel,
          kind: 'image',
          capabilities: { ...baseModel.capabilities, reasoning: false, web_search: false },
          allowedEfforts: [],
          defaultEffort: null,
          defaultWebSearch: false,
        },
        { image: { size: 'auto', quality: 'auto' } },
      ),
    ).toBeNull()
  })
})
