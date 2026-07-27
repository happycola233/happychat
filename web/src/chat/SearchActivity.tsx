import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, Globe, MessagesSquare, Search, TextSearch, UserSearch } from 'lucide-react'
import type { SearchAction } from '@shared/types/domain'
import { isXSearchActionType, summarizeSearchActions, xPostUrl } from '@shared/util/searchActivity'
import { XLogo } from '../components/XLogo'
import { hasActiveSearch, type LiveSearchCall } from '../sse/eventReducer'

/**
 * 检索活动卡：状态行（进行中文字流光）+ 可折叠的动作时间线。
 *
 * 口径（见上游实测）：web_search / x_search 都不是贯穿思考的持续状态，而是 0~N 个
 * 离散调用，两次调用之间模型仍在推理；两类调用共用同一条时间线以保留真实交错顺序。
 * web_search 的查询词只在调用完成后出现，进行中一律以骨架占位表达「正在检索」；
 * x_search 的动作类型在调用出现时即可确定，参数随后由 custom_tool_call_input 补齐。
 */

interface Props {
  calls: LiveSearchCall[]
  /** 正文已开始输出或 run 已终态：检索阶段结束，自动折叠明细。 */
  answerStarted: boolean
}

/** 页面显示为「主机名+路径」：同站多个页面（如 github.com 下多篇）不会看起来是重复行。 */
function pageLabelOf(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    const path = parsed.pathname.replace(/\/$/, '')
    return path ? `${host}${path}` : host
  } catch {
    return url
  }
}

/** 进行中的文案取决于此刻仍在跑的调用；动作未知的按网页搜索计（x_search 一出现就带类型）。 */
function activeLabelOf(calls: LiveSearchCall[]): string {
  const running = calls.filter((call) => call.status !== 'completed')
  const x = running.some((call) => call.action && isXSearchActionType(call.action.type))
  const web = running.some((call) => !call.action || !isXSearchActionType(call.action.type))
  if (x && web) return '正在搜索网页与 X'
  if (x) return '正在检索 X 内容'
  return '正在搜索网页'
}

/**
 * 完成后的汇总：读作「已搜索 N 个关键词 · 在 X 检索 K 次 · 浏览 M 个页面」。
 * 返回分段而不是整串，是为了让窄屏（手机）只在「·」处换行——
 * 汇总一长就会折行，CJK 允许任意字间断行，整串渲染会掉出「串」这样的孤字尾行。
 */
function summarySegmentsOf(actions: SearchAction[]): string[] {
  const summary = summarizeSearchActions(actions)
  const phrases: string[] = []
  if (summary.webQueryCount) phrases.push(`搜索 ${summary.webQueryCount} 个关键词`)
  if (summary.xSearchCount) phrases.push(`在 X 检索 ${summary.xSearchCount} 次`)
  if (summary.pageCount) phrases.push(`浏览 ${summary.pageCount} 个页面`)
  if (summary.xThreadCount) phrases.push(`读取 ${summary.xThreadCount} 个 X 讨论串`)
  if (phrases.length) return [`已${phrases[0]}`, ...phrases.slice(1)]
  // 搜索确实发生过、但上游没回传任何查询词：只陈述发生了检索，不编造计数。
  return [summary.blindSearchCount ? '已搜索网页' : '已完成检索']
}

/**
 * X 关键词检索的排序模式：上游给的是英文枚举。
 * 必须译成「按…排序」这样自解释的短语——限定条件会跟在搜索词后面单独成段，
 * 光一个「最新」读者根本不知道在说什么。
 */
const X_SEARCH_MODE_LABELS: Record<string, string> = {
  Latest: '按最新排序',
  Top: '按热门排序',
}

function StepIcon({ action }: { action: SearchAction | null }) {
  const className = 'h-3.5 w-3.5'
  // 图标保持静止，避免它与旁边已足够醒目的加载骨架同时闪烁。
  if (!action) return <Globe className={className} />
  switch (action.type) {
    case 'search':
      return <Search className={className} />
    case 'find_in_page':
      return <TextSearch className={className} />
    case 'open_page':
      return <Globe className={className} />
    case 'x_user_search':
      return <UserSearch className={className} />
    case 'x_thread_fetch':
      return <MessagesSquare className={className} />
    // x_keyword_search / x_semantic_search / 未知 x_* 子工具：直接用品牌标记
    default:
      return <XLogo className="h-3 w-3" />
  }
}

