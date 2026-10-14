import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RunRetrySummary } from '@shared/types/retry'
import { RetryAuditDetails, RetryAuditBadge } from './RetryAuditDetails'

const summary: RunRetrySummary = {
  attempts: 2,
  outcome: 'completed',
  failures: [
    {
      attempt: 1,
      stage: 'before_output',
      requestStartedAt: 0,
      failedAt: 1000,
      retriedAt: 6000,
      errorType: 'response_error',
      errorCode: 'server_is_overloaded',
      httpStatus: 200,
      message: '服务繁忙',
      nextRetryAt: 6000,
      stopReason: null,
    },
  ],
}
describe('重试审计展示', () => {
  it('进行中的错误不显示为最终失败或成功恢复，第一次等待也能辨识', () => {
    const pending = renderToStaticMarkup(
      <RetryAuditBadge summary={{ ...summary, attempts: 1, outcome: 'running' }} />,
    )
    expect(pending).toContain('等待重试')
    expect(pending).not.toContain('未重试')
    const retrying = renderToStaticMarkup(
      <RetryAuditBadge summary={{ ...summary, outcome: 'running' }} />,
    )
    expect(retrying).toContain('处理中 · 已重试 1 次')
    expect(retrying).not.toContain('后恢复')
  })
  it('恢复结果与流内错误同时可见，不把 HTTP 200 当作成功生成', () => {
    const html = renderToStaticMarkup(
      <>
        <RetryAuditBadge summary={summary} />
        <RetryAuditDetails summary={summary} />
      </>,
    )
    expect(html).toContain('重试 1 次后恢复')
    expect(html).toContain('已连接，尚未输出')
    expect(html).toContain('server_is_overloaded')
    expect(html).toContain('HTTP 200')
    expect(html).toContain('响应中报错')
    expect(html).toContain('持续 1秒后失败')
    expect(html).toContain('开始')
    expect(html).toContain('失败')
    expect(html).toContain('等待 5秒后重试')
    expect(html).not.toContain('计划等待')
  })
  it('分别展示单次请求耗时和实际重试等待，不把两段时间混在一起', () => {
    const html = renderToStaticMarkup(
      <RetryAuditDetails
        summary={{
          ...summary,
          failures: [
            {
              ...summary.failures[0]!,
              requestStartedAt: 1000,
              failedAt: 13750,
              nextRetryAt: 18750,
              retriedAt: 19000,
            },
          ],
        }}
      />,
    )
    expect(html).toContain('持续 12.75秒后失败')
    expect(html).toContain('等待 5.25秒后重试')
    expect(html).not.toContain('持续 18秒后失败')
  })
  it('尚未开始下一次请求时标明计划等待，旧记录不伪造请求耗时', () => {
    const html = renderToStaticMarkup(
      <RetryAuditDetails
        summary={{
          ...summary,
          outcome: 'running',
          attempts: 1,
          failures: [
            {
              ...summary.failures[0]!,
              requestStartedAt: undefined,
              retriedAt: undefined,
            },
          ],
        }}
      />,
    )
    expect(html).toContain('计划等待 5秒后重试')
    expect(html).toContain('请求耗时未记录')
    expect(html).not.toContain('持续 0秒后失败')
  })
  it('输出中断且次数耗尽展示明确原因', () => {
    const html = renderToStaticMarkup(
      <RetryAuditDetails
        summary={{
          ...summary,
          outcome: 'failed',
          failures: [
            {
              ...summary.failures[0]!,
              stage: 'after_output',
              nextRetryAt: null,
              stopReason: 'attempts_exhausted',
            },
          ],
        }}
      />,
    )
    expect(html).toContain('输出中断')
    expect(html).toContain('已达到重试次数上限')
    expect(html).not.toContain('后恢复')
  })
})
