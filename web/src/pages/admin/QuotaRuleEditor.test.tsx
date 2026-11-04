import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AdminModelDTO, AdminModelGroupDTO } from '@shared/types/api'
import { QuotaRuleEditor } from './QuotaRuleEditor'
import { createQuotaRuleDraft, type QuotaRuleDraft } from './quotaRuleDrafts'

const model = (id: string, displayName: string): AdminModelDTO =>
  ({
    id,
    modelId: `upstream-${id}`,
    displayName,
    routes: [],
    kind: 'responses',
    capabilities: {
      vision: false,
      file_input: false,
      web_search: false,
      x_search: false,
      image_generation: false,
      reasoning: false,
      artifacts: false,
    },
    description: null,
    tags: [],
    icon: null,
    groupId: null,
    allowedEfforts: [],
    defaultEffort: null,
    defaultWebSearch: false,
    defaultXSearch: false,
    defaultParams: null,
    enabled: true,
    accessMode: 'all',
    allowedUserCount: 0,
    defaultSystemPrompt: null,
    replayProviderContext: false,
    hardParams: null,
    pricing: null,
    sort: 100,
  }) as AdminModelDTO

const group = (id: string, name: string): AdminModelGroupDTO => ({
  id,
  name,
  icon: null,
  color: null,
  sort: 100,
  modelCount: 2,
  createdAt: 0,
  updatedAt: 0,
})

const render = (draft: QuotaRuleDraft, invalidMessage?: string) =>
  renderToStaticMarkup(
    <QuotaRuleEditor
      draft={draft}
      models={[model('m1', 'GPT-5.5'), model('m2', 'Claude')]}
      groups={[group('g1', 'Claude 系列')]}
      onChange={vi.fn()}
      invalidMessage={invalidMessage}
    />,
  )

const draft = (patch: Partial<QuotaRuleDraft> = {}): QuotaRuleDraft => ({
  ...createQuotaRuleDraft(),
  limitInput: '30',
  ...patch,
})

describe('QuotaRuleEditor', () => {
  it('底部实时给出中文摘要', () => {
    expect(render(draft())).toContain('每月 · 全部模型 · $30.00')
  })

  it('限额按「类型 → 适用于 → 限制什么 → 上限 / 周期 → 优先级」排列', () => {
    const html = render(draft())
    const order = ['类型', '适用于', '限制什么', '上限', '周期', '优先级'].map((label) =>
      html.indexOf(`>${label}<`),
    )
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toContain('文字和生图一起算，用完后不能使用')
  })

  it('豁免只问放行哪部分用量，不再显示上限和周期；0 档豁免提示不会起作用', () => {
    const html = render(draft({ unlimited: true, priorityInput: '0' }))
    expect(html).toContain('豁免什么')
    expect(html).toContain('只豁免文字')
    expect(html).not.toContain('aria-label="额度上限"')
    expect(html).not.toContain('>周期<')
    expect(html).toContain('这条豁免不会起作用')
  })

  it('只豁免文字时说明生图仍按其他规则计算', () => {
    const html = render(draft({ unlimited: true, metric: 'chat_cost', priorityInput: '1' }))
    expect(html).toContain('文字不受限，生图仍按其他规则计算。')
    expect(html).toContain('优先 1 · 全部模型 · 豁免文字')
  })

  it('优先级非整数时摘要位置给出校验提示', () => {
    expect(render(draft({ priorityInput: '1.5' }))).toContain('优先级需为 0–99 之间的整数')
  })

  it('指定模型时渲染可搜索的勾选列表；多选后才出现「各自独立 / 共享」', () => {
    const one = render(draft({ scopeType: 'models', targetIds: ['m1'] }))
    expect(one).toContain('搜索模型')
    expect(one).toContain('GPT-5.5')
    expect(one).not.toContain('共享一份')
    const two = render(draft({ scopeType: 'models', targetIds: ['m1', 'm2'] }))
    expect(two).toContain('每个模型各自独立')
    expect(two).toContain('所选模型共享一份')
  })

  it('未选目标时摘要位置改为提示缺失项', () => {
    expect(render(draft({ scopeType: 'models' }))).toContain('请选择至少一个模型')
  })

  it('分组范围列出分组及其模型数', () => {
    const html = render(draft({ scopeType: 'groups' }))
    expect(html).toContain('Claude 系列')
    expect(html).toContain('2 个模型')
  })

  it('滚动窗口与首次请求起算显示小时输入与说明', () => {
    expect(render(draft({ windowChoice: 'rolling', durationHoursInput: '5' }))).toContain(
      '始终统计最近这段时间',
    )
    expect(render(draft({ windowChoice: 'anchored', durationHoursInput: '24' }))).toContain(
      '首次请求开始计时，到期一次性清零',
    )
  })

  it('外层传入的错误信息优先于摘要显示', () => {
    expect(render(draft(), '保存失败的原因')).toContain('保存失败的原因')
  })

  it('请求次数口径显示「次」单位，金额口径可切换币种', () => {
    const requests = render(draft({ metric: 'requests' }))
    expect(requests).toContain('次</span>')
    expect(requests).not.toContain('人民币')
    expect(render(draft())).toContain('人民币')
  })
})
