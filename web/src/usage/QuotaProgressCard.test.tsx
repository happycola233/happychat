import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MyQuotaDTO, QuotaBucketUsageDTO } from '@shared/types/api'
import { QuotaProgressCard } from './QuotaProgressCard'

const bucket = (patch: Partial<QuotaBucketUsageDTO> = {}): QuotaBucketUsageDTO => ({
  ruleId: 'rule-all',
  bucketKey: null,
  bucketLabel: null,
  targetLabels: null,
  effectiveModelIds: null,
  label: null,
  source: 'policy',
  scope: { type: 'all' },
  metric: 'cost',
  window: { type: 'calendar', period: 'month' },
  limit: { kind: 'amount', value: 160 },
  priority: 0,
  used: 0.177,
  granted: 0,
  effectiveLimit: 160,
  remaining: 159.823,
  percent: 0.177 / 160,
  blocked: false,
  periodActive: true,
  periodStart: 0,
  usageStart: 0,
  periodEnd: 86_400_000,
  grants: [],
  invalid: false,
  shadowed: false,
  ...patch,
})

const quota = (rules: QuotaBucketUsageDTO[]): MyQuotaDTO => ({
  enabled: true,
  paused: false,
  unlimited: false,
  allModelsBlocked: false,
  policyName: 'Pro',
  warnThreshold: 0.8,
  blockedModelIds: [],
  rules,
})

describe('QuotaProgressCard', () => {
  it('全模型规则被部分接管后展示实际范围', () => {
    const html = renderToStaticMarkup(
      <QuotaProgressCard
        quota={quota([
          bucket({
            metric: 'requests',
            window: { type: 'calendar', period: 'day' },
            limit: { kind: 'amount', value: 10 },
            used: 1,
            effectiveLimit: 10,
            remaining: 9,
            percent: 0.1,
            effectiveModelIds: ['model-limited'],
          }),
        ])}
      />,
    )
    expect(html).toContain('每天请求 · 部分模型')
    expect(html).not.toContain('每天请求 · 全部模型')
  })

  it('按策略展示顺序排列，并把各自独立的目标收在同一条下', () => {
    const html = renderToStaticMarkup(
      <QuotaProgressCard
        quota={quota([
          bucket({ ruleId: 'r-month', label: 'OpenAI（每月）' }),
          bucket({
            ruleId: 'r-each',
            label: '其他模型（每周）',
            bucketKey: 'grok',
            bucketLabel: 'Grok',
            scope: { type: 'models', modelIds: ['grok', 'ds'], mode: 'each' },
            window: { type: 'calendar', period: 'week' },
            used: 0,
            effectiveLimit: 0.5,
            remaining: 0.5,
            percent: 0,
          }),
          bucket({
            ruleId: 'r-each',
            label: '其他模型（每周）',
            bucketKey: 'ds',
            bucketLabel: 'DeepSeek',
            scope: { type: 'models', modelIds: ['grok', 'ds'], mode: 'each' },
            window: { type: 'calendar', period: 'week' },
            used: 0,
            effectiveLimit: 0.5,
            remaining: 0.5,
            percent: 0,
          }),
        ])}
      />,
    )
    expect(html).toContain('OpenAI（每月）')
    expect(html).toContain('其他模型（每周）')
    expect(html).toContain('Grok')
    expect(html).toContain('DeepSeek')
    expect(html).not.toContain('各自独立')
    expect(html).not.toContain('每项')
    expect(html).not.toContain('border-l')
    expect(html.indexOf('OpenAI（每月）')).toBeLessThan(html.indexOf('其他模型（每周）'))
    expect(html.indexOf('其他模型（每周）')).toBeLessThan(html.indexOf('Grok'))
    expect(html.indexOf('Grok')).toBeLessThan(html.indexOf('DeepSeek'))
  })

  it('豁免规则不展示统计周期或重置说明', () => {
    const html = renderToStaticMarkup(
      <QuotaProgressCard
        quota={quota([
          bucket({
            ruleId: 'r-exempt',
            label: 'mini 豁免',
            limit: { kind: 'unlimited' },
            effectiveLimit: null,
            remaining: null,
            percent: null,
            window: { type: 'calendar', period: 'month' },
          }),
        ])}
      />,
    )
    expect(html).toContain('mini 豁免')
    expect(html).toContain('无限额度')
    expect(html).not.toContain('每月消费')
    expect(html).not.toContain('永久累计，不会重置')
    expect(html).not.toContain('重置')
  })

  it('固定边界的重置时刻用相对时间芯片紧跟窗口说明，不靠右对齐', () => {
    const html = renderToStaticMarkup(
      <QuotaProgressCard
        quota={quota([
          bucket({
            label: 'OpenAI（每周）',
            window: { type: 'anchored', hours: 168 },
            periodEnd: Date.now() + 4 * 86_400_000 + 2 * 3_600_000,
          }),
        ])}
      />,
    )
    expect(html).toContain('4 天后重置')
    expect(html).toContain('首次请求起 7 天消费')
    expect(html.indexOf('首次请求起 7 天消费')).toBeLessThan(html.indexOf('4 天后重置'))
    expect(html).not.toContain('首次请求后开始计时')
  })

  it('尚未启动的固定周期标明首次请求后开始，不伪造重置时刻', () => {
    const html = renderToStaticMarkup(
      <QuotaProgressCard
        quota={quota([
          bucket({
            label: 'OpenAI（5 小时）',
            window: { type: 'anchored', hours: 5 },
            periodActive: false,
            periodStart: 0,
            usageStart: 0,
            periodEnd: null,
            used: 0,
            remaining: 16,
            percent: 0,
          }),
        ])}
      />,
    )
    expect(html).toContain('首次请求后开始')
    expect(html).not.toContain('重置')
  })

  it('共享额度在进度条上方列出池内模型', () => {
    const html = renderToStaticMarkup(
      <QuotaProgressCard
        quota={quota([
          bucket({
            label: '其他模型（每周）',
            scope: { type: 'models', modelIds: ['grok', 'ds'], mode: 'shared' },
            window: { type: 'calendar', period: 'week' },
            targetLabels: ['Grok', 'DeepSeek'],
            effectiveModelIds: ['grok', 'ds'],
            used: 0,
            effectiveLimit: 0.5,
            remaining: 0.5,
            percent: 0,
          }),
        ])}
      />,
    )
    expect(html).toContain('其他模型（每周）')
    expect(html).toContain('Grok、DeepSeek')
    expect(html).toContain('title="Grok、DeepSeek"')
    expect(html).toContain('$0')
    expect(html).toContain('$0.500')
    expect(html).not.toContain('各自独立')
  })
})
