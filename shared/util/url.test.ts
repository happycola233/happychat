import { describe, expect, it } from 'vitest'
import { joinAnthropicUrl, joinBaseUrl } from './url'

describe('joinBaseUrl', () => {
  it('拼接时不丢失 /v1', () => {
    expect(joinBaseUrl('https://host/llm/v1', '/responses')).toBe('https://host/llm/v1/responses')
  })
  it('处理 base 末尾斜杠', () => {
    expect(joinBaseUrl('https://host/llm/v1/', '/models')).toBe('https://host/llm/v1/models')
  })
  it('处理 path 缺少前导斜杠', () => {
    expect(joinBaseUrl('https://host/llm/v1', 'models')).toBe('https://host/llm/v1/models')
  })
})

describe('joinAnthropicUrl', () => {
  it('为官方根地址补 /v1', () => {
    expect(joinAnthropicUrl('https://api.anthropic.com', '/v1/messages')).toBe(
      'https://api.anthropic.com/v1/messages',
    )
  })

  it('不会给已含 /v1 的网关地址重复追加版本段', () => {
    expect(joinAnthropicUrl('https://gateway.example.com/anthropic/v1/', '/v1/models')).toBe(
      'https://gateway.example.com/anthropic/v1/models',
    )
  })
})
