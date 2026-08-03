import { describe, expect, it } from 'vitest'
import {
  migrateDefaultParamsFromAnthropic,
  migrateDefaultParamsToAnthropic,
  migrateHardParamsToAnthropic,
  modelKindForProviderProtocol,
  syncAnthropicThinkingHardParams,
} from './modelProtocolMigration'

describe('modelProtocolMigration', () => {
  it('同 Anthropic 协议切换 Provider 时保持 kind，不触发模板迁移', () => {
    expect(modelKindForProviderProtocol('anthropic', 'anthropic')).toBe('anthropic')
    expect(modelKindForProviderProtocol('responses', 'anthropic')).toBe('anthropic')
    expect(modelKindForProviderProtocol('anthropic', 'openai')).toBe('responses')
    expect(modelKindForProviderProtocol('chat', 'openai')).toBe('chat')
  })

  it('迁移时保留已有 versioned web search 模板且不插入旧默认模板', () => {
    const existingSearchTool = {
      type: 'web_search_20260318',
      name: 'web_search',
      max_uses: 2,
      allowed_domains: ['docs.anthropic.com'],
    }
    const customTool = {
      name: 'lookup_local_data',
      description: 'local',
      input_schema: { type: 'object' },
    }
    const migrated = JSON.parse(
      migrateHardParamsToAnthropic(
        JSON.stringify({
          max_output_tokens: 2048,
          tools: [existingSearchTool, customTool, { type: 'x_search' }],
          custom_gateway_field: true,
        }),
        'claude-sonnet-5',
      ),
    ) as Record<string, unknown>

    expect(migrated).not.toHaveProperty('max_output_tokens')
    expect(migrated).toMatchObject({
      custom_gateway_field: true,
      tools: [existingSearchTool, customTool],
    })
    expect(migrated).not.toHaveProperty('max_tokens')
    expect(JSON.stringify(migrated)).not.toContain('web_search_20250305')
  })

  it('离开 Anthropic 时移除本次切换自动填入的 max_output_tokens', () => {
    const entered = migrateDefaultParamsToAnthropic({ temperature: 0.6 }, 16_000)

    expect(entered).toEqual({
      params: { temperature: 0.6, max_output_tokens: 16_000 },
      autoFilledMaxOutputTokens: true,
    })
    expect(
      migrateDefaultParamsFromAnthropic(entered.params, entered.autoFilledMaxOutputTokens),
    ).toEqual({ temperature: 0.6 })
  })

  it('保留用户原有或主动修改过的 max_output_tokens', () => {
    const existing = migrateDefaultParamsToAnthropic({ max_output_tokens: 4096 }, 16_000)
    const edited = { ...existing.params, max_output_tokens: 8192 }

    expect(existing.autoFilledMaxOutputTokens).toBe(false)
    expect(migrateDefaultParamsFromAnthropic(existing.params, false)).toEqual({
      max_output_tokens: 4096,
    })
    expect(migrateDefaultParamsFromAnthropic(edited, false)).toEqual({ max_output_tokens: 8192 })
  })

  it('Anthropic 思考开关同步更新高级 JSON，并保留其他硬参数', () => {
    const enabled = syncAnthropicThinkingHardParams(
      JSON.stringify({ cache_control: { type: 'ephemeral' }, gateway_option: true }),
      'claude-sonnet-5',
      true,
    )
    expect(JSON.parse(enabled)).toEqual({
      cache_control: { type: 'ephemeral' },
      gateway_option: true,
      thinking: { type: 'adaptive', display: 'summarized' },
    })

    expect(JSON.parse(syncAnthropicThinkingHardParams(enabled, 'claude-sonnet-5', false))).toEqual({
      cache_control: { type: 'ephemeral' },
      gateway_option: true,
      thinking: { type: 'disabled' },
    })
  })

  it('关闭默认不思考的 Anthropic 型号时移除 thinking 模板', () => {
    const disabled = syncAnthropicThinkingHardParams(
      JSON.stringify({
        cache_control: { type: 'ephemeral' },
        thinking: { type: 'adaptive', display: 'summarized' },
      }),
      'claude-sonnet-4-6',
      false,
    )

    expect(JSON.parse(disabled)).toEqual({ cache_control: { type: 'ephemeral' } })
  })

  it('切换模型 ID 时自动选择 thinking.type，并保留兼容的自定义字段', () => {
    const manual = syncAnthropicThinkingHardParams(
      JSON.stringify({
        cache_control: { type: 'ephemeral' },
        gateway_option: true,
        thinking: { type: 'adaptive', display: 'omitted' },
      }),
      'claude-haiku-4-5',
      true,
    )
    expect(JSON.parse(manual)).toEqual({
      cache_control: { type: 'ephemeral' },
      gateway_option: true,
      thinking: { type: 'enabled', budget_tokens: 8192, display: 'omitted' },
    })

    const adaptive = syncAnthropicThinkingHardParams(manual, 'claude-opus-4-8', true)
    expect(JSON.parse(adaptive)).toEqual({
      cache_control: { type: 'ephemeral' },
      gateway_option: true,
      thinking: { type: 'adaptive', display: 'omitted' },
    })
  })

  it('未知网关模型保留管理员显式配置的 thinking.type', () => {
    const current = JSON.stringify({
      thinking: { type: 'vendor_managed', display: 'summarized' },
    })
    expect(syncAnthropicThinkingHardParams(current, 'vendor-claude-alias', true)).toBe(current)
  })
})
