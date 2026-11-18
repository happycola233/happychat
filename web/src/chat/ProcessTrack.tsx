import {
  Fragment,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { clsx } from 'clsx'
import { ChevronDown, Globe } from 'lucide-react'
import type { SearchAction } from '@shared/types/domain'
import { isXSearchActionType } from '@shared/util/searchActivity'
import { XLogo } from '../components/XLogo'
import { hasActiveSearch, type LiveProcessStep, type LiveSearchStep } from '../sse/eventReducer'
import { Markdown } from './Markdown'
import {
  activeSearchLabelOf,
  SearchStepContent,
  SearchStepIcon,
  searchSummaryPhrases,
} from './SearchStep'
import { elapsedSeconds } from './elapsed'
import { splitVisibleUnits } from './markdownStreamFade'
import { normalizeReasoningMarkdown } from './reasoningMarkdown'
import { splitReasoningSections } from './reasoningSections'
import { ThinkingGlyph } from './ThinkingGlyph'

export type ProcessTrackStatus = 'working' | 'paused' | 'completed' | 'stopped'

interface CollapseScrollAnchor {
  scroller: HTMLElement
  cardTop: number
}

function findScrollContainer(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement
  while (parent) {
    const overflowY = window.getComputedStyle(parent).overflowY
    if (/(auto|scroll|overlay)/.test(overflowY) && parent.scrollHeight > parent.clientHeight) {
      return parent
    }
    parent = parent.parentElement
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null
}

function clampScrollTop(scroller: HTMLElement, top: number) {
  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  return Math.min(Math.max(0, top), maxScrollTop)
}

function scrollViewportTop(scroller: HTMLElement): number {
  return scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top
}

function stickyTopOffset(sticky: HTMLElement): number {
  const top = Number.parseFloat(window.getComputedStyle(sticky).top)
  return Number.isFinite(top) ? top : 0
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface Props {
  steps: LiveProcessStep[]
  status: ProcessTrackStatus
  startedAt: number | null
  durationMs?: number | null
  /** 开启思考且上游已开始响应；耗时未知时仍据此显示思考状态。 */
  reasoningStarted: boolean
  answerStarted: boolean
  /** 开启时只在答案开始前自动展开；用户手动开合后永久让位。 */
  autoExpand?: boolean
  stickyTopClassName?: string
}

function CompletedIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
      data-testid="reasoning-completed-icon"
      className="h-[14px] w-[14px] shrink-0"
    >
      <path d="M12.498 6.909a.665.665 0 0 1 1.088.766L9.627 13.3a.665.665 0 0 1-.982.117l-.054-.053-2.083-2.292-.08-.107a.666.666 0 0 1 .964-.877l.1.09 1.525 1.676z" />
      <path
        fillRule="evenodd"
        d="M10.333 2.085a7.915 7.915 0 1 1 0 15.83 7.915 7.915 0 0 1 0-15.83m0 1.33a6.585 6.585 0 1 0 0 13.17 6.585 6.585 0 0 0 0-13.17"
        clipRule="evenodd"
      />
    </svg>
  )
}

const TITLE_STAGGER_MS = 24
const TITLE_STAGGER_MAX_MS = 360

function AnimatedSectionTitle({ text }: { text: string }) {
  let visibleIndex = 0
  return (
    <>
      {splitVisibleUnits(text).map((unit, index) => {
        if (unit.isSpace) return <Fragment key={index}>{unit.chunk}</Fragment>
        const delay = Math.min(visibleIndex * TITLE_STAGGER_MS, TITLE_STAGGER_MAX_MS)
        visibleIndex += 1
        return (
          <span key={index} className="hc-stream-seg" style={{ animationDelay: `${delay}ms` }}>
            {unit.chunk}
          </span>
        )
      })}
    </>
  )
}

// 行组件均按值 memo：流式时只有仍在生长的那一行随增量重渲染。
const ReasoningRow = memo(function ReasoningRow({
  title,
  body,
  animate,
}: {
  title: string | null
  body: string
  animate: boolean
}) {
  const hasBody = body.trim().length > 0
  return (
    <li
      className={clsx(
        'hc-reasoning-section grid grid-cols-[14px_minmax(0,1fr)] gap-x-2',
        animate && 'hc-reasoning-step-in',
      )}
    >
      {title && (
        <>
          <span
            aria-hidden
            className={clsx(
              'mt-[0.55rem] h-1.5 w-1.5 justify-self-center rounded-full bg-neutral-500 dark:bg-neutral-400',
              animate && 'hc-reasoning-dot-in',
            )}
          />
          <div className="text-sm leading-6 font-medium text-neutral-950 dark:text-neutral-100">
            {animate ? <AnimatedSectionTitle text={title} /> : title}
          </div>
        </>
      )}
      {(hasBody || !title) && (
        <>
          <span
            aria-hidden
            className={clsx(
              'w-px justify-self-center bg-neutral-300 dark:bg-neutral-600',
              title && 'mt-1',
            )}
          />
          <div className={clsx('min-w-0', title && 'mt-1')}>
            {hasBody && (
              <Markdown
                text={body}
                variant="reasoning"
                className="hc-reasoning-detail"
                animate={animate}
              />
            )}
          </div>
        </>
      )}
    </li>
  )
})

const CommentaryRow = memo(function CommentaryRow({
  step,
  animate,
}: {
  step: Extract<LiveProcessStep, { kind: 'commentary' }>
  animate: boolean
}) {
  return (
    <li
      className={clsx(
        'grid grid-cols-[14px_minmax(0,1fr)] items-start gap-x-2',
        animate && 'hc-reasoning-step-in',
      )}
      data-testid="commentary-step"
    >
      <span className="mt-[5px] flex justify-center" aria-hidden>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-3.5 w-3.5 text-neutral-400 dark:text-neutral-500"
        >
          <path d="M16.279 13.793a2.487 2.487 0 1 1 0 4.975 2.487 2.487 0 0 1 0-4.975m0 1.33a1.158 1.158 0 1 0 0 2.315 1.158 1.158 0 0 0 0-2.315M9.997 1.233c1.867 0 3.501 1.243 3.838 2.966 1.791.094 3.303 1.462 3.303 3.25 0 1.18-.669 2.184-1.63 2.751q.006.105.008.211c0 2.262-1.987 3.995-4.31 3.995-.959 0-1.85-.292-2.57-.79a3.64 3.64 0 0 1-2.285.79c-1.875 0-3.499-1.402-3.499-3.255 0-.245.033-.484.088-.713-1.029-.792-1.706-1.992-1.706-3.359 0-2.466 2.168-4.365 4.714-4.365q.434.001.846.071c.714-.949 1.892-1.552 3.203-1.552m0 1.33c-1 0-1.844.506-2.27 1.212a.82.82 0 0 1-.894.374 3.8 3.8 0 0 0-.885-.105c-1.926 0-3.384 1.415-3.384 3.036 0 .998.541 1.903 1.413 2.466.334.215.457.63.32.985a1.7 1.7 0 0 0-.115.62c0 1.009.914 1.925 2.17 1.925.59 0 1.117-.209 1.502-.538l.215-.204a.82.82 0 0 1 1.075-.003 3.15 3.15 0 0 0 2.063.745c1.702 0 2.979-1.248 2.979-2.665q0-.19-.03-.373a.82.82 0 0 1 .471-.874l.133-.066c.649-.349 1.048-.972 1.048-1.648l-.01-.188c-.105-.932-.982-1.738-2.159-1.738q-.15 0-.297.019a.69.69 0 0 1-.772-.684c0-1.212-1.095-2.295-2.573-2.296" />
        </svg>
      </span>
      <Markdown
        text={step.text}
        variant="reasoning"
        className="hc-process-commentary min-w-0"
        animate={animate}
      />
    </li>
  )
})

const SearchRow = memo(function SearchRow({
  step,
  animate,
}: {
  step: LiveSearchStep
  animate: boolean
}) {
  const phase = step.action ? 'action' : 'pending'
  return (
    <li
      className={clsx(
        'grid grid-cols-[14px_minmax(0,1fr)] items-start gap-x-2',
        animate && 'hc-reasoning-step-in',
      )}
      data-testid="search-step"
      data-step-type={step.action?.type ?? 'pending'}
    >
      <span
        key={`icon-${phase}`}
        className="hc-reasoning-step-in mt-[5px] flex justify-center text-neutral-400 dark:text-neutral-500"
        aria-hidden
      >
        <SearchStepIcon action={step.action} />
      </span>
      <div key={`content-${phase}`} className="hc-reasoning-step-in min-w-0">
        <SearchStepContent action={step.action} />
      </div>
    </li>
  )
})

type ProcessRow =
  | { kind: 'reasoning'; key: string; title: string | null; body: string }
  | { kind: 'commentary'; key: string; step: Extract<LiveProcessStep, { kind: 'commentary' }> }
  | { kind: 'search'; key: string; step: LiveSearchStep }

/** 推理步骤按小标题拆成多行；其余步骤一步一行。 */
function processRowsOf(steps: LiveProcessStep[]): ProcessRow[] {
  return steps.flatMap((step): ProcessRow[] => {
    if (step.kind === 'reasoning') {
      return splitReasoningSections(normalizeReasoningMarkdown(step.text)).map(
        (section, index) => ({
          kind: 'reasoning',
          key: `${step.id}-${index}`,
          title: section.title,
          body: section.body,
        }),
      )
    }
    return [
      step.kind === 'commentary'
        ? { kind: 'commentary', key: step.id, step }
        : { kind: 'search', key: step.id, step },
    ]
  })
}

/** 最近一个推理小标题；思考中直接作为状态行文字。 */
function latestSectionTitleOf(rows: ProcessRow[]): string | null {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]!
    if (row.kind === 'reasoning' && row.title) return row.title
  }
  return null
}

