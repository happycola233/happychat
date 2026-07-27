import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { persistedSearchCalls, type LiveSearchCall } from '../sse/eventReducer'
import { SearchActivity } from './SearchActivity'

describe('SearchActivity', () => {
  it('搜索进行中：流光状态行 + 骨架占位（查询词未回传前不猜内容）', () => {
    const calls: LiveSearchCall[] = [{ id: 'ws_1', status: 'searching', action: null }]
    const html = renderToStaticMarkup(<SearchActivity calls={calls} answerStarted={false} />)

    expect(html).toContain('正在搜索网页')
    expect(html).toContain('hc-reasoning-shimmer')
    expect(html).toContain('hc-search-skeleton')
    // 标题和待解析步骤的地球图标保持静止，其余加载反馈继续显示。
    expect(html).not.toContain('hc-search-pulse')
    // 进行中自动展开明细
    expect(html).toContain('aria-expanded="true"')
  })

  it('已完成：按时间序渲染搜索词 chips、阅读页面链接与页内查找', () => {
    const calls: LiveSearchCall[] = [
      { id: 'ws_1', status: 'completed', action: { type: 'search', queries: ['react 19', 'vite 7'] } },
      { id: 'ws_2', status: 'completed', action: { type: 'open_page', url: 'https://react.dev/blog' } },
      {
        id: 'ws_3',
        status: 'completed',
        action: { type: 'find_in_page', url: 'https://react.dev/blog', pattern: 'React 19' },
      },
    ]
    const html = renderToStaticMarkup(<SearchActivity calls={calls} answerStarted />)

    // 汇总按短语分段渲染（窄屏只在段间换行），断言逐段进行
    expect(html).toContain('已搜索 2 个关键词')
    expect(html).toContain('浏览 1 个页面')
    expect(html).toContain('react 19')
    expect(html).toContain('vite 7')
    expect(html).toContain('href="https://react.dev/blog"')
    expect(html).toContain('阅读')
    // 页面行显示「主机名+路径」，同站多个页面不会显示成重复行
    expect(html).toContain('react.dev/blog')
    expect(html).toContain('「React 19」')
    expect(html.match(/data-testid="search-step"/g)).toHaveLength(3)
    // 回答已开始且非进行中：默认折叠
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('hc-search-skeleton')
  })

  it('持久化动作序列经适配后与流式态走同一渲染路径', () => {
    const html = renderToStaticMarkup(
      <SearchActivity
        calls={persistedSearchCalls([{ type: 'search', queries: ['happychat'] }])}
        answerStarted
      />,
    )

    expect(html).toContain('已搜索 1 个关键词')
    expect(html).toContain('happychat')
  })

  it('只有未解析出动作的已完成调用时不渲染任何内容', () => {
    const calls: LiveSearchCall[] = [{ id: 'ws_1', status: 'completed', action: null }]
    expect(renderToStaticMarkup(<SearchActivity calls={calls} answerStarted />)).toBe('')
  })

  it('x_search：渲染查询词 chip、限定条件小字与讨论串外链', () => {
    const calls: LiveSearchCall[] = [
      {
        id: 'ctc_1',
        status: 'completed',
        action: {
          type: 'x_keyword_search',
          queries: ['from:elonmusk'],
          handles: ['elonmusk'],
          fromDate: '2026-07-01',
          mode: 'Latest',
        },
      },
      { id: 'ctc_2', status: 'completed', action: { type: 'x_user_search', queries: ['xai'] } },
      { id: 'ctc_3', status: 'completed', action: { type: 'x_thread_fetch', postId: '2081485024872796427' } },
    ]
    const html = renderToStaticMarkup(<SearchActivity calls={calls} answerStarted />)

    expect(html).toContain('已在 X 检索 2 次')
    expect(html).toContain('读取 1 个 X 讨论串')
    expect(html).toContain('from:elonmusk')
    expect(html).toContain('仅 @elonmusk')
    expect(html).toContain('2026-07-01 ~ 今天')
    expect(html).toContain('按最新排序')
    expect(html).toContain('查找 X 用户')
    expect(html).toContain('href="https://x.com/i/status/2081485024872796427"')
    expect(html.match(/data-testid="search-step"/g)).toHaveLength(3)
  })

  it('网页与 X 混合：汇总合并计数，进行中文案按仍在跑的调用来源给出', () => {
    const calls: LiveSearchCall[] = [
      { id: 'ws_1', status: 'completed', action: { type: 'search', queries: ['grok 4.5'] } },
      { id: 'ctc_1', status: 'in_progress', action: { type: 'x_semantic_search' } },
    ]
    const running = renderToStaticMarkup(<SearchActivity calls={calls} answerStarted={false} />)
    expect(running).toContain('正在检索 X 内容')

    const settled = renderToStaticMarkup(
      <SearchActivity
        calls={calls.map((call) => ({ ...call, status: 'completed' as const }))}
        answerStarted
      />,
    )
    expect(settled).toContain('已搜索 1 个关键词')
    expect(settled).toContain('在 X 检索 1 次')
  })
})
