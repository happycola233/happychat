import { describe, expect, it } from 'vitest'
import { requestOutcomePresentation } from './requestOutcome'

describe('requestOutcomePresentation', () => {
  it('把 refusal 和 content_filter 呈现为独立业务结果', () => {
    expect(
      requestOutcomePresentation({
        result: 'refused',
        terminalReason: 'refusal',
        kind: 'chat',
      }),
    ).toMatchObject({ label: '已拒绝', tone: 'warning', reasonLabel: '模型拒绝回答' })

    expect(
      requestOutcomePresentation({
        result: 'filtered',
        terminalReason: 'content_filter',
        kind: 'chat',
      }),
    ).toMatchObject({ label: '内容过滤', tone: 'warning', reasonLabel: '内容安全过滤' })
  })

  it('区分普通输出截断与上下文窗口截断', () => {
    const outputLimit = requestOutcomePresentation({
      result: 'incomplete',
      terminalReason: 'max_output_tokens',
      kind: 'chat',
    })
    const contextLimit = requestOutcomePresentation({
      result: 'incomplete',
      terminalReason: 'model_context_window_exceeded',
      kind: 'chat',
    })

    expect(outputLimit.label).toBe('已截断')
    expect(outputLimit.summary).toContain('输出限制')
    expect(contextLimit.summary).toContain('上下文窗口')
  })

  it('明确标题总结只记审计和成本、不占用户额度', () => {
    const presentation = requestOutcomePresentation({
      result: 'failed',
      terminalReason: 'network_error',
      kind: 'title',
    })

    expect(presentation.usageNote).toContain('不占用户额度')
    expect(presentation.nextStep).toContain('不单独生成错误事件')
    expect(presentation.contentNote).toContain('本地回退标题')
  })

  it('网络异常使用中性且准确的原因说明', () => {
    const presentation = requestOutcomePresentation({
      result: 'failed',
      terminalReason: 'network_error',
      kind: 'chat',
    })

    expect(presentation.reasonLabel).toBe('网络连接异常')
    expect(presentation.nextStep).toContain('错误日志')
  })
})
