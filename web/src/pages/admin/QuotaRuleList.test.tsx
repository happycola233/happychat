import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AdminModelDTO, AdminModelGroupDTO } from '@shared/types/api'
import { QuotaRuleList } from './QuotaRuleList'
import { createQuotaRuleDraft, type QuotaRuleDraft } from './quotaRuleDrafts'

const models: AdminModelDTO[] = []
const groups: AdminModelGroupDTO[] = []

const draft = (patch: Partial<QuotaRuleDraft> = {}): QuotaRuleDraft => ({
  ...createQuotaRuleDraft(),
  limitInput: '30',
  ...patch,
})

const render = (
  drafts: QuotaRuleDraft[],
  extra: Partial<{
    invalidIndex: number | null
    invalidMessage: string
    emptyUnlimited: boolean
  }> = {},
) =>
  renderToStaticMarkup(
    <QuotaRuleList
      title="限额规则"
      description="仅用户发起的对话与生图计入，标题总结不计入任何额度规则。"
      emptyMessage={
        <>
          没有任何规则 = <span>无限额度</span>
        </>
      }
      drafts={drafts}
      onChange={vi.fn()}
      models={models}
      groups={groups}
      invalidIndex={extra.invalidIndex}
      invalidMessage={extra.invalidMessage}
      emptyUnlimited={extra.emptyUnlimited}
    />,
  )

describe('QuotaRuleList', () => {
  it('空列表说明零规则即不限额，点击即可添加', () => {
    const html = render([], { emptyUnlimited: true })
    expect(html).toContain('无限额度')
    expect(html).toContain('添加规则')
  })

  it('左侧列出规则，右侧直接编辑第一条；只有一条时不显示拖拽手柄', () => {
    const html = render([draft({ id: 'a', label: '每月额度' })])
    expect(html).toContain('每月额度')
    expect(html).toContain('第 1 条规则')
    expect(html).toContain('限制什么')
    expect(html).not.toContain('拖动调整')
  })

  it('多条时显示拖拽手柄、额度短称与优先级', () => {
    const html = render([
      draft({ id: 'a', label: '每月' }),
      draft({
        id: 'b',
        unlimited: true,
        priorityInput: '10',
        label: '免费模型',
        metric: 'chat_cost',
      }),
    ])
    expect(html).toContain('拖动调整「每月」的展示顺序')
    expect(html).toContain('$30.00')
    expect(html).toContain('豁免文字')
    expect(html).toContain('优先 10')
  })

  it('保存失败时直接编辑出错的规则并显示外层错误', () => {
    const html = render([draft({ id: 'a', label: '正常' }), draft({ id: 'b', label: '出错' })], {
      invalidIndex: 1,
      invalidMessage: '请选择至少一个模型',
    })
    expect(html).toContain('第 2 条规则')
    expect(html).toContain('请选择至少一个模型')
    expect(html).toContain('aria-label="有问题"')
  })
})
