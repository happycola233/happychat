import { describe, expect, it } from 'vitest'
import { joinBaseUrl } from './url'

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
