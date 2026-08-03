import type { SearchAction, SearchActionType, XSearchActionType } from '../types/domain'

/**
 * 检索类 output item 的通用解析，同时覆盖两种上游形状：
 *
 * 1. `web_search_call`（OpenAI Responses 为主结构，xAI 现行实现已对齐）：动作在
 *    `item.action` 对象里，查询词在 `action.queries[]`；单数 `action.query` 已被官方
 *    标记废弃但仍需兼容，xAI 旧实现更是把查询词塞在 JSON 字符串 `arguments`/`input` 里，
 *    且 item 首次出现时可能已经是 completed。
 * 2. `custom_tool_call`（xAI 的 x_search）：上游把 X 站内检索拆成若干 server-side 子工具，
 *    工具名（`item.name`）即动作类型，参数是 JSON 字符串 `item.input`。
 *
 * 调用方无需分辨上游，统一按字段优先级回退解析。
 */

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 所有合法动作类型；用于校验来自网络的终态动作数组。 */
const SEARCH_ACTION_TYPES = new Set<string>([
  'search',
  'open_page',
  'find_in_page',
  'x_keyword_search',
  'x_semantic_search',
  'x_user_search',
  'x_thread_fetch',
  'x_search',
])

/** x_search 子工具名 → 动作类型（xAI 实测：keyword / semantic / user / thread fetch）。 */
const X_SEARCH_TOOL_NAMES: Record<string, XSearchActionType> = {
  x_keyword_search: 'x_keyword_search',
  x_semantic_search: 'x_semantic_search',
  x_user_search: 'x_user_search',
  x_thread_fetch: 'x_thread_fetch',
}

/** xAI 给 x_search 服务端调用的 call_id 前缀，用于识别上游后续新增的 x_* 子工具。 */
const X_SEARCH_CALL_ID_PREFIX = 'xs_'

/**
 * x_thread_fetch 只回传帖子 ID；`/i/status/<id>` 是 X 的通用跳转形式，
 * 不需要知道作者用户名即可打开原帖（上游引用注释也用这一形式）。
 */
export function xPostUrl(postId: string): string {
  return `https://x.com/i/status/${encodeURIComponent(postId)}`
}

export function isSearchActionType(value: unknown): value is SearchActionType {
  return typeof value === 'string' && SEARCH_ACTION_TYPES.has(value)
}

export function isXSearchActionType(type: SearchActionType): type is XSearchActionType {
  return type.startsWith('x_')
}

export function isXSearchAction(action: SearchAction): boolean {
  return isXSearchActionType(action.type)
}

/**
 * 判断一个 `custom_tool_call` 是否来自 x_search。
 * 已知子工具名直接命中；未知的 `x_*` 名字要求 call_id 带 `xs_` 前缀，
 * 避免把业务自定义工具（client-side custom tool）误认成检索动作。
 */
function xSearchActionType(item: Record<string, unknown>): XSearchActionType | null {
  const name = str(item.name)
  const known = X_SEARCH_TOOL_NAMES[name]
  if (known) return known
  if (name.startsWith('x_') && str(item.call_id).startsWith(X_SEARCH_CALL_ID_PREFIX)) {
    return 'x_search'
  }
  return null
}

/** 该 output item 是否代表一次检索调用（web_search 或 x_search）。 */
export function isSearchCallItem(item: unknown): item is Record<string, unknown> {
  if (!isRecord(item)) return false
  if (item.type === 'web_search_call') return true
  return item.type === 'custom_tool_call' && xSearchActionType(item) !== null
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

/** X 账号统一去掉前导 @，去空白、去重、保序。 */
function normalizeHandles(...candidates: unknown[]): string[] {
  const list: string[] = []
  const push = (value: unknown) => {
    const text = str(value).trim().replace(/^@+/, '')
    if (text && !list.includes(text)) list.push(text)
  }
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) candidate.forEach(push)
    else push(candidate)
  }
  return list
}

/** action 可能是对象（OpenAI/xAI 现行），也可能是 arguments/input 的 JSON 字符串。 */
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

function webSearchActionFromRecord(record: Record<string, unknown>): SearchAction | null {
  const declared = str(record.type)
  const queries = normalizeQueries(record.queries, record.query)
  const url = str(record.url).trim()
  const pattern = str(record.pattern).trim()
  const error = str(record.error).trim()

  // 显式 type 优先；无 type 的旧形状按字段组合推断（url+pattern → 页内查找）。
  const type: SearchActionType | null =
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
    return {
      type,
      ...(queries.length ? { queries } : {}),
      ...(error ? { error } : {}),
    }
  }
  if (type === 'open_page') return url ? { type, url } : { type }
  return {
    type,
    ...(url ? { url } : {}),
    ...(pattern ? { pattern } : {}),
  }
}

/**
 * 已知 x_search 动作类型时，从子工具的 JSON 参数补全细节。
 * 流式链路里 `custom_tool_call_input.done` 比 `output_item.done` 早到，
 * 单独暴露该入口可以让查询词尽早显示。
 */