/** 过程文字总量（检索按固定权重计入），驱动点阵图标的活跃度。 */
function processActivityOf(steps: LiveProcessStep[]): number {
  return steps.reduce((total, step) => total + (step.kind === 'search' ? 40 : step.text.length), 0)
}

/** 思考秒数：不足一分钟「42s」，否则「1m 05s」，与消息耗时明细的写法一致。 */
function formatThinkingSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

function SummaryFooter({ label }: { label: string }) {
  return (
    <li
      className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-2 text-left transition-colors hc-reasoning-step-in"
      data-testid="reasoning-summary-footer"
    >
      <span
        className="mt-[5px] justify-self-center text-neutral-950 dark:text-neutral-100"
        aria-hidden
      >
        <CompletedIcon />
      </span>
      <div className="min-w-0">
        <div className="hc-reasoning-footer-title text-sm leading-6 font-medium text-neutral-950 dark:text-neutral-100">
          {label}
        </div>
        <div className="hc-reasoning-footer-detail text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
          完成
        </div>
      </div>
    </li>
  )
}

function completedSegmentsOf(
  durationMs: number | null | undefined,
  actions: SearchAction[],
  reasoned: boolean,
  hasCommentary: boolean,
): string[] {
  const searchPhrases = searchSummaryPhrases(actions)
  if (durationMs !== null && durationMs !== undefined) {
    return [
      durationMs < 1000
        ? '已思考若干秒'
        : `已思考 ${formatThinkingSeconds(Math.floor(durationMs / 1000))}`,
      ...searchPhrases,
    ]
  }
  if (reasoned) return ['已思考若干秒', ...searchPhrases]
  if (searchPhrases.length > 0) return [`已${searchPhrases[0]}`, ...searchPhrases.slice(1)]
  return [hasCommentary ? '已完成处理' : '已完成']
}

