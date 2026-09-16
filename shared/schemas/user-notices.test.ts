import { describe, expect, it } from 'vitest'
import {
  contextOptimizationSuggestionSchema,
  DEFAULT_CONTEXT_OPTIMIZATION_SUGGESTION,
  DEFAULT_MODEL_USAGE_NOTICE,
  modelUsageNoticeSchema,
} from './user-notices'

describe('使用提示的配置边界', () => {
  it('上下文提醒默认在 100K 时开启', () => {
    expect(DEFAULT_CONTEXT_OPTIMIZATION_SUGGESTION).toEqual({
      enabled: true,
      tokenThreshold: 100000,
    })
  })

  it('关闭模型提示可保留空草稿，启用后正文必须可读', () => {
    expect(modelUsageNoticeSchema.safeParse(DEFAULT_MODEL_USAGE_NOTICE).success).toBe(true)
    expect(
      modelUsageNoticeSchema.safeParse({ ...DEFAULT_MODEL_USAGE_NOTICE, enabled: true, body: '  ' })
        .success,
    ).toBe(false)
    expect(
      modelUsageNoticeSchema.parse({
        ...DEFAULT_MODEL_USAGE_NOTICE,
        enabled: true,
        body: ' 注意事项 ',
      }).body,
    ).toBe('注意事项')
  })

  it.each([999, 0, -1, 1000.5, 2_000_001])('拒绝无效上下文阈值 %s', (tokenThreshold) => {
    expect(
      contextOptimizationSuggestionSchema.safeParse({ enabled: true, tokenThreshold }).success,
    ).toBe(false)
  })
})
