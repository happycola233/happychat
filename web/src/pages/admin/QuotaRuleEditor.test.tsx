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
    providerId: 'p1',
    providerName: 'OpenAI',
    kind: 'responses',
    capabilities: {
      vision: false,
      file_input: false,
      web_search: false,
      x_search: false,
      image_generation: false,
      reasoning: false,
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
  it('底部实时给出中文摘要（与用户端同一份文案函数）', () => {
    expect(render(draft())).toContain('每月 · 全部模型 · $30.00')
  })

  it('「豁免」开关下不再渲染数值输入框，0 档豁免提示这条规则没有作用', () => {
    const html = render(draft({ unlimited: true }))
    expect(html).toContain('豁免（不限额）')
    expect(html).toContain('豁免不按周期统计，也不重置')
    expect(html).not.toContain('placeholder="10"')
    expect(html).not.toContain('每天（自然日）')
    expect(html).toContain('这条规则不产生任何限制')
  })

  it('高优先级豁免是有效配置：摘要标出优先级，不再提示无作用', () => {
    const html = render(draft({ unlimited: true, priorityInput: '10' }))
    expect(html).toContain('优先 10 · 全部模型 · 豁免（不限额）')
    expect(html).not.toContain('优先 10 · 每月 · 全部模型 · 豁免（不限额）')
    expect(html).not.toContain('这条规则不产生任何限制')
  })

  it('优先级非整数时摘要位置给出校验提示', () => {
    expect(render(draft({ priorityInput: '1.5' }))).toContain('优先级需为 0–99 之间的整数')
  })

  it('指定模型时渲染目标勾选列表与「各自独立 / 共享」切换', () => {
    const html = render(draft({ scopeType: 'models', targetIds: ['m1'] }))
    expect(html).toContain('GPT-5.5')
    expect(html).toContain('各自独立额度')
    expect(html).toContain('共享一个额度')
    expect(html).toContain('已选 1')
  })

  it('未选目标时摘要位置改为提示缺失项', () => {
    expect(render(draft({ scopeType: 'groups' }))).toContain('请选择至少一个分组')
  })

  it('分组范围列出分组及其模型数', () => {
    const html = render(draft({ scopeType: 'groups', targetIds: ['g1'] }))
    expect(html).toContain('Claude 系列')
    expect(html).toContain('2 个模型')
  })

  it('滚动窗口显示小时输入与预设档位', () => {
    const html = render(draft({ windowChoice: 'rolling', durationHoursInput: '5' }))
    expect(html).toContain('滚动窗口小时数')
    expect(html).toContain('5 小时')
    expect(html).toContain('7 天')
    expect(html).toContain('逐步释放')
  })

  it('首次请求起算周期明确说明固定周期语义', () => {
    const html = render(draft({ windowChoice: 'anchored', durationHoursInput: '5' }))
    expect(html).toContain('固定周期小时数')
    expect(html).toContain('类似 Codex、Claude Code')
    expect(html).toContain('首个请求启动整段周期')
    expect(html).toContain('空闲时不计时')
  })

  it('外层传入的错误信息优先于摘要显示', () => {
    expect(render(draft(), '第 1 条规则有问题')).toContain('第 1 条规则有问题')
  })

  it('请求次数口径显示「次」单位而不是美元符号', () => {
    const html = render(draft({ metric: 'requests', limitInput: '300' }))
    expect(html).toContain('300 次')
  })

  it('适用范围与计量都用分段控件，优先级用步进器', () => {
    const html = render(draft())
    expect(html).toContain('全部')
    expect(html).toContain('指定模型')
    expect(html).toContain('模型分组')
    expect(html).toContain('降低优先级')
    expect(html).toContain('提高优先级')
    expect(html).toContain('覆盖优先级')
  })
})
