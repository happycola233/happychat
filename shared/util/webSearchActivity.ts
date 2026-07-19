import type { WebSearchAction } from '../types/domain'

/**
 * web_search_call output item 的通用解析。
 *
 * 以 OpenAI Responses 为主结构（`item.action` 对象，查询词在 `action.queries[]`，
 * 单数 `action.query` 已被官方标记废弃但仍需兼容）；xAI Responses 链路的旧实现
 * 没有 `action`，查询词藏在 JSON 字符串 `arguments`/`input` 里，且 item 首次出现
 * 时可能已经是 completed——这里统一按字段优先级回退解析，调用方无需分辨上游。
 */

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isWebSearchCallItem(item: unknown): item is Record<string, unknown> {
  return isRecord(item) && item.type === 'web_search_call'
}

/** `queries[]` 优先、单数 `query` 兜底；去空白、去重、保序。 */
function normalizeQueries(queries: unknown, query: unknown): string[] {
  const list: string[] = []
  const push = (value: unknown) => {
    const text = str(value).trim()
    if (text && !list.includes(text)) list.push(text)
  }
  if (Array.isArray(queries)) queries.forEach(push)
  push(query)
  return list
}

/** action 可能是对象（OpenAI/xAI 现行），也可能是 arguments/input 的 JSON 字符串（xAI 旧实现）。 */
function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value
  const text = str(value).trim()
  if (!text) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function actionFromRecord(record: Record<string, unknown>): WebSearchAction | null {
  const declared = str(record.type)
  const queries = normalizeQueries(record.queries, record.query)
  const url = str(record.url).trim()
  const pattern = str(record.pattern).trim()

  // 显式 type 优先；无 type 的旧形状按字段组合推断（url+pattern → 页内查找）。
  const type: WebSearchAction['type'] | null =
    declared === 'search' || declared === 'open_page' || declared === 'find_in_page'
      ? declared
      : declared
        ? null
        : queries.length
          ? 'search'
          : url && pattern
            ? 'find_in_page'
            : url
              ? 'open_page'
              : null
  if (!type) return null

  if (type === 'search') {
    // 官方口径：search action「通常但不总是」包含查询词，缺失时保留计数不造数据。
    return queries.length ? { type, queries } : { type }
  }
  if (type === 'open_page') return url ? { type, url } : { type }
  return {
    type,
    ...(url ? { url } : {}),
    ...(pattern ? { pattern } : {}),
  }
}

/**
 * 从 web_search_call output item 中提取动作。
 * 解析优先级：`action` → `arguments` → `input`；全部无法识别时返回 null。
 */
export function webSearchActionFromItem(item: unknown): WebSearchAction | null {
  if (!isWebSearchCallItem(item)) return null
  for (const candidate of [item.action, item.arguments, item.input]) {
    const record = parseJsonRecord(candidate)
    if (!record) continue
    const action = actionFromRecord(record)
    if (action) return action
  }
  return null
}

/**
 * 统一各形状事件里的调用标识：lifecycle 事件用 `item_id`，output_item 事件用
 * `item.id`，兜底 `data.id` 与 `output_index`。不判断 `ws_`/`fc_` 前缀。
 */
export function webSearchCallIdFromEvent(data: Record<string, unknown>): string {
  const item = isRecord(data.item) ? data.item : null
  return (
    str(data.item_id) ||
    (item ? str(item.id) : '') ||
    str(data.id) ||
    (typeof data.output_index === 'number' ? `output-${data.output_index}` : '')
  )
}

export interface WebSearchActivitySummary {
  /** 搜索步数下所有搜索词的总条数（一步可含多条）。 */
  queryCount: number
  /** 没拿到查询词的 search 步数（协议上查询词可选）。 */
  blindSearchCount: number
  /** 打开页面 / 页内查找涉及的去重页面数。 */
  pageCount: number
}

/** 供 UI 生成「已搜索 N 个关键词 · 浏览 M 个页面」类文案的口径统计。 */
export function summarizeWebSearchActions(
  actions: readonly WebSearchAction[],
): WebSearchActivitySummary {
  let queryCount = 0
  let blindSearchCount = 0
  const pages = new Set<string>()
  for (const action of actions) {
    if (action.type === 'search') {
      if (action.queries?.length) queryCount += action.queries.length
      else blindSearchCount += 1
    } else if (action.url) {
      pages.add(action.url)
    } else {
      pages.add(`${action.type}-${pages.size}`)
    }
  }
  return { queryCount, blindSearchCount, pageCount: pages.size }
}
