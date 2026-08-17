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
  it('空列表说明零规则即无限额度，并提供添加入口', () => {
    const html = render([], { emptyUnlimited: true })
    expect(html).toContain('限额规则')
    expect(html).toContain('无限额度')
    expect(html).toContain('添加规则')
    expect(html).not.toContain('拖动调整')
  })

  it('只有一条时默认展开表单，不显示拖拽手柄', () => {
    const html = render([draft({ label: '日常上限' })])
    expect(html).toContain('日常上限')
    expect(html).toContain('$30.00')
    expect(html).toContain('规则备注')
    expect(html).toContain('每月 · 全部模型 · $30.00')
    expect(html).not.toContain('拖动调整')
  })

  it('多条时默认折叠，显示拖拽手柄与额度芯片', () => {
    const html = render([
      draft({ id: 'a', label: '月度金额' }),
      draft({
        id: 'b',
        label: '每日次数',
        metric: 'requests',
        limitInput: '300',
        windowChoice: 'day',
      }),
    ])
    expect(html).toContain('拖动调整「月度金额」的展示顺序')
    expect(html).toContain('拖动调整「每日次数」的展示顺序')
    expect(html).toContain('月度金额')
    expect(html).toContain('每日次数')
    expect(html).toContain('$30.00')
    expect(html).toContain('300 次')
    expect(html).not.toContain('规则备注')
  })

  it('存在多个优先档时提示遮蔽关系', () => {
    const html = render([
      draft({ id: 'a', priorityInput: '0' }),
      draft({ id: 'b', unlimited: true, priorityInput: '10', label: '豁免' }),
    ])
    expect(html).toContain('当前有 2 个优先档')
    expect(html).toContain('优先 10')
  })

  it('保存失败时展开对应规则并显示外层错误', () => {
    const html = render([draft({ id: 'a' }), draft({ id: 'b', limitInput: '' })], {
      invalidIndex: 1,
      invalidMessage: '请填写大于 0 的额度上限，或改为「不限」',
    })
    expect(html).toContain('请填写大于 0 的额度上限，或改为「不限」')
    expect(html).toContain('规则备注')
  })
})
