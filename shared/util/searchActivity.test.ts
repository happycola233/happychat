import { describe, expect, it } from 'vitest'
import {
  isSearchCallItem,
  mergeSearchAction,
  searchActionFromItem,
  searchCallIdFromEvent,
  summarizeSearchActions,
  xPostUrl,
  xSearchActionFromToolInput,
} from './searchActivity'

describe('searchActionFromItem / web_search_call', () => {
  it('解析 OpenAI 现行 search action（queries[] 优先并与废弃单数 query 去重）', () => {
    const action = searchActionFromItem({
      type: 'web_search_call',
      id: 'ws_1',
      status: 'completed',
      action: {
        type: 'search',
        query: 'react 19 release date',
        queries: ['react 19 release date', 'react 19 changelog'],
      },
    })
    expect(action).toEqual({
      type: 'search',
      queries: ['react 19 release date', 'react 19 changelog'],
    })
  })

  it('解析 open_page 与 find_in_page 动作', () => {
    expect(
      searchActionFromItem({
        type: 'web_search_call',
        action: { type: 'open_page', url: 'https://react.dev/blog' },
      }),
    ).toEqual({ type: 'open_page', url: 'https://react.dev/blog' })

    expect(
      searchActionFromItem({
        type: 'web_search_call',
        action: { type: 'find_in_page', url: 'https://react.dev/blog', pattern: 'React 19' },
      }),
    ).toEqual({ type: 'find_in_page', url: 'https://react.dev/blog', pattern: 'React 19' })
  })

  it('search action 缺查询词时保留步骤本身，不伪造数据', () => {
    expect(searchActionFromItem({ type: 'web_search_call', action: { type: 'search' } })).toEqual({
      type: 'search',
    })
  })

  it('兼容 xAI 旧实现：查询词藏在 JSON 字符串 arguments 里且无 action', () => {
    const action = searchActionFromItem({
      type: 'web_search_call',
      id: 'fc_123',
      status: 'completed',
      name: 'web_search',
      arguments: '{"query":"what is xAI","num_results":5}',
    })
    expect(action).toEqual({ type: 'search', queries: ['what is xAI'] })
  })

  it('兼容 input 兜底与无 type 的字段组合推断', () => {
    expect(
      searchActionFromItem({
        type: 'web_search_call',
        input: '{"url":"https://docs.x.ai/","pattern":"web_search"}',
      }),
    ).toEqual({ type: 'find_in_page', url: 'https://docs.x.ai/', pattern: 'web_search' })

    expect(
      searchActionFromItem({
        type: 'web_search_call',
        input: { url: 'https://docs.x.ai/' },
      }),
    ).toEqual({ type: 'open_page', url: 'https://docs.x.ai/' })
  })

  it('非检索 item、未知 action 类型与无法解析的 JSON 都返回 null', () => {
    expect(searchActionFromItem({ type: 'reasoning' })).toBeNull()
    expect(searchActionFromItem(null)).toBeNull()
    expect(searchActionFromItem({ type: 'web_search_call', action: { type: 'screenshot' } })).toBeNull()
    expect(searchActionFromItem({ type: 'web_search_call', arguments: '{oops' })).toBeNull()
  })

  it('arguments 解析失败时继续回退到 input', () => {
    expect(
      searchActionFromItem({
        type: 'web_search_call',
        arguments: 'not-json',
        input: '{"query":"fallback"}',
      }),
    ).toEqual({ type: 'search', queries: ['fallback'] })
  })
})

