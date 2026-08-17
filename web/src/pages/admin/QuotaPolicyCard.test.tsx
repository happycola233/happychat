import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AdminQuotaPolicyDTO } from '@shared/types/api'
import type { QuotaRule } from '@shared/types/domain'
import { QuotaPolicyCard } from './QuotaPolicyCard'

const rule = (patch: Partial<QuotaRule> & Pick<QuotaRule, 'id'>): QuotaRule => ({
  label: null,
  scope: { type: 'all' },
  metric: 'cost',
  limit: { kind: 'amount', value: 4 },
  window: { type: 'anchored', hours: 5 },
  priority: 0,
  ...patch,
})

const policy = (patch: Partial<AdminQuotaPolicyDTO> = {}): AdminQuotaPolicyDTO => ({
  id: 'p1',
  name: 'Plus',
  description: '默认档',
  rules: [
    rule({
      id: 'r1',
      label: 'OpenAI（5 小时）',
      scope: { type: 'groups', groupIds: ['missing'], mode: 'each' },
    }),
    rule({
      id: 'r2',
      label: 'GPT-5.4 mini',
      limit: { kind: 'unlimited' },
      window: { type: 'total' },
      priority: 1,
      scope: { type: 'models', modelIds: ['m1'], mode: 'each' },
    }),
  ],
  isDefault: true,
  sort: 100,
  createdAt: 0,
  updatedAt: 0,
  boundUserCount: 10,
  ...patch,
})

const render = (row: AdminQuotaPolicyDTO) =>
  renderToStaticMarkup(
    <QuotaPolicyCard
      policy={row}
      onEdit={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
      onSetDefault={vi.fn()}
    />,
  )

describe('QuotaPolicyCard', () => {
  it('用折叠行同款摘要展示规则，不把整句塞进换行 chip', () => {
    const html = render(policy())
    expect(html).toContain('Plus')
    expect(html).toContain('默认')
    expect(html).toContain('OpenAI（5 小时）')
    expect(html).toContain('$4.00')
    expect(html).toContain('起算 5 小时')
    expect(html).toContain('1 个分组 · 消费金额 · 各自独立')
    expect(html).toContain('优先 1')
    expect(html).toContain('豁免')
    expect(html).not.toContain('豁免 · 永久')
    expect(html).toContain('10 位用户使用中')
    expect(html).not.toContain('未知分组')
    expect(html).not.toContain('首次请求起 5 小时')
  })

  it('零规则策略明确写成无限额度', () => {
    const html = render(policy({ rules: [], isDefault: false, boundUserCount: 0 }))
    expect(html).toContain('无限额度')
    expect(html).toContain('设为默认策略')
    expect(html).not.toContain('优先')
  })
})