/** 只在分隔点换行；单段超出整行宽度（如很长的小标题）时省略号截断。 */
function StatusSegments({ segments, active }: { segments: string[]; active: boolean }) {
  return (
    <span
      className="flex min-w-0 flex-wrap items-center gap-x-1.5"
      data-testid="process-track-label"
    >
      {segments.map((segment, index) =>
        index === 0 ? (
          <span
            key={index}
            className={clsx('max-w-full truncate', active && 'hc-reasoning-shimmer')}
          >
            {segment}
          </span>
        ) : (
          <span key={index} className="inline-flex max-w-full min-w-0 gap-x-1.5 whitespace-nowrap">
            <span aria-hidden>·</span>
            <span className={clsx('min-w-0 truncate', active && 'hc-reasoning-shimmer')}>
              {segment}
            </span>
          </span>
        ),
      )}
    </span>
  )
}

interface StatusLabel {
  /** 文字切换的身份：key 变化才播放轮播，流光开关、秒表走动等同 key 更新原地生效。 */
  key: string
  segments: string[]
  active: boolean
  /** 秒表与文字同在一行、一起轮播，切换小标题时不会被单独挤动。 */
  withTimer: boolean
}

interface TickerEntry {
  label: StatusLabel
  generation: number
  /** 离场行冻结的宽度：保持原有截断，不随新文字的宽度变化。 */
  width: number | null
}