describe('searchActionFromItem / x_search', () => {
  it('按子工具名解析 x_keyword_search，并归一化账号与时间范围', () => {
    // 形状取自 api.x.ai 实测：x_search 走 server-side custom_tool_call，参数是 JSON 字符串。
    expect(
      searchActionFromItem({
        type: 'custom_tool_call',
        call_id: 'xs_call-4ae7-0',
        id: 'ctc_resp_call-4ae7-0',
        name: 'x_keyword_search',
        status: 'completed',
        input: '{"query":"from:elonmusk","limit":"10","mode":"Latest","usernames":["@elonmusk"]}',
      }),
    ).toEqual({
      type: 'x_keyword_search',
      queries: ['from:elonmusk'],
      handles: ['elonmusk'],
      mode: 'Latest',
    })
  })

  it('解析 x_semantic_search 的日期范围与 x_thread_fetch 的帖子 ID', () => {
    expect(
      searchActionFromItem({
        type: 'custom_tool_call',
        call_id: 'xs_call-1',
        name: 'x_semantic_search',
        input: '{"query":"recent topics","limit":"5","from_date":"2026-06-01","to_date":"2026-07-01"}',
      }),
    ).toEqual({
      type: 'x_semantic_search',
      queries: ['recent topics'],
      fromDate: '2026-06-01',
      toDate: '2026-07-01',
    })

    expect(
      searchActionFromItem({
        type: 'custom_tool_call',
        call_id: 'xs_call-2',
        name: 'x_thread_fetch',
        input: '{"post_id":"2081485024872796427"}',
      }),
    ).toEqual({ type: 'x_thread_fetch', postId: '2081485024872796427' })
  })

  it('首帧 input 为空时只给出动作类型，供 UI 立即建行占位', () => {
    expect(
      searchActionFromItem({
        type: 'custom_tool_call',
        call_id: 'xs_call-3',
        name: 'x_user_search',
        input: '',
        status: 'in_progress',
      }),
    ).toEqual({ type: 'x_user_search' })
  })

  it('未知 x_* 子工具凭 xs_ 前缀归类为通用 x_search；业务自定义工具一律不认', () => {
    expect(
      searchActionFromItem({
        type: 'custom_tool_call',
        call_id: 'xs_call-9',
        name: 'x_media_search',
        input: '{"query":"grok demo"}',
      }),
    ).toEqual({ type: 'x_search', queries: ['grok demo'] })

    expect(
      searchActionFromItem({
        type: 'custom_tool_call',
        call_id: 'call_biz_1',
        name: 'x_something',
        input: '{"query":"nope"}',
      }),
    ).toBeNull()
    expect(
      searchActionFromItem({
        type: 'custom_tool_call',
        call_id: 'call_biz_2',
        name: 'get_weather',
        input: '{"city":"OKC"}',
      }),
    ).toBeNull()
  })

  it('xSearchActionFromToolInput 支持流式 input.done 单独补全参数', () => {
    expect(
      xSearchActionFromToolInput('x_keyword_search', '{"query":"grok","excluded_usernames":["spam"]}'),
    ).toEqual({ type: 'x_keyword_search', queries: ['grok'], excludedHandles: ['spam'] })
    expect(xSearchActionFromToolInput('x_keyword_search', 'not-json')).toEqual({
      type: 'x_keyword_search',
    })
  })

  it('xPostUrl 用 /i/status/ 形式，无需作者用户名', () => {
    expect(xPostUrl('123')).toBe('https://x.com/i/status/123')
  })
})

describe('mergeSearchAction', () => {
  it('同类型时只接受信息量不减少的覆盖（added 只有类型，细节稍后到达）', () => {
    const placeholder = { type: 'x_keyword_search' as const }
    const detailed = { type: 'x_keyword_search' as const, queries: ['grok'] }
    expect(mergeSearchAction(placeholder, detailed)).toBe(detailed)
    expect(mergeSearchAction(detailed, placeholder)).toBe(detailed)
    expect(mergeSearchAction(null, detailed)).toBe(detailed)
    expect(mergeSearchAction(detailed, null)).toBe(detailed)
  })

  it('类型变化时直接采用新值', () => {
    const next = { type: 'open_page' as const, url: 'https://a.dev/' }
    expect(mergeSearchAction({ type: 'search', queries: ['a'] }, next)).toBe(next)
  })
})

describe('searchCallIdFromEvent', () => {
  it('按 item_id → item.id → id → output_index 优先级取标识', () => {
    expect(searchCallIdFromEvent({ item_id: 'ws_1', item: { id: 'x' } })).toBe('ws_1')
    expect(searchCallIdFromEvent({ item: { id: 'fc_2' }, id: 'ev_3' })).toBe('fc_2')
    expect(searchCallIdFromEvent({ id: 'ev_3' })).toBe('ev_3')
    expect(searchCallIdFromEvent({ output_index: 4 })).toBe('output-4')
    expect(searchCallIdFromEvent({})).toBe('')
  })
})

describe('isSearchCallItem / summarizeSearchActions', () => {
  it('识别 web_search_call 与 x_search 的 custom_tool_call', () => {
    expect(isSearchCallItem({ type: 'web_search_call' })).toBe(true)
    expect(isSearchCallItem({ type: 'custom_tool_call', name: 'x_thread_fetch' })).toBe(true)
    expect(isSearchCallItem({ type: 'custom_tool_call', name: 'get_weather' })).toBe(false)
    expect(isSearchCallItem({ type: 'message' })).toBe(false)
  })

  it('分别统计网页关键词、无词搜索、去重页面、X 检索与 X 讨论串', () => {
    expect(
      summarizeSearchActions([
        { type: 'search', queries: ['a', 'b'] },
        { type: 'search' },
        { type: 'open_page', url: 'https://a.dev/x' },
        { type: 'find_in_page', url: 'https://a.dev/x', pattern: 'p' },
        { type: 'open_page', url: 'https://b.dev/' },
        { type: 'x_keyword_search', queries: ['from:xai'] },
        { type: 'x_semantic_search', queries: ['grok 4.5 反馈'] },
        { type: 'x_user_search', queries: ['xai'] },
        { type: 'x_search', queries: ['未知子工具'] },
        { type: 'x_thread_fetch', postId: '1' },
        { type: 'x_thread_fetch', postId: '1' },
      ]),
    ).toEqual({
      webQueryCount: 2,
      blindSearchCount: 1,
      pageCount: 2,
      xSearchCount: 4,
      xThreadCount: 1,
    })
  })
})
