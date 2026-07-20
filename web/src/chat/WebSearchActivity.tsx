import { useCallback, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, Globe, Search, TextSearch } from 'lucide-react'
import type { WebSearchAction } from '@shared/types/domain'
import { summarizeWebSearchActions } from '@shared/util/webSearchActivity'
import { hasActiveWebSearch, type LiveWebSearchCall } from '../sse/eventReducer'

/**
 * 联网搜索活动卡：状态行（进行中文字流光）+ 可折叠的动作时间线。
 *
 * 口径（见上游实测）：web_search 不是贯穿思考的持续状态，而是 0~N 个离散调用，
 * 两次调用之间模型仍在推理；查询词/URL 只在调用完成后出现，进行中一律以骨架
 * 占位表达「正在检索」，不猜测内容。
 */

interface Props {
  calls: LiveWebSearchCall[]
  /** 正文已开始输出或 run 已终态：搜索阶段结束，自动折叠明细。 */
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

function statusLabel(active: boolean, actions: WebSearchAction[]): string {
  if (active) return '正在搜索网页'
  const { queryCount, pageCount } = summarizeWebSearchActions(actions)
  if (queryCount && pageCount) return `已搜索 ${queryCount} 个关键词 · 浏览 ${pageCount} 个页面`
  if (queryCount) return `已搜索 ${queryCount} 个关键词`
  if (pageCount) return `已浏览 ${pageCount} 个页面`
  return '已搜索网页'
}

function StepIcon({ action }: { action: WebSearchAction | null }) {
  const className = 'h-3.5 w-3.5'
  // 图标保持静止，避免它与旁边已足够醒目的加载骨架同时闪烁。
  if (!action) return <Globe className={className} />
  if (action.type === 'search') return <Search className={className} />
  if (action.type === 'find_in_page') return <TextSearch className={className} />
  return <Globe className={className} />
}

function StepContent({ action }: { action: WebSearchAction | null }) {
  // 进行中：查询词尚未回传，用流动骨架表达检索状态
  if (!action) {
    return (
      <span className="hc-websearch-skeleton" role="status" aria-label="正在检索网页">
        <span className="sr-only">正在检索网页</span>
      </span>
    )
  }

  if (action.type === 'search') {
    if (!action.queries?.length) {
      return (
        <span className="block text-[13px] leading-6 text-neutral-500 dark:text-neutral-400">
          检索网页
        </span>
      )
    }
    return (
      <div className="flex flex-wrap gap-1.5 py-0.5">
        {action.queries.map((query, index) => (
          <span
            key={`${query}-${index}`}
            className="hc-websearch-chip hc-websearch-chip-in max-w-[18rem] truncate rounded-full px-2.5 text-xs leading-[22px]"
            style={{ animationDelay: `${index * 60}ms` }}
            title={query}
          >
            {query}
          </span>
        ))}
      </div>
    )
  }

  const pageLabel = action.url ? pageLabelOf(action.url) : null
  const pageLink = action.url ? (
    <a
      href={action.url}
      target="_blank"
      rel="noreferrer"
      title={action.url}
      className="text-neutral-600 underline-offset-2 transition-colors hover:text-neutral-950 hover:underline dark:text-neutral-300 dark:hover:text-neutral-50"
    >
      {pageLabel}
    </a>
  ) : null

  if (action.type === 'open_page') {
    return (
      <span className="block truncate text-[13px] leading-6 text-neutral-500 dark:text-neutral-400">
        阅读 {pageLink ?? '网页'}
      </span>
    )
  }

  // find_in_page
  return (
    <span className="block truncate text-[13px] leading-6 text-neutral-500 dark:text-neutral-400">
      在 {pageLink ?? '页面'} 中查找
      {action.pattern ? (
        <span className="text-neutral-600 dark:text-neutral-300">「{action.pattern}」</span>
      ) : null}
    </span>
  )
}

function Step({ call }: { call: LiveWebSearchCall }) {
  // 动作到达时（占位 → 内容）换 key 重触发渐入，行本身位置保持稳定
  const phase = call.action ? 'action' : 'pending'
  return (
    <li
      className="grid grid-cols-[14px_minmax(0,1fr)] items-start gap-x-2"
      data-testid="web-search-step"
      data-step-type={call.action?.type ?? 'pending'}
    >
      <span
        key={`icon-${phase}`}
        className="hc-websearch-step-in mt-[5px] flex justify-center text-neutral-400 dark:text-neutral-500"
        aria-hidden
      >
        <StepIcon action={call.action} />
      </span>
      <div key={`content-${phase}`} className="hc-websearch-step-in min-w-0">
        <StepContent action={call.action} />
      </div>
    </li>
  )
}

export function WebSearchActivity({ calls, answerStarted }: Props) {
  const active = hasActiveWebSearch(calls)
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
    .filter((action): action is WebSearchAction => action !== null)
  if (!steps.length && !actions.length) return null

  const label = statusLabel(active, actions)

  return (
    <div className="hc-websearch" data-testid="web-search-activity">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? '折叠搜索过程' : '展开搜索过程'}
        className="hc-websearch-toggle inline-flex items-center gap-2 py-0.5 text-[13px] leading-6 transition-colors"
      >
        {/* 进行中状态由文字流光表达，地球图标始终保持静止。 */}
        <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className={clsx(active && 'hc-reasoning-shimmer')} data-testid="web-search-label">
          {label}
        </span>
        <ChevronDown
          className={clsx('h-3 w-3 shrink-0 transition-transform duration-300', open && 'rotate-180')}
        />
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