/** 与 .hc-status-ticker-in/out 的时长、曲线一致，行尾元素与滚动同步到位。 */
const TICKER_ROLL_MS = 500
const TICKER_ROLL_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

function StatusLine({ label, startedAt }: { label: StatusLabel; startedAt: number | null }) {
  return (
    <span className="flex min-w-0 items-start gap-2">
      <StatusSegments segments={label.segments} active={label.active} />
      {label.withTimer && <ThinkingTimer startedAt={startedAt} />}
    </span>
  )
}

/**
 * 状态行文字轮播：新旧两行像滚轮一样整行上移——同时长同曲线、恰好错开一行，
 * 任何时刻都不会叠在一起；配合淡出淡入与轻微模糊表现运动感。
 * 离场行脱离文档流并冻结原宽度；文字变宽或变窄时，行尾元素（展开箭头）用 FLIP 平滑移到新位置。
 */
function StatusTicker({
  label,
  startedAt,
  animateFirst,
  trailing,
}: {
  label: StatusLabel
  startedAt: number | null
  animateFirst: boolean
  trailing?: ReactNode
}) {
  const tickerRef = useRef<HTMLSpanElement>(null)
  const trailingRef = useRef<HTMLSpanElement>(null)
  /** 最近一次布局后的轮播区宽度，由 ResizeObserver 维护（秒表进位等也会改变宽度）。 */
  const widthRef = useRef<number | null>(null)
  const [shown, setShown] = useState<TickerEntry>({ label, generation: 0, width: null })
  const [leaving, setLeaving] = useState<TickerEntry | null>(null)
  if (label.key !== shown.label.key) {
    setLeaving({ ...shown, width: widthRef.current })
    setShown({ label, generation: shown.generation + 1, width: null })
  }
  const animateIn = shown.generation > 0 || animateFirst

  useEffect(() => {
    const ticker = tickerRef.current!
    const observer = new ResizeObserver(() => {
      widthRef.current = ticker.getBoundingClientRect().width
    })
    observer.observe(ticker)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const ticker = tickerRef.current
    const trailingElement = trailingRef.current
    const from = widthRef.current
    if (!ticker || shown.generation === 0) return
    // ResizeObserver 要到绘制前才回调，此刻 widthRef 仍是切换前的宽度。
    const to = ticker.getBoundingClientRect().width
    widthRef.current = to
    if (!trailingElement || from === null || Math.abs(from - to) < 1 || prefersReducedMotion()) {
      return
    }
    trailingElement.animate([{ translate: `${from - to}px 0` }, { translate: '0 0' }], {
      duration: TICKER_ROLL_MS,
      easing: TICKER_ROLL_EASING,
    })
  }, [shown.generation])

  return (
    <>
      <span ref={tickerRef} className="hc-status-ticker relative min-w-0">
        {leaving && (
          <span
            key={leaving.generation}
            aria-hidden
            className="hc-status-ticker-out absolute top-0 left-0"
            style={leaving.width === null ? undefined : { width: leaving.width }}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) setLeaving(null)
            }}
          >
            <StatusLine label={leaving.label} startedAt={startedAt} />
          </span>
        )}
        <span key={shown.generation} className={clsx('block', animateIn && 'hc-status-ticker-in')}>
          <StatusLine label={label} startedAt={startedAt} />
        </span>
      </span>
      {trailing && (
        <span ref={trailingRef} className="flex shrink-0">
          {trailing}
        </span>
      )}
    </>
  )
}

