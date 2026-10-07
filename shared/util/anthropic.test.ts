import { describe, expect, it } from 'vitest'
import {
  anthropicDefaultMaxOutputTokens,
  anthropicDefaultReasoningEffort,
  anthropicModelProfile,
  anthropicReasoningEffortOptions,
  createAnthropicDefaultHardParams,
} from './anthropic'

describe('Anthropic model presets', () => {
  it.each([
    ['claude-opus-5-5', 128000],
    ['claude-sonnet-5-5', 128000],
    ['claude-opus-5', 128000],
    ['claude-sonnet-5', 128000],
    ['claude-sonnet-4-6', 128000],
    ['claude-opus-4-5', 64000],
    ['claude-haiku-4-5-20251001', 64000],
    ['claude-sonnet-4-20250514', 64000],
    ['claude-opus-4-1-20250805', 32000],
    ['claude-opus-4-20250514', 32000],
  ])('目录缺失时为 %s 使用已知模型上限 %i', (modelId, expected) => {
    expect(anthropicDefaultMaxOutputTokens(modelId)).toBe(expected)
  })

  it.each([4096, 64000, 128000, 196608])('原样采用目录报告的上限 %i，不再钳制到示例值', (limit) => {
    expect(anthropicDefaultMaxOutputTokens('gateway-model', limit)).toBe(limit)
  })

  it('Opus 5.5 始终思考，默认 medium，不继承 Opus 5 的关闭能力', () => {
    const profile = anthropicModelProfile('claude-opus-5-5')
    expect(profile).toMatchObject({ thinkingDefaultsOn: true, canDisableThinking: false })
    expect(anthropicDefaultReasoningEffort(profile)).toBe('medium')
    expect(anthropicReasoningEffortOptions(profile).map((option) => option.value)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    expect(anthropicModelProfile('claude-opus-5').canDisableThinking).toBe(true)
  })

  it('Sonnet 5.5 用工具间思考代替关闭，旧 Sonnet 5 保留关闭', () => {
    const profile = anthropicModelProfile('claude-sonnet-5-5')
    expect(profile).toMatchObject({ canDisableThinking: false, supportsBetweenTools: true })
    expect(anthropicReasoningEffortOptions(profile)[0]).toEqual({
      value: 'between_tools',
      description: '仅工具间思考',
    })
    expect(anthropicModelProfile('claude-sonnet-5').canDisableThinking).toBe(true)
  })

  it('最新搜索在新旧模型中均默认直接调用，不限制搜索次数', () => {
    const modern = createAnthropicDefaultHardParams('claude-opus-5-5')
    const legacy = createAnthropicDefaultHardParams('claude-haiku-4-5')
    expect(modern.tools).toEqual([
      { type: 'web_search_20260318', name: 'web_search', allowed_callers: ['direct'] },
    ])
    expect(legacy.tools).toEqual([
      {
        type: 'web_search_20260318',
        name: 'web_search',
        allowed_callers: ['direct'],
      },
    ])
  })
})