/** 单个查询词 chip：错峰渐入，超长截断但保留完整 title。 */
function QueryChip({ query, index }: { query: string; index: number }) {
  return (
    <span
      className="hc-search-chip hc-search-chip-in max-w-[18rem] truncate rounded-full px-2.5 text-xs leading-[22px]"
      style={{ animationDelay: `${index * 60}ms` }}
      title={query}
    >
      {query}
    </span>
  )
}

/** web_search 一次调用可含多条查询词。 */
function QueryChips({ queries }: { queries: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 py-0.5">
      {queries.map((query, index) => (
        <QueryChip key={`${query}-${index}`} query={query} index={index} />
      ))}
    </div>
  )
}

/**
 * x_search 的限定条件（账号 / 时间范围 / 排序）拼成一段自解释短语。
 * 每一项都要能脱离上下文读懂：跟在搜索词 chip 后面时可能因换行独占一行。
 */
function xSearchScopeText(action: SearchAction): string | null {
  const scopes: string[] = []
  if (action.handles?.length) scopes.push(`仅 ${action.handles.map((h) => `@${h}`).join(' ')}`)
  if (action.excludedHandles?.length) {
    scopes.push(`排除 ${action.excludedHandles.map((h) => `@${h}`).join(' ')}`)
  }
  if (action.fromDate || action.toDate) {
    scopes.push(`${action.fromDate ?? '不限'} ~ ${action.toDate ?? '今天'}`)
  }
  if (action.mode) scopes.push(X_SEARCH_MODE_LABELS[action.mode] ?? `按 ${action.mode} 排序`)
  return scopes.length ? scopes.join(' · ') : null
}

/** 与 chip 同处一行的次要说明：小一号、更浅，靠 chip 基线对齐而不是自成一行。 */
function StepMeta({ text }: { text: string }) {
  return (
    <span className="min-w-0 truncate text-[12px] leading-[22px] text-neutral-400 dark:text-neutral-500">
      {text}
    </span>
  )
}

const linkClass =
  'text-neutral-600 underline-offset-2 transition-colors hover:text-neutral-950 hover:underline dark:text-neutral-300 dark:hover:text-neutral-50'

function PageLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" title={url} className={linkClass}>
      {pageLabelOf(url)}
    </a>
  )
}

const stepTextClass = 'block truncate text-[13px] leading-6 text-neutral-500 dark:text-neutral-400'

function StepContent({ action }: { action: SearchAction | null }) {
  // 进行中：查询词尚未回传，用流动骨架表达检索状态
  if (!action) {
    return (
      <span className="hc-search-skeleton" role="status" aria-label="正在检索网页">
        <span className="sr-only">正在检索网页</span>
      </span>
    )
  }

  const queries = action.queries ?? []

  switch (action.type) {
    case 'search':
      if (!queries.length) return <span className={stepTextClass}>检索网页</span>
      return <QueryChips queries={queries} />

    case 'open_page':
      return (
        <span className={stepTextClass}>
          阅读 {action.url ? <PageLink url={action.url} /> : '网页'}
        </span>
      )

    case 'find_in_page':
      return (
        <span className={stepTextClass}>
          在 {action.url ? <PageLink url={action.url} /> : '页面'} 中查找
          {action.pattern ? (
            <span className="text-neutral-600 dark:text-neutral-300">「{action.pattern}」</span>
          ) : null}
        </span>
      )

    case 'x_user_search':
      return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5">
          <span className="shrink-0 text-[13px] leading-[22px] text-neutral-500 dark:text-neutral-400">
            查找 X 用户
          </span>
          {queries.map((query, index) => (
            <QueryChip key={`${query}-${index}`} query={query} index={index} />
          ))}
        </div>
      )

    case 'x_thread_fetch':
      return (
        <span className={stepTextClass}>
          读取 X 讨论串
          {action.postId ? (
            <>
              {' '}
              <a
                href={xPostUrl(action.postId)}
                target="_blank"
                rel="noreferrer"
                title={xPostUrl(action.postId)}
                className={linkClass}
              >
                #{action.postId}
              </a>
            </>
          ) : null}
        </span>
      )

    // x_keyword_search / x_semantic_search / 未知 x_* 子工具
    default: {
      // 限定条件与搜索词同处一个 flex-wrap 行：空间够时贴在 chip 右侧读作
      // 「搜索词 + 限定」，不够时才换行——不再无条件另起一行留下一个孤零零的短语。
      const scope = xSearchScopeText(action)
      return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5">
          {queries.length ? (
            queries.map((query, index) => (
              <QueryChip key={`${query}-${index}`} query={query} index={index} />
            ))
          ) : (
            <span className="text-[13px] leading-[22px] text-neutral-500 dark:text-neutral-400">
              {action.type === 'x_semantic_search' ? '语义检索 X' : '检索 X'}
            </span>
          )}
          {scope ? <StepMeta text={scope} /> : null}
        </div>
      )
    }
  }
}

