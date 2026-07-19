import { describe, expect, it } from 'vitest'
import {
  isWebSearchCallItem,
  summarizeWebSearchActions,
  webSearchActionFromItem,
  webSearchCallIdFromEvent,
} from './webSearchActivity'

describe('webSearchActionFromItem', () => {
  it('解析 OpenAI 现行 search action（queries[] 优先并与废弃单数 query 去重）', () => {
    const action = webSearchActionFromItem({
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
      webSearchActionFromItem({
        type: 'web_search_call',
        action: { type: 'open_page', url: 'https://react.dev/blog' },
      }),
    ).toEqual({ type: 'open_page', url: 'https://react.dev/blog' })

    expect(
      webSearchActionFromItem({
        type: 'web_search_call',
        action: { type: 'find_in_page', url: 'https://react.dev/blog', pattern: 'React 19' },
      }),
    ).toEqual({ type: 'find_in_page', url: 'https://react.dev/blog', pattern: 'React 19' })
  })

  it('search action 缺查询词时保留步骤本身，不伪造数据', () => {
    expect(
      webSearchActionFromItem({ type: 'web_search_call', action: { type: 'search' } }),
    ).toEqual({ type: 'search' })
  })

  it('兼容 xAI 旧实现：查询词藏在 JSON 字符串 arguments 里且无 action', () => {
    const action = webSearchActionFromItem({
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
      webSearchActionFromItem({
        type: 'web_search_call',
        input: '{"url":"https://docs.x.ai/","pattern":"web_search"}',
      }),
    ).toEqual({ type: 'find_in_page', url: 'https://docs.x.ai/', pattern: 'web_search' })

    expect(
      webSearchActionFromItem({
        type: 'web_search_call',
        input: { url: 'https://docs.x.ai/' },
      }),
    ).toEqual({ type: 'open_page', url: 'https://docs.x.ai/' })
  })

  it('非 web_search_call、未知 action 类型与无法解析的 JSON 都返回 null', () => {
    expect(webSearchActionFromItem({ type: 'reasoning' })).toBeNull()
    expect(webSearchActionFromItem(null)).toBeNull()
    expect(
      webSearchActionFromItem({ type: 'web_search_call', action: { type: 'screenshot' } }),
    ).toBeNull()
    expect(webSearchActionFromItem({ type: 'web_search_call', arguments: '{oops' })).toBeNull()
  })

  it('arguments 解析失败时继续回退到 input', () => {
    expect(
      webSearchActionFromItem({
        type: 'web_search_call',
        arguments: 'not-json',
        input: '{"query":"fallback"}',
      }),
    ).toEqual({ type: 'search', queries: ['fallback'] })
  })
})

describe('webSearchCallIdFromEvent', () => {
  it('按 item_id → item.id → id → output_index 优先级取标识', () => {
    expect(webSearchCallIdFromEvent({ item_id: 'ws_1', item: { id: 'x' } })).toBe('ws_1')
    expect(webSearchCallIdFromEvent({ item: { id: 'fc_2' }, id: 'ev_3' })).toBe('fc_2')
    expect(webSearchCallIdFromEvent({ id: 'ev_3' })).toBe('ev_3')
    expect(webSearchCallIdFromEvent({ output_index: 4 })).toBe('output-4')
    expect(webSearchCallIdFromEvent({})).toBe('')
  })
})

describe('isWebSearchCallItem / summarizeWebSearchActions', () => {
  it('识别 web_search_call item', () => {
    expect(isWebSearchCallItem({ type: 'web_search_call' })).toBe(true)
    expect(isWebSearchCallItem({ type: 'message' })).toBe(false)
  })

  it('统计查询词条数、无词搜索步数与去重页面数', () => {
    expect(
      summarizeWebSearchActions([
        { type: 'search', queries: ['a', 'b'] },
        { type: 'search' },
        { type: 'open_page', url: 'https://a.dev/x' },
        { type: 'find_in_page', url: 'https://a.dev/x', pattern: 'p' },
        { type: 'open_page', url: 'https://b.dev/' },
      ]),
    ).toEqual({ queryCount: 2, blindSearchCount: 1, pageCount: 2 })
  })
})
