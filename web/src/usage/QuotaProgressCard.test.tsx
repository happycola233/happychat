import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MyQuotaDTO } from '@shared/types/api'
import { QuotaProgressCard } from './QuotaProgressCard'

describe('QuotaProgressCard', () => {
  it('全模型规则被部分接管后展示实际范围', () => {
    const quota: MyQuotaDTO = {
      enabled: true,
      paused: false,
      unlimited: false,
      allModelsBlocked: false,
      policyName: '默认策略',
      warnThreshold: 0.8,
      blockedModelIds: [],
      rules: [
        {
          ruleId: 'rule-all',
          bucketKey: null,
          bucketLabel: null,
          effectiveModelIds: ['model-limited'],
          label: null,
          source: 'policy',
          scope: { type: 'all' },
          metric: 'requests',
          window: { type: 'calendar', period: 'day' },
          limit: { kind: 'amount', value: 10 },
          priority: 0,
          used: 1,
          granted: 0,
          effectiveLimit: 10,
          remaining: 9,
          percent: 0.1,
          blocked: false,
          periodActive: true,
          periodStart: 0,
          usageStart: 0,
          periodEnd: 86_400_000,
          grants: [],
          invalid: false,
          shadowed: false,
        },
      ],
    }

    const html = renderToStaticMarkup(<QuotaProgressCard quota={quota} />)
    expect(html).toContain('每天请求 · 部分模型')
    expect(html).not.toContain('每天请求 · 全部模型')
  })
})
