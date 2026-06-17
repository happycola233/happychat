import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Brain, ChevronDown } from 'lucide-react'
import { Markdown } from './Markdown'
import { elapsedSeconds } from './elapsed'
import { normalizeReasoningMarkdown } from './reasoningMarkdown'

interface Props {
  text: string
  /** 是否正在思考（流式且尚无正文） */
  thinking: boolean
  /** 上游开始响应的时间，用于刷新续传后保持计时 */
  startedAt: number | null
  /** 完成后的思考耗时；刷新后的持久化消息由服务端计算。 */
  durationMs?: number | null
}

export function ReasoningCard({ text, thinking, startedAt, durationMs }: Props) {
  const [seconds, setSeconds] = useState(0)
  const [open, setOpen] = useState(thinking)
  const bodyRef = useRef<HTMLDivElement>(null)
  const normalizedText = normalizeReasoningMarkdown(text)
  const hasText = normalizedText.trim().length > 0

  useEffect(() => {
    if (thinking) {
      setOpen(true)
      setSeconds(elapsedSeconds(startedAt))
      const t = setInterval(() => {
        setSeconds(elapsedSeconds(startedAt))
      }, 200)
      return () => clearInterval(t)
    }
    setOpen(false)
    return undefined
  }, [thinking, startedAt])

  // 思考中自动滚动到底部
  useEffect(() => {
    if (thinking && open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [normalizedText, thinking, open])

  const completedSeconds =
    durationMs !== undefined && durationMs !== null
      ? Math.max(0, Math.floor(durationMs / 1000))
      : seconds
  const label = thinking ? `正在思考 ${seconds}s` : `已思考 ${completedSeconds}s`

  return (
    <div className="overflow-hidden rounded-xl bg-neutral-50 dark:bg-neutral-800/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-sm text-neutral-500 transition hover:text-neutral-700 dark:hover:text-neutral-300"
      >
        <Brain className={clsx('h-3.5 w-3.5', thinking && 'animate-pulse')} />
        <span className={clsx(thinking && 'animate-pulse')}>{label}</span>
        <ChevronDown className={clsx('ml-auto h-3.5 w-3.5 transition', open && 'rotate-180')} />
      </button>
      {open && hasText && (
        <div
          ref={bodyRef}
          className="hc-scrollbar max-h-64 overflow-y-auto border-t border-neutral-100 px-3 py-2 dark:border-neutral-700/50"
        >
          <Markdown text={normalizedText} variant="reasoning" />
        </div>
      )}
    </div>
  )
}
