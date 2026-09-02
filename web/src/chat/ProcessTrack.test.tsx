import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { liveStepsFromPersisted, type LiveProcessStep } from '../sse/eventReducer'
import { ProcessTrack } from './ProcessTrack'
import { SearchStepContent } from './SearchStep'

const reasoningStep = (text: string): LiveProcessStep => ({
  kind: 'reasoning',
  id: 'reasoning-1',
  text,
  partKey: null,
})

describe('ProcessTrack', () => {
  it('把 reasoning 小节平铺到统一时间线并保留完成页脚', () => {
    const html = renderToStaticMarkup(
      <ProcessTrack
        steps={[reasoningStep('**分析 edge cases**\n\n- item\n\n`code`')]}
        status="completed"
        startedAt={null}
        durationMs={3500}
        reasoningEnabled
        answerStarted
      />,
    )

    expect(html).toContain('分析 edge cases')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('已思考 3s')
    expect(html).toContain('reasoning-summary-footer')
    expect(html).toContain('space-y-2 pt-2 pr-2 pb-1')
    expect(html).not.toContain('hc-stream-seg')
  })

  it('进行中为 reasoning 标题和正文保留渐入动效', () => {
    const html = renderToStaticMarkup(
      <ProcessTrack
        steps={[reasoningStep('**分析 edge cases**\n\nbody')]}
        status="working"
        startedAt={1000}
        reasoningEnabled
        answerStarted={false}
      />,
    )

    expect(html).toMatch(/animation-delay:0ms">分<\/span>/)
    expect(html).toMatch(/animation-delay:24ms">析<\/span>/)
    expect(html).toContain('hc-reasoning-dot-in')
    expect(html).toContain('hc-reasoning-shimmer')
  })

  it('把 commentary 渲染为层级独立的消息步骤', () => {
    const html = renderToStaticMarkup(
      <ProcessTrack
        steps={[{ kind: 'commentary', id: 'commentary-1', text: '我正在核对官方文档。' }]}
        status="working"
        startedAt={1000}
        reasoningEnabled={false}
        answerStarted={false}
      />,
    )

    expect(html).toContain('data-testid="commentary-step"')
    expect(html).toContain('hc-process-commentary')
    expect(html).toContain('M16.279 13.793')
    expect(html).toContain('>我</span>')
    expect(html).toContain('>。</span>')
    expect(html).not.toContain('正在思考')
  })

  it('纯检索轮复用搜索步骤、汇总和来源图标', () => {
    const steps = liveStepsFromPersisted([
      { kind: 'search', action: { type: 'search', queries: ['react 19', 'vite 7'] } },
      { kind: 'search', action: { type: 'open_page', url: 'https://react.dev/blog' } },
    ])
    const html = renderToStaticMarkup(
      <ProcessTrack
        steps={steps}
        status="completed"
        startedAt={null}
        reasoningEnabled={false}
        answerStarted
      />,
    )

    expect(html).toContain('已搜索 2 个关键词')
    expect(html).toContain('浏览 1 个页面')
    expect(html).toContain('react 19')
    expect(html).toContain('href="https://react.dev/blog"')
    expect(html.match(/data-testid="search-step"/g)).toHaveLength(2)
    expect(html).toContain('data-testid="process-track-source-icon"')
  })

  it('存在 reasoning 步骤或思考耗时时不显示纯检索前置图标', () => {
    const searchStep = liveStepsFromPersisted([
      { kind: 'search', action: { type: 'search', queries: ['phase'] } },
    ])[0]!
    const withReasoning = renderToStaticMarkup(
      <ProcessTrack
        steps={[reasoningStep(''), searchStep]}
        status="completed"
        startedAt={null}
        reasoningEnabled
        answerStarted
      />,
    )
    const withDuration = renderToStaticMarkup(
      <ProcessTrack
        steps={[searchStep]}
        status="completed"
        startedAt={null}
        durationMs={1000}
        reasoningEnabled
        answerStarted
      />,
    )

    expect(withReasoning).not.toContain('data-testid="process-track-source-icon"')
    expect(withDuration).not.toContain('data-testid="process-track-source-icon"')
  })

  it('进行中的混合检索按仍在跑的来源显示唯一状态行', () => {
    const steps: LiveProcessStep[] = [
      {
        kind: 'search',
        id: 'web',
        status: 'searching',
        action: { type: 'search', queries: ['phase'] },
      },
      {
        kind: 'search',
        id: 'x',
        status: 'in_progress',
        action: { type: 'x_semantic_search' },
      },
    ]
    const html = renderToStaticMarkup(
      <ProcessTrack
        steps={steps}
        status="working"
        startedAt={1000}
        reasoningEnabled={false}
        answerStarted={false}
      />,
    )

    expect(html).toContain('正在搜索网页与 X')
    expect(html.match(/data-testid="process-track-label"/g)).toHaveLength(1)
  })

  it('页面阅读与页内查找的长地址允许完整换行', () => {
    const openPage = renderToStaticMarkup(
      <SearchStepContent
        action={{
          type: 'open_page',
          url: 'https://example.com/a/very-long-page-address-that-needs-to-wrap',
        }}
      />,
    )
    const findInPage = renderToStaticMarkup(
      <SearchStepContent
        action={{
          type: 'find_in_page',
          url: 'https://example.com/a/very-long-page-address-that-needs-to-wrap',
          pattern: 'keyword',
        }}
      />,
    )

    expect(openPage).toContain('[overflow-wrap:anywhere]')
    expect(findInPage).toContain('[overflow-wrap:anywhere]')
    expect(openPage).not.toContain('truncate')
    expect(findInPage).not.toContain('truncate')
  })

  it('停止态只显示停止文案，不追加完成页脚', () => {
    const html = renderToStaticMarkup(
      <ProcessTrack
        steps={[reasoningStep('部分思考')]}
        status="stopped"
        startedAt={null}
        durationMs={3500}
        reasoningEnabled
        answerStarted={false}
      />,
    )

    expect(html).toContain('已停止思考')
    expect(html).not.toContain('reasoning-summary-footer')
  })
})
