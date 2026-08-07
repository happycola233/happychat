import { describe, expect, it } from 'vitest'
import {
  migrateDefaultParamsFromAnthropic,
  migrateDefaultParamsToAnthropic,
  migrateHardParamsFromAnthropic,
  migrateHardParamsToAnthropic,
  modelKindForProviderProtocol,
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

  it('迁移到 Anthropic 时保留管理员自定义 thinking 模板', () => {
    const thinking = {
      type: 'vendor_managed',
      budget_tokens: 4096,
      display: 'omitted',
      gateway_option: true,
    }
    const migrated = JSON.parse(
      migrateHardParamsToAnthropic(JSON.stringify({ thinking }), 'vendor-claude-alias'),
    ) as Record<string, unknown>

    expect(migrated.thinking).toEqual(thinking)
  })

  it('从 Anthropic 切换到 Chat 时迁移旧 max_tokens 字段', () => {
    const migrated = JSON.parse(
      migrateHardParamsFromAnthropic(
        JSON.stringify({ max_tokens: 4096, custom_gateway_field: true }),
        'chat',
      ),
    ) as Record<string, unknown>

    expect(migrated).toMatchObject({
      max_completion_tokens: 4096,
      custom_gateway_field: true,
    })
    expect(migrated).not.toHaveProperty('max_tokens')
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
})
