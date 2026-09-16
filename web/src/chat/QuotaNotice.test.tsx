import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyQuotaDTO, QuotaBucketUsageDTO } from '@shared/types/api'
import { quotaWarningDismissKey } from './quotaNoticeDismissal'

const quotaState: { data: MyQuotaDTO | undefined } = { data: undefined }

vi.mock('../hooks/useQuota', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useQuota')>('../hooks/useQuota')
  return { ...actual, useMyQuota: () => quotaState }
})

vi.mock('../store/chat', () => ({
  useChatPrefs: (selector: (state: { activeModelId: string | null }) => unknown) =>
    selector({ activeModelId: 'm1' }),
}))

const { QuotaNotice } = await import('./QuotaNotice')

const bucket = (patch: Partial<QuotaBucketUsageDTO> = {}): QuotaBucketUsageDTO => ({
  ruleId: 'r-1',
  bucketKey: null,
  bucketLabel: null,
  targetLabels: null,
  effectiveModelIds: null,
  label: null,
  source: 'policy',
  scope: { type: 'all' },
  metric: 'cost',
  window: { type: 'calendar', period: 'month' },
  limit: { kind: 'amount', value: 10 },
  priority: 0,
  used: 9,
  granted: 0,
  effectiveLimit: 10,
  remaining: 1,
  percent: 0.9,
  blocked: false,
  periodActive: true,
  periodStart: Date.parse('2026-03-01T00:00:00Z'),
  usageStart: Date.parse('2026-03-01T00:00:00Z'),
  periodEnd: Date.parse('2026-04-01T00:00:00Z'),
  grants: [],
  invalid: false,
  shadowed: false,
  ...patch,
})

const quota = (patch: Partial<MyQuotaDTO> = {}): MyQuotaDTO => ({
  enabled: true,
  paused: false,
  unlimited: false,
  allModelsBlocked: false,
  policyName: '默认用户',
  warnThreshold: 0.8,
  rules: [bucket()],
  blockedModelIds: [],
  ...patch,
})

const render = () =>
  renderToStaticMarkup(
    <MemoryRouter>
      <QuotaNotice />
    </MemoryRouter>,
  )

beforeEach(() => {
  quotaState.data = undefined
  // 测试环境是 node（没有 sessionStorage）：组件内的读写都在 try/catch 里，
  // 因此这里既验证了「存储不可用时仍正常渲染」，也不需要额外的 DOM 桩。
})

describe('QuotaNotice', () => {
  it('未开启限额时什么都不渲染', () => {
    quotaState.data = quota({ enabled: false })
    expect(render()).toBe('')
  })

  it('额度充足时保持安静', () => {
    quotaState.data = quota({ rules: [bucket({ used: 2, percent: 0.2 })] })
    expect(render()).toBe('')
  })

  it('接近上限时展示标题、用量、窗口与重置，并提供关闭按钮', () => {
    quotaState.data = quota()
    const html = render()
    expect(html).toContain('额度即将用尽')
    expect(html).toContain('$9.00')
    expect(html).toContain('$10.00')
    expect(html).toContain('每月消费')
    expect(html).toContain('重置')
    expect(html).toContain('暂不提示')
    expect(html).toContain('width:90%')
  })

  it('已耗尽时用 alert 角色且不可关闭', () => {
    quotaState.data = quota({
      rules: [bucket({ used: 10, percent: 1, blocked: true, remaining: 0 })],
      blockedModelIds: ['m1'],
      allModelsBlocked: true,
    })
    const html = render()
    expect(html).toContain('role="alert"')
    expect(html).toContain('额度已用尽')
    expect(html).not.toContain('暂不提示')
  })

  it('按模型的独立额度耗尽时提示可切换模型', () => {
    quotaState.data = quota({
      rules: [
        bucket({
          scope: { type: 'models', modelIds: ['m1'], mode: 'each' },
          bucketKey: 'm1',
          bucketLabel: 'GPT-5.5',
          used: 10,
          percent: 1,
          blocked: true,
        }),
      ],
      blockedModelIds: ['m1'],
    })
    const html = render()
    expect(html).toContain('当前模型额度已用尽')
    expect(html).toContain('GPT-5.5')
    expect(html).toContain('可切换模型')
  })

  it('暂停限额时说明仍可使用，并提供关闭按钮', () => {
    quotaState.data = quota({
      paused: true,
      rules: [bucket({ used: 15, percent: 1.5, blocked: true })],
    })
    const html = render()
    expect(html).toContain('限额已暂停')
    expect(html).toContain('仍可使用')
    expect(html).toContain('暂不提示')
    expect(html).not.toContain('role="alert"')
  })

  it('提供「使用情况」入口', () => {
    quotaState.data = quota()
    expect(render()).toContain('href="/usage"')
  })

  it('分别展示接近限额与已达限额的管理员文案', () => {
    quotaState.data = quota({
      warningMessage: '如需增加额度，请联系站点管理员。',
      exhaustedMessage: '测试额度已耗尽',
    })
    expect(render()).toContain('如需增加额度，请联系站点管理员。')
    expect(render()).not.toContain('测试额度已耗尽')
    quotaState.data = quota({
      warningMessage: '自定义预警',
      exhaustedMessage: '测试额度已耗尽',
      rules: [bucket({ blocked: true, percent: 1 })],
      blockedModelIds: ['m1'],
      allModelsBlocked: true,
    })
    expect(render()).not.toContain('自定义预警')
    expect(render()).toContain('测试额度已耗尽')
  })

  it.each([undefined, null, '', '  '])(
    '提示文案为空 %s 时不添加正文，额度状态仍可见',
    (message) => {
      quotaState.data = quota({ warningMessage: message })
      const warning = render()
      expect(warning).toContain('额度即将用尽')
      expect(warning).not.toContain('whitespace-pre-wrap')
      quotaState.data = quota({
        exhaustedMessage: message,
        rules: [bucket({ blocked: true, percent: 1 })],
        blockedModelIds: ['m1'],
        allModelsBlocked: true,
      })
      const exhausted = render()
      expect(exhausted).toContain('额度已用尽')
      expect(exhausted).toContain('使用情况')
      expect(exhausted).toContain('重置')
      expect(exhausted).not.toContain('whitespace-pre-wrap')
    },
  )

  it('模型额度耗尽同样展示对应的自定义提示', () => {
    quotaState.data = quota({
      exhaustedMessage: '当前模型的测试提示',
      rules: [bucket({ blocked: true, percent: 1 })],
      blockedModelIds: ['m1'],
    })
    expect(render()).toContain('当前模型的测试提示')
  })

  it('滚动窗口关闭键不使用不断移动的 periodStart', () => {
    const first = bucket({ window: { type: 'rolling', hours: 5 }, periodStart: 100 })
    const refreshed = bucket({ window: { type: 'rolling', hours: 5 }, periodStart: 200 })
    expect(quotaWarningDismissKey(first)).toBe(quotaWarningDismissKey(refreshed))

    const anchored = bucket({ window: { type: 'anchored', hours: 5 }, periodStart: 100 })
    expect(quotaWarningDismissKey(anchored)).not.toBe(
      quotaWarningDismissKey({ ...anchored, periodStart: 200 }),
    )
  })
})
