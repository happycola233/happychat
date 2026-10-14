import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { ActiveRequestDTO } from '@shared/types/api'
import { ActiveRequestsPanel } from './ActiveRequestsPanel'

const row: ActiveRequestDTO = {
  runId: 'test-run',
  userId: 'test-user',
  username: '测试用户',
  modelLabel: 'test-model',
  modelDisplayName: '测试模型',
  providerLabel: '测试供应商',
  reasoningEffort: 'high',
  createdAt: 1000,
  startedAt: 2000,
  progress: {
    phase: 'retry_wait',
    attempt: 1,
    maxAttempts: 3,
    requestStartedAt: 2000,
    updatedAt: 7000,
    nextRetryAt: 12000,
    upstreamResponseLatencyMs: 1000,
    modelLabel: 'test-model',
    modelDisplayName: '测试模型',
    providerId: 'test-provider',
    providerLabel: '测试供应商',
  },
  retrySummary: {
    attempts: 1,
    outcome: 'running',
    failures: [
      {
        attempt: 1,
        stage: 'after_output',
        requestStartedAt: 2000,
        failedAt: 7000,
        errorType: 'server_error',
        errorCode: 'server_error',
        httpStatus: 200,
        message: '输出暂时中断',
        nextRetryAt: 12000,
        stopReason: null,
      },
    ],
  },
}
function render(active: ActiveRequestDTO, now = 10000) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ActiveRequestsPanel
        data={{
          items: [active],
          total: 1,
          page: 1,
          pageSize: 10,
          observedAt: now,
        }}
        onPage={() => {}}
      />
    </MemoryRouter>,
  )
}

describe('进行中的请求展示', () => {
  it('显示真实阶段、耗时、重试倒计时和 HTTP 200 中断原因，不伪造 Token 或成本', () => {
    const html = render(row)
    for (const value of [
      '等待重试',
      '2 秒后重试',
      '第 1 / 3 次请求',
      '已用时 8秒',
      '输出暂时中断',
      '持续 5秒后失败',
      'HTTP 200',
      '响应中报错',
      'server_error',
    ])
      expect(html).toContain(value)
    expect(html).not.toContain('后恢复')
    expect(html).not.toContain('$0')
  })
  it('等待时间到达后不产生负数，也不会宣称请求已恢复', () => {
    const html = render(row, 15000)
    expect(html).toContain('即将重试')
    expect(html).not.toContain('-3 秒')
    expect(html).not.toContain('生成中')
  })
  it('排队与新尝试尚未输出不会被当成正在生成', () => {
    expect(render({ ...row, progress: null, retrySummary: null })).toContain('等待开始')
    const html = render({
      ...row,
      progress: {
        ...row.progress!,
        phase: 'waiting_output',
        attempt: 2,
        nextRetryAt: null,
        requestStartedAt: 8000,
      },
    })
    expect(html).toContain('等待输出')
    expect(html).toContain('本次请求已用时 2秒')
    expect(html).toContain('已用时 8秒')
    expect(html).not.toContain('秒后重试</span>')
  })
})