function Step({ call }: { call: LiveSearchCall }) {
  // 动作到达时（占位 → 内容）换 key 重触发渐入，行本身位置保持稳定
  const phase = call.action ? 'action' : 'pending'
  return (
    <li
      className="grid grid-cols-[14px_minmax(0,1fr)] items-start gap-x-2"
      data-testid="search-step"
      data-step-type={call.action?.type ?? 'pending'}
    >
      <span
        key={`icon-${phase}`}
        className="hc-search-step-in mt-[5px] flex justify-center text-neutral-400 dark:text-neutral-500"
        aria-hidden
      >
        <StepIcon action={call.action} />
      </span>
      <div key={`content-${phase}`} className="hc-search-step-in min-w-0">
        <StepContent action={call.action} />
      </div>
    </li>
  )
}

export function SearchActivity({ calls, answerStarted }: Props) {
  const active = hasActiveSearch(calls)
  const [open, setOpen] = useState(active)
  // 用户手动开合后，自动展开/折叠让位给用户意图
  const userToggledRef = useRef(false)

  useEffect(() => {
    if (active && !userToggledRef.current) setOpen(true)
  }, [active])

  useEffect(() => {
    if (answerStarted && !userToggledRef.current) setOpen(false)
  }, [answerStarted])

  const toggle = useCallback(() => {
    userToggledRef.current = true
    setOpen((value) => !value)
  }, [])

  // 已完成但始终没解析出动作的调用没有可展示内容（终态会被 reducer 清理）
  const steps = calls.filter((call) => call.action !== null || call.status !== 'completed')
  const actions = calls
    .map((call) => call.action)
    .filter((action): action is SearchAction => action !== null)
  if (!steps.length && !actions.length) return null

  const segments = active ? [activeLabelOf(calls)] : summarySegmentsOf(actions)
  // 本轮只用到 X 检索时，状态行直接挂 X 标记；混合或纯网页仍用地球。
  const xOnly = actions.length > 0 && actions.every((action) => isXSearchActionType(action.type))

  return (
    <div className="hc-search" data-testid="search-activity">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? '折叠检索过程' : '展开检索过程'}
        className="hc-search-toggle inline-flex items-start gap-2 py-0.5 text-left text-[13px] leading-6 transition-colors"
      >
        {/* 进行中状态由文字流光表达，来源图标始终保持静止。
            图标钉在首行行盒里（h-6 = leading-6）：文案换行后它不会滑到两行之间。 */}
        <span className="flex h-6 shrink-0 items-center" aria-hidden>
          {xOnly ? <XLogo className="h-3 w-3" /> : <Globe className="h-3.5 w-3.5" />}
        </span>
        {/* 每段短语自身不折断，换行只发生在段间；箭头作为末位元素跟在最后一段后面。 */}
        <span className="flex flex-wrap items-center gap-x-1.5" data-testid="search-label">
          {segments.map((segment, index) => (
            <Fragment key={`${segment}-${index}`}>
              {index > 0 && <span aria-hidden>·</span>}
              <span className={clsx('whitespace-nowrap', active && 'hc-reasoning-shimmer')}>
                {segment}
              </span>
            </Fragment>
          ))}
          <ChevronDown
            className={clsx(
              'h-3 w-3 shrink-0 transition-transform duration-300',
              open && 'rotate-180',
            )}
          />
        </span>
      </button>
      <div
        className={clsx(
          'grid transition-[grid-template-rows,opacity] duration-300 ease-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
        aria-hidden={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <ol className="space-y-1 pt-1.5 pr-2 pb-1">
            {steps.map((call) => (
              <Step key={call.id} call={call} />
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}
