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
      failedAt: 1000,
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
    expect(html).toContain('等待 5 秒后重试')
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