/** 秒表独立更新，避免每次跨秒都重渲染时间线并重启流式入场动画。 */
function ThinkingTimer({ startedAt }: { startedAt: number | null }) {
  const [seconds, setSeconds] = useState(() => elapsedSeconds(startedAt))

  useEffect(() => {
    setSeconds(elapsedSeconds(startedAt))
    const timer = setInterval(() => setSeconds(elapsedSeconds(startedAt)), 200)
    return () => clearInterval(timer)
  }, [startedAt])

  return (
    <span
      className="hc-reasoning-timer shrink-0 text-[13px] tabular-nums"
      data-testid="process-track-timer"
    >
      {formatThinkingSeconds(seconds)}
    </span>
  )
}

export function ProcessTrack({
  steps,
  status,
  startedAt,
  durationMs,
  reasoningStarted,
  answerStarted,
  autoExpand = false,
  stickyTopClassName = 'top-0',
}: Props) {
  const [open, setOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef<HTMLDivElement>(null)
  const hadContentRef = useRef(false)
  const previousAnswerStartedRef = useRef(answerStarted)
  const userToggledRef = useRef(false)
  const collapseAnchorRef = useRef<CollapseScrollAnchor | null>(null)
  const contentWindowRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  /** 预览窗与完整展开互切时的起始高度：两者间没有 grid 行高过渡，交给布局后补间。 */
  const peekResizeFromRef = useRef<number | null>(null)
  // 挂载时已在思考（实时生成）才让首个状态文字滑入；历史消息静态呈现。
  const [animateFirstLabel] = useState(status === 'working')

  const visibleSteps = useMemo(
    () => steps.filter((step) => step.kind === 'search' || step.text.trim().length > 0),
    [steps],
  )
  // 已入库消息的 steps 引用稳定，整页重渲染时不必重新规范化并拆分全部历史推理文本。
  const rows = useMemo(() => processRowsOf(visibleSteps), [visibleSteps])
  const searchSteps = visibleSteps.filter((step): step is LiveSearchStep => step.kind === 'search')
  const searchActions = searchSteps
    .map((step) => step.action)
    .filter((action): action is SearchAction => action !== null)
  const hasReasoningStep = steps.some((step) => step.kind === 'reasoning')
  const hasReasoning = visibleSteps.some((step) => step.kind === 'reasoning')
  const hasCommentary = visibleSteps.some((step) => step.kind === 'commentary')
  const activeSearch = hasActiveSearch(searchSteps)
  const thinking = status === 'working' && reasoningStarted
  const currentTitle = thinking ? latestSectionTitleOf(rows) : null
  const hasSectionTitles = rows.some((row) => row.kind === 'reasoning' && row.title !== null)
  // 没有小标题的纯文本思考（如 Claude、DeepSeek）折叠时露出末尾几行，作为滚动预览窗。
  const canPeek = status === 'working' && hasReasoning && !hasSectionTitles
  const peeking = canPeek && !open
  // 预览窗收起（开始回答）时须保持限高，grid 行高才会从预览高度收拢，而不是先弹到全文高度。
  const [peekClamped, setPeekClamped] = useState(peeking)
  if (peeking && !peekClamped) setPeekClamped(true)
  if (open && peekClamped) setPeekClamped(false)
  // 点阵一经出现就保持挂载：思考结束时先播收束动画，再收起所占宽度。
  const [glyphMounted, setGlyphMounted] = useState(thinking)
  if (thinking && !glyphMounted) setGlyphMounted(true)

  const captureCollapseAnchor = useCallback(() => {
    const card = cardRef.current
    const sticky = stickyRef.current
    if (!card || !sticky) return
    const scroller = findScrollContainer(card)
    if (!scroller) return
    const scrollerTop = scrollViewportTop(scroller)
    const stickyTop = stickyTopOffset(sticky)
    const stickyEdge = scrollerTop + stickyTop
    const stickyRect = sticky.getBoundingClientRect()
    if (!(stickyRect.top <= stickyEdge + 1 && stickyRect.bottom > stickyEdge)) return
    collapseAnchorRef.current = {
      scroller,
      cardTop: scroller.scrollTop + card.getBoundingClientRect().top - scrollerTop - stickyTop,
    }
  }, [])

  const collapse = useCallback(() => {
    if (!open) return
    captureCollapseAnchor()
    setOpen(false)
  }, [captureCollapseAnchor, open])

  useLayoutEffect(() => {
    if (open) return undefined
    const anchor = collapseAnchorRef.current
    if (!anchor) return undefined
    collapseAnchorRef.current = null
    const restore = () => {
      anchor.scroller.scrollTop = clampScrollTop(anchor.scroller, anchor.cardTop)
    }
    restore()
    const frame = window.requestAnimationFrame(restore)
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    const hasContent = visibleSteps.length > 0
    const answerWasRetracted = previousAnswerStartedRef.current && !answerStarted
    if (
      autoExpand &&
      hasContent &&
      (!hadContentRef.current || answerWasRetracted) &&
      !answerStarted
    ) {
      if (!userToggledRef.current) setOpen(true)
      hadContentRef.current = true
    } else if (!hasContent) {
      hadContentRef.current = false
    }
    previousAnswerStartedRef.current = answerStarted
  }, [answerStarted, autoExpand, visibleSteps.length])

  useLayoutEffect(() => {
    if (answerStarted && !userToggledRef.current) collapse()
  }, [answerStarted, collapse])

  const toggleOpen = useCallback(() => {
    userToggledRef.current = true
    if (canPeek) peekResizeFromRef.current = contentWindowRef.current?.offsetHeight ?? null
    if (open) collapse()
    else setOpen(true)
  }, [canPeek, collapse, open])

  useLayoutEffect(() => {
    const from = peekResizeFromRef.current
    const contentWindow = contentWindowRef.current
    peekResizeFromRef.current = null
    if (from === null || !contentWindow || prefersReducedMotion()) return
    const to = contentWindow.offsetHeight
    if (to === from) return
    contentWindow.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: 300,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    })
  }, [open])

  // 预览窗内容贴底生长：先按增量回推、再平滑归位，像字幕一样持续向上流动。
  useEffect(() => {
    const list = listRef.current
    if (!peeking || !list || prefersReducedMotion()) return undefined
    let lastHeight = list.offsetHeight
    const observer = new ResizeObserver(() => {
      const height = list.offsetHeight
      const grown = height - lastHeight
      lastHeight = height
      if (grown <= 0) return
      // 上一段补间尚未结束时从当前位移续接，连续到达的文字不会抖动。
      const transform = window.getComputedStyle(list).transform
      const offset = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42
      list.getAnimations().forEach((animation) => animation.cancel())
      list.animate(
        [{ transform: `translateY(${offset + grown}px)` }, { transform: 'translateY(0)' }],
        { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      )
    })
    observer.observe(list)
    return () => observer.disconnect()
  }, [peeking])

  const completedSegments = completedSegmentsOf(
    durationMs,
    searchActions,
    hasReasoning || reasoningStarted,
    hasCommentary,
  )
  const searchLabel = status === 'working' && activeSearch ? activeSearchLabelOf(searchSteps) : null
  const thinkingLabel = currentTitle ?? '正在思考'
  const statusLabel: StatusLabel =
    status === 'stopped'
      ? { key: 'stopped', segments: ['已停止思考'], active: false, withTimer: false }
      : searchLabel
        ? {
            key: `search:${searchLabel}`,
            segments: [searchLabel],
            active: true,
            withTimer: thinking,
          }
        : thinking
          ? {
              key: `thinking:${thinkingLabel}`,
              segments: [thinkingLabel],
              active: true,
              withTimer: true,
            }
          : {
              key: `done:${completedSegments.join(' · ')}`,
              segments: completedSegments,
              active: false,
              withTimer: false,
            }
  const animateRows = status === 'working'
  // 结束后耗时未知但已开始思考，状态行同样以「已思考」开头，不再按纯检索放前置图标。
  const pureSearch =
    durationMs == null &&
    !(reasoningStarted && status !== 'working') &&
    !hasReasoningStep &&
    visibleSteps.length > 0 &&
    visibleSteps.every((step) => step.kind === 'search')
  const xOnly =
    searchActions.length > 0 && searchActions.every((action) => isXSearchActionType(action.type))
  const summaryLabel = completedSegments.join(' · ')

  if (visibleSteps.length === 0 && durationMs == null && !reasoningStarted) return null

  return (
    <div ref={cardRef} className="hc-reasoning" data-testid="process-track">
      <div
        ref={stickyRef}
        className={clsx(
          'hc-reasoning-sticky relative sticky',
          stickyTopClassName,
          'z-20 -mx-2 px-2 py-1',
        )}
      >
        <button
          type="button"
          onClick={toggleOpen}
          disabled={visibleSteps.length === 0}
          aria-expanded={open}
          aria-label={open ? '折叠思考过程' : '展开思考过程'}
          className="hc-reasoning-status inline-flex max-w-full items-start gap-2 text-left text-[15px] leading-7 transition-colors disabled:cursor-default"
          data-testid="process-track-toggle"
        >
          {glyphMounted && (
            <span
              className={clsx(
                'hc-reasoning-glyph flex h-7 shrink-0 items-center',
                !thinking && 'hc-reasoning-glyph-leaving',
              )}
              aria-hidden
            >
              <ThinkingGlyph
                phase={thinking ? 'thinking' : 'settling'}
                activity={processActivityOf(visibleSteps)}
                rippleKey={currentTitle}
              />
            </span>
          )}
          {pureSearch && !thinking && (
            <span
              className="flex h-7 shrink-0 items-center"
              aria-hidden
              data-testid="process-track-source-icon"
            >
              {xOnly ? <XLogo className="h-3 w-3" /> : <Globe className="h-3.5 w-3.5" />}
            </span>
          )}
          <StatusTicker
            label={statusLabel}
            startedAt={startedAt}
            animateFirst={animateFirstLabel}
            trailing={
              visibleSteps.length > 0 && (
                <ChevronDown
                  className={clsx(
                    'mt-[7px] h-3.5 w-3.5 shrink-0 transition-transform duration-300',
                    open && 'rotate-180',
                  )}
                />
              )
            }
          />
        </button>
      </div>
      {visibleSteps.length > 0 && (
        <div
          className={clsx(
            'hc-reasoning-collapse grid transition-[grid-template-rows,opacity] duration-300 ease-out',
            open || peeking ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
          aria-hidden={!open}
        >
          <div
            ref={contentWindowRef}
            className={clsx(
              'min-h-0 overflow-hidden',
              peekClamped && 'hc-reasoning-peek',
              peeking && 'cursor-pointer',
            )}
            data-testid={peeking ? 'reasoning-peek' : undefined}
            onClick={peeking ? toggleOpen : undefined}
          >
            <ol ref={listRef} className="space-y-2 pt-2 pr-2 pb-1">
              {rows.map((row) => {
                if (row.kind === 'reasoning') {
                  return (
                    <ReasoningRow
                      key={row.key}
                      title={row.title}
                      body={row.body}
                      animate={animateRows}
                    />
                  )
                }
                if (row.kind === 'commentary') {
                  return <CommentaryRow key={row.key} step={row.step} animate={animateRows} />
                }
                return <SearchRow key={row.key} step={row.step} animate={animateRows} />
              })}
              {status === 'completed' && <SummaryFooter label={summaryLabel} />}
            </ol>
          </div>
        </div>
      )}
    </div>
  )
}