export function xSearchActionFromToolInput(
  type: XSearchActionType,
  rawInput: unknown,
): SearchAction {
  const input = parseJsonRecord(rawInput)
  if (!input) return { type }
  const queries = normalizeQueries(input.queries, input.query)
  const handles = normalizeHandles(input.usernames, input.allowed_x_handles, input.x_handles)
  const excludedHandles = normalizeHandles(input.excluded_usernames, input.excluded_x_handles)
  const fromDate = str(input.from_date).trim()
  const toDate = str(input.to_date).trim()
  const mode = str(input.mode).trim()
  const postId = str(input.post_id).trim()
  return {
    type,
    ...(queries.length ? { queries } : {}),
    ...(handles.length ? { handles } : {}),
    ...(excludedHandles.length ? { excludedHandles } : {}),
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
    ...(mode ? { mode } : {}),
    ...(postId ? { postId } : {}),
  }
}

/**
 * 从检索 output item 中提取动作。
 * web_search 解析优先级：`action` → `arguments` → `input`；全部无法识别时返回 null。
 * x_search 由工具名直接确定类型，参数缺失时也会返回只有 type 的动作（用于占位渲染）。
 */
export function searchActionFromItem(item: unknown): SearchAction | null {
  if (!isRecord(item)) return null
  if (item.type === 'custom_tool_call') {
    const type = xSearchActionType(item)
    if (!type) return null
    return xSearchActionFromToolInput(type, item.input ?? item.arguments)
  }
  if (item.type !== 'web_search_call') return null
  for (const candidate of [item.action, item.arguments, item.input]) {
    const record = parseJsonRecord(candidate)
    if (!record) continue
    const action = webSearchActionFromRecord(record)
    if (action) return action
  }
  return null
}

/** 动作携带的信息量：同一次调用会多次上报，用它决定新值是否值得覆盖旧值。 */
function actionDetailScore(action: SearchAction): number {
  return (
    (action.queries?.length ? 1 : 0) +
    (action.url ? 1 : 0) +
    (action.pattern ? 1 : 0) +
    (action.postId ? 1 : 0) +
    (action.handles?.length ? 1 : 0) +
    (action.excludedHandles?.length ? 1 : 0) +
    (action.fromDate ? 1 : 0) +
    (action.toDate ? 1 : 0) +
    (action.mode ? 1 : 0)
  )
}

/**
 * 合并同一次调用先后上报的动作：只允许信息量不减少的覆盖。
 * （`output_item.added` 常常只有类型，细节要等 input.done / output_item.done。）
 */
export function mergeSearchAction(
  previous: SearchAction | null,
  next: SearchAction | null,
): SearchAction | null {
  if (!next) return previous
  if (!previous) return next
  if (previous.type !== next.type) return next
  return actionDetailScore(next) >= actionDetailScore(previous) ? next : previous
}

/**
 * 统一各形状事件里的调用标识：lifecycle 与 custom_tool_call_input 事件用 `item_id`，
 * output_item 事件用 `item.id`，兜底 `data.id` 与 `output_index`。不判断 id 前缀。
 */
export function searchCallIdFromEvent(data: Record<string, unknown>): string {
  const item = isRecord(data.item) ? data.item : null
  return (
    str(data.item_id) ||
    (item ? str(item.id) : '') ||
    str(data.id) ||
    (typeof data.output_index === 'number' ? `output-${data.output_index}` : '')
  )
}

export interface SearchActivitySummary {
  /** web 搜索步数下所有搜索词的总条数（一步可含多条）。 */
  webQueryCount: number
  /** 没拿到查询词的 web 搜索步数（协议上查询词可选）。 */
  blindSearchCount: number
  /** 打开页面 / 页内查找涉及的去重页面数。 */
  pageCount: number
  /** X 站内检索步数（关键词 / 语义 / 用户 / 未知子工具）。 */
  xSearchCount: number
  /** 读取 X 讨论串的步数（按帖子 ID 去重）。 */
  xThreadCount: number
}

/** 供 UI 生成「已搜索 N 个关键词 · 在 X 检索 K 次」类文案的口径统计。 */
export function summarizeSearchActions(actions: readonly SearchAction[]): SearchActivitySummary {
  let webQueryCount = 0
  let blindSearchCount = 0
  let xSearchCount = 0
  const pages = new Set<string>()
  const threads = new Set<string>()
  for (const action of actions) {
    switch (action.type) {
      case 'search':
        if (action.queries?.length) webQueryCount += action.queries.length
        else blindSearchCount += 1
        break
      case 'open_page':
      case 'find_in_page':
        pages.add(action.url || `${action.type}-${pages.size}`)
        break
      case 'x_thread_fetch':
        threads.add(action.postId || `thread-${threads.size}`)
        break
      default:
        xSearchCount += 1
        break
    }
  }
  return {
    webQueryCount,
    blindSearchCount,
    pageCount: pages.size,
    xSearchCount,
    xThreadCount: threads.size,
  }
}
