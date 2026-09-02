import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { splitReasoningSections, type ReasoningSection } from './reasoningSections'

export type ProcessTrackStatus = 'working' | 'completed' | 'stopped'

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

interface Props {
  steps: LiveProcessStep[]
  status: ProcessTrackStatus
  startedAt: number | null
  durationMs?: number | null
  reasoningEnabled: boolean
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

function ReasoningRow({ section, animate }: { section: ReasoningSection; animate: boolean }) {
  const hasBody = section.body.trim().length > 0
  return (
    <li
      className={clsx(
        'hc-reasoning-section grid grid-cols-[14px_minmax(0,1fr)] gap-x-2',
        animate && 'hc-reasoning-step-in',
      )}
    >
      {section.title && (
        <>
          <span
            aria-hidden
            className={clsx(
              'mt-[0.55rem] h-1.5 w-1.5 justify-self-center rounded-full bg-neutral-500 dark:bg-neutral-400',
              animate && 'hc-reasoning-dot-in',
            )}
          />
          <div className="text-sm leading-6 font-medium text-neutral-950 dark:text-neutral-100">
            {animate ? <AnimatedSectionTitle text={section.title} /> : section.title}
          </div>
        </>
      )}
      {(hasBody || !section.title) && (
        <>
          <span
            aria-hidden
            className={clsx(
              'w-px justify-self-center bg-neutral-300 dark:bg-neutral-600',
              section.title && 'mt-1',
            )}
          />
          <div className={clsx('min-w-0', section.title && 'mt-1')}>
            {hasBody && (
              <Markdown
                text={section.body}
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
}

function CommentaryRow({
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
}

function SearchRow({ step, animate }: { step: LiveSearchStep; animate: boolean }) {
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
  hasReasoning: boolean,
  hasCommentary: boolean,
): string[] {
  const searchPhrases = searchSummaryPhrases(actions)
  if (durationMs !== null && durationMs !== undefined) {
    return [`已思考 ${Math.max(0, Math.floor(durationMs / 1000))}s`, ...searchPhrases]
  }
  if (searchPhrases.length > 0) return [`已${searchPhrases[0]}`, ...searchPhrases.slice(1)]
  if (hasReasoning) return ['已完成思考']
  return [hasCommentary ? '已完成处理' : '已完成']
}

function StatusSegments({ segments, active }: { segments: string[]; active: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5" data-testid="process-track-label">
      {segments.map((segment, index) =>
        index === 0 ? (
          <span key={index} className={clsx('whitespace-nowrap', active && 'hc-reasoning-shimmer')}>
            {segment}
          </span>
        ) : (
          <span key={index} className="inline-flex gap-x-1.5 whitespace-nowrap">
            <span aria-hidden>·</span>
            <span className={clsx(active && 'hc-reasoning-shimmer')}>{segment}</span>
          </span>
        ),
      )}
    </span>
  )
}

/** 秒表独立更新，避免每次跨秒都重渲染时间线并重启流式入场动画。 */
function ThinkingStatusSegments({ startedAt }: { startedAt: number | null }) {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    setSeconds(elapsedSeconds(startedAt))
    const timer = setInterval(() => setSeconds(elapsedSeconds(startedAt)), 200)
    return () => clearInterval(timer)
  }, [startedAt])

  return <StatusSegments segments={[`正在思考 ${seconds}s`]} active />
}

export function ProcessTrack({
  steps,
  status,
  startedAt,
  durationMs,
  reasoningEnabled,
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

  const visibleSteps = useMemo(
    () =>
      steps.filter(
        (step) =>
          step.kind === 'search' ||
          (step.kind === 'reasoning' ? step.text.trim().length > 0 : step.text.trim().length > 0),
      ),
    [steps],
  )
  const searchSteps = visibleSteps.filter((step): step is LiveSearchStep => step.kind === 'search')
  const searchActions = searchSteps
    .map((step) => step.action)
    .filter((action): action is SearchAction => action !== null)
  const hasReasoningStep = steps.some((step) => step.kind === 'reasoning')
  const hasReasoning = visibleSteps.some((step) => step.kind === 'reasoning')
  const hasCommentary = visibleSteps.some((step) => step.kind === 'commentary')
  const activeSearch = hasActiveSearch(searchSteps)

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
    if (open) collapse()
    else setOpen(true)
  }, [collapse, open])

  const completedSegments = completedSegmentsOf(
    durationMs,
    searchActions,
    hasReasoning,
    hasCommentary,
  )
  const showThinkingTimer = status === 'working' && !activeSearch && reasoningEnabled
  const segments =
    status === 'stopped'
      ? ['已停止思考']
      : status === 'working' && activeSearch
        ? [activeSearchLabelOf(searchSteps)]
        : completedSegments
  const activelyWorking = status === 'working' && (activeSearch || reasoningEnabled)
  const pureSearch =
    durationMs == null &&
    !hasReasoningStep &&
    visibleSteps.length > 0 &&
    visibleSteps.every((step) => step.kind === 'search')
  const xOnly =
    searchActions.length > 0 && searchActions.every((action) => isXSearchActionType(action.type))
  const label = completedSegments.join(' · ')

  if (
    visibleSteps.length === 0 &&
    durationMs == null &&
    !(status === 'working' && reasoningEnabled)
  ) {
    return null
  }

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
          className="hc-reasoning-status inline-flex items-start gap-2 text-left text-[15px] leading-7 transition-colors disabled:cursor-default"
          data-testid="process-track-toggle"
        >
          {pureSearch && (
            <span
              className="flex h-7 shrink-0 items-center"
              aria-hidden
              data-testid="process-track-source-icon"
            >
              {xOnly ? <XLogo className="h-3 w-3" /> : <Globe className="h-3.5 w-3.5" />}
            </span>
          )}
          {showThinkingTimer ? (
            <ThinkingStatusSegments startedAt={startedAt} />
          ) : (
            <StatusSegments segments={segments} active={activelyWorking} />
          )}
          {visibleSteps.length > 0 && (
            <ChevronDown
              className={clsx(
                'mt-[7px] h-3.5 w-3.5 shrink-0 transition-transform duration-300',
                open && 'rotate-180',
              )}
            />
          )}
        </button>
      </div>
      {visibleSteps.length > 0 && (
        <div
          className={clsx(
            'hc-reasoning-collapse grid transition-[grid-template-rows,opacity] duration-300 ease-out',
            open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
          aria-hidden={!open}
        >
          <div className="min-h-0 overflow-hidden">
            <ol className="space-y-2 pt-2 pr-2 pb-1">
              {visibleSteps.flatMap((step) => {
                if (step.kind === 'reasoning') {
                  const normalized = normalizeReasoningMarkdown(step.text)
                  return splitReasoningSections(normalized).map((section, index) => (
                    <ReasoningRow
                      key={`${step.id}-${index}`}
                      section={section}
                      animate={status === 'working'}
                    />
                  ))
                }
                if (step.kind === 'commentary') {
                  return [
                    <CommentaryRow key={step.id} step={step} animate={status === 'working'} />,
                  ]
                }
                return [<SearchRow key={step.id} step={step} animate={status === 'working'} />]
              })}
              {status === 'completed' && <SummaryFooter label={label} />}
            </ol>
          </div>
        </div>
      )}
    </div>
  )
}
