import { describe, expect, it } from 'vitest'
import { inferModelDefaults } from './model-defaults'

describe('inferModelDefaults', () => {
  it('enables image input for GPT Image models', () => {
    const defaults = inferModelDefaults('gpt-image-2')

    expect(defaults.kind).toBe('image')
    expect(defaults.capabilities).toMatchObject({
      vision: true,
      image_generation: true,
      file_input: false,
    })
  })

  it.each(['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'])(
    'treats %s as a multimodal Responses chat model without the legacy image generation flag',
    (modelId) => {
      const defaults = inferModelDefaults(modelId)

      expect(defaults.kind).toBe('responses')
      expect(defaults.capabilities.image_generation).toBe(false)
      expect(defaults.capabilities.vision).toBe(true)
      expect(defaults.capabilities.reasoning).toBe(true)
    },
  )

  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])(
    'gives %s all six documented reasoning efforts including max',
    (modelId) => {
      const defaults = inferModelDefaults(modelId)

      expect(defaults.allowedEfforts.map((option) => option.value)).toEqual([
        'none',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ])
      expect(defaults.allowedEfforts.find((option) => option.value === 'xhigh')?.description).toBe(
        '超高',
      )
      expect(defaults.defaultEffort).toBe('medium')
    },
  )

  it('does not expose max as a default for earlier GPT-5 models', () => {
    expect(
      inferModelDefaults('gpt-5.5').allowedEfforts.map((option) => option.value),
    ).not.toContain('max')
  })

  it.each(['gpt-5.6', 'gpt-5.6-preview', 'gpt-5.6-unknown'])(
    'does not assume undocumented model %s supports max',
    (modelId) => {
      expect(
        inferModelDefaults(modelId).allowedEfforts.map((option) => option.value),
      ).not.toContain('max')
    },
  )

  it('为 Anthropic 目录模型生成原生 Messages 配置和可见高级 JSON', () => {
    const defaults = inferModelDefaults('claude-sonnet-5', 'anthropic')

    expect(defaults.kind).toBe('anthropic')
    expect(defaults.capabilities).toMatchObject({
      vision: true,
      file_input: true,
      web_search: true,
      reasoning: true,
    })
    expect(defaults.defaultEffort).toBe('high')
    expect(defaults.replayProviderContext).toBe(true)
    expect(defaults.defaultParams).toEqual({ max_output_tokens: 16000 })
    expect(defaults.hardParams).toMatchObject({
      cache_control: { type: 'ephemeral' },
      thinking: { type: 'adaptive', display: 'summarized' },
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    })
    expect(defaults.hardParams).not.toHaveProperty('max_tokens')
    expect(defaults.hardParams).not.toHaveProperty('tools.0.max_uses')
  })

  it('按 Claude 代际生成可用的 thinking 模式和 effort 档位', () => {
    const sonnet46 = inferModelDefaults('claude-sonnet-4-6', 'anthropic')
    expect(sonnet46.hardParams.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
    })
    expect(sonnet46.allowedEfforts.map((option) => option.value)).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'max',
    ])

    const haiku45 = inferModelDefaults('claude-haiku-4-5-20251001', 'anthropic')
    expect(haiku45.hardParams.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 8192,
      display: 'summarized',
    })
    expect(haiku45.allowedEfforts).toEqual([
      { value: 'none', description: '关闭' },
      { value: 'enabled', description: '开启' },
    ])
    expect(haiku45.defaultEffort).toBe('enabled')

    const unknown = inferModelDefaults('claude-compatible-unknown', 'anthropic')
    expect(unknown.capabilities.reasoning).toBe(false)
    expect(unknown.allowedEfforts).toEqual([])
    expect(unknown.defaultEffort).toBeNull()
    expect(unknown.hardParams).not.toHaveProperty('thinking')
  })

  it.each([
    ['claude-fable-5', 'adaptive'],
    ['claude-mythos-5', 'adaptive'],
    ['claude-mythos-preview', 'adaptive'],
    ['claude-opus-5', 'adaptive'],
    ['claude-opus-4-8', 'adaptive'],
    ['claude-opus-4-7', 'adaptive'],
    ['claude-sonnet-5', 'adaptive'],
    ['claude-opus-4-6', 'adaptive'],
    ['claude-sonnet-4-6', 'adaptive'],
    ['claude-opus-4-5', 'enabled'],
    ['claude-haiku-4-5', 'enabled'],
    ['claude-sonnet-4-5', 'enabled'],
    ['claude-opus-4-1', 'enabled'],
  ])('按官方支持矩阵为 %s 自动选择 thinking.type=%s', (modelId, type) => {
    const defaults = inferModelDefaults(modelId, 'anthropic')
    expect(defaults.hardParams.thinking).toMatchObject({ type })
    expect(
      defaults.defaultEffort === null ||
        defaults.allowedEfforts.some((option) => option.value === defaults.defaultEffort),
    ).toBe(true)
  })

  it.each(['claude-opus-4-0', 'claude-sonnet-4-0', 'claude-opus-4-20250514'])(
    '为旧版别名 %s 使用 manual thinking，而不是误发 adaptive',
    (modelId) => {
      expect(inferModelDefaults(modelId, 'anthropic').hardParams.thinking).toMatchObject({
        type: 'enabled',
        budget_tokens: 8192,
      })
    },
  )

  it('优先使用 Models API capabilities，并钳制可见输出上限默认值', () => {
    const defaults = inferModelDefaults(
      'gateway-model-without-known-id',
      'anthropic',
      {
        image_input: { supported: false },
        pdf_input: { supported: true },
        thinking: {
          supported: true,
          types: {
            adaptive: { supported: true },
            enabled: { supported: false },
          },
        },
        effort: {
          supported: true,
          low: { supported: true },
          medium: { supported: false },
          high: { supported: true },
          xhigh: { supported: false },
          max: { supported: false },
        },
      },
      4096,
    )

    expect(defaults.capabilities).toMatchObject({
      vision: false,
      file_input: true,
      reasoning: true,
    })
    expect(defaults.allowedEfforts.map((option) => option.value)).toEqual(['none', 'low', 'high'])
    expect(defaults.defaultParams.max_output_tokens).toBe(4096)
    expect(defaults.hardParams).not.toHaveProperty('max_tokens')
    expect(defaults.hardParams.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
    })
  })

  it('Models API capabilities 缺少叶字段时继承已知模型 profile', () => {
    const thinkingOnly = inferModelDefaults(
      'claude-sonnet-5',
      'anthropic',
      { thinking: { supported: true } },
      8192,
    )
    expect(thinkingOnly.capabilities.reasoning).toBe(true)
    expect(thinkingOnly.hardParams.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
    })
    expect(thinkingOnly.allowedEfforts.map((option) => option.value)).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])

    const effortOnly = inferModelDefaults(
      'claude-sonnet-5',
      'anthropic',
      { effort: { supported: true, xhigh: { supported: false } } },
      8192,
    )
    expect(effortOnly.capabilities.reasoning).toBe(true)
    expect(effortOnly.allowedEfforts.map((option) => option.value)).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'max',
    ])
  })

  it('Models API 只报告非 high effort 时仍选择有效默认等级', () => {
    const defaults = inferModelDefaults(
      'gateway-adaptive-model',
      'anthropic',
      {
        thinking: { supported: true, types: { adaptive: { supported: true } } },
        effort: {
          supported: true,
          low: { supported: true },
          medium: { supported: false },
          high: { supported: false },
          xhigh: { supported: false },
          max: { supported: false },
        },
      },
      8192,
    )

    expect(defaults.allowedEfforts.map((option) => option.value)).toEqual(['none', 'low'])
    expect(defaults.defaultEffort).toBe('low')
  })

  it('Models API capabilities 的父级 supported=false 会明确关闭对应能力', () => {
    const thinkingDisabled = inferModelDefaults(
      'claude-sonnet-5',
      'anthropic',
      { thinking: { supported: false } },
      8192,
    )
    expect(thinkingDisabled.capabilities.reasoning).toBe(false)
    expect(thinkingDisabled.allowedEfforts).toEqual([])
    expect(thinkingDisabled.hardParams).not.toHaveProperty('thinking')

    const effortDisabled = inferModelDefaults(
      'claude-sonnet-5',
      'anthropic',
      { effort: { supported: false } },
      8192,
    )
    expect(effortDisabled.capabilities.reasoning).toBe(true)
    expect(effortDisabled.allowedEfforts.map((option) => option.value)).toEqual(['none', 'enabled'])
    expect(effortDisabled.hardParams.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
    })
  })
})
