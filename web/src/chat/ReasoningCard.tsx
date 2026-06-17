import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Brain, ChevronDown } from 'lucide-react'

interface Props {
  text: string
  /** 是否正在思考（流式且尚无正文） */
  thinking: boolean
}

export function ReasoningCard({ text, thinking }: Props) {
  const [seconds, setSeconds] = useState(0)
  const [open, setOpen] = useState(thinking)
  const startRef = useRef<number | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (thinking) {
      if (startRef.current === null) startRef.current = Date.now()
      setOpen(true)
      const t = setInterval(() => {
        setSeconds(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000))
      }, 200)
      return () => clearInterval(t)
    }
    setOpen(false)
    return undefined
  }, [thinking])

  // 思考中自动滚动到底部
  useEffect(() => {
    if (thinking && open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [text, thinking, open])

  const label = thinking
    ? `正在思考 ${seconds}s`
    : seconds > 0
      ? `已深度思考 ${seconds}s`
      : '思考过程'

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
      {open && text && (
        <div
          ref={bodyRef}
          className="max-h-64 overflow-y-auto border-t border-neutral-100 px-3 py-2 text-sm leading-6 break-words whitespace-pre-wrap text-neutral-500 dark:border-neutral-700/50"
        >
          {text}
        </div>
      )}
    </div>
  )
}
