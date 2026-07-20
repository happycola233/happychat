import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { persistedWebSearchCalls, type LiveWebSearchCall } from '../sse/eventReducer'
import { WebSearchActivity } from './WebSearchActivity'

describe('WebSearchActivity', () => {
  it('搜索进行中：流光状态行 + 骨架占位（查询词未回传前不猜内容）', () => {
    const calls: LiveWebSearchCall[] = [{ id: 'ws_1', status: 'searching', action: null }]
    const html = renderToStaticMarkup(<WebSearchActivity calls={calls} answerStarted={false} />)

    expect(html).toContain('正在搜索网页')
    expect(html).toContain('hc-reasoning-shimmer')
    expect(html).toContain('hc-websearch-skeleton')
    // 标题和待解析步骤的地球图标保持静止，其余加载反馈继续显示。
    expect(html).not.toContain('hc-websearch-pulse')
    // 进行中自动展开明细
    expect(html).toContain('aria-expanded="true"')
  })

  it('已完成：按时间序渲染搜索词 chips、阅读页面链接与页内查找', () => {
    const calls: LiveWebSearchCall[] = [
      { id: 'ws_1', status: 'completed', action: { type: 'search', queries: ['react 19', 'vite 7'] } },
      { id: 'ws_2', status: 'completed', action: { type: 'open_page', url: 'https://react.dev/blog' } },
      {
        id: 'ws_3',
        status: 'completed',
        action: { type: 'find_in_page', url: 'https://react.dev/blog', pattern: 'React 19' },
      },
    ]
    const html = renderToStaticMarkup(<WebSearchActivity calls={calls} answerStarted />)

    expect(html).toContain('已搜索 2 个关键词 · 浏览 1 个页面')
    expect(html).toContain('react 19')
    expect(html).toContain('vite 7')
    expect(html).toContain('href="https://react.dev/blog"')
    expect(html).toContain('阅读')
    // 页面行显示「主机名+路径」，同站多个页面不会显示成重复行
    expect(html).toContain('react.dev/blog')
    expect(html).toContain('「React 19」')
    expect(html.match(/data-testid="web-search-step"/g)).toHaveLength(3)
    // 回答已开始且非进行中：默认折叠
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('hc-websearch-skeleton')
  })

  it('持久化动作序列经适配后与流式态走同一渲染路径', () => {
    const html = renderToStaticMarkup(
      <WebSearchActivity
        calls={persistedWebSearchCalls([{ type: 'search', queries: ['happychat'] }])}
        answerStarted
      />,
    )

    expect(html).toContain('已搜索 1 个关键词')
    expect(html).toContain('happychat')
  })

  it('只有未解析出动作的已完成调用时不渲染任何内容', () => {
    const calls: LiveWebSearchCall[] = [{ id: 'ws_1', status: 'completed', action: null }]
    expect(renderToStaticMarkup(<WebSearchActivity calls={calls} answerStarted />)).toBe('')
  })
})
