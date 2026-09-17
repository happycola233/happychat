import { useEffect, useRef } from 'react'
import { ArrowUpRight, X } from 'lucide-react'

export function ContextSuggestionPopover({
  tokens,
  onOpen,
  onDismiss,
}: {
  tokens: number
  onOpen: () => void
  onDismiss: () => void
}) {
  const panelRef = useRef<HTMLElement>(null)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissRef.current()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) dismissRef.current()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])
  return (
    <aside
      ref={panelRef}
      aria-label="上下文优化建议"
      className="hc-pop-in absolute right-0 top-[calc(100%+0.625rem)] w-[min(22rem,calc(100vw-2rem))] rounded-2xl bg-white p-4 shadow-[0_6px_32px_-8px_rgba(0,0,0,0.18)] ring-1 ring-black/5 dark:bg-[#242424] dark:shadow-[0_8px_32px_-6px_rgba(0,0,0,0.5)] dark:ring-white/10"
    >
      {/* 浮层跟随整个顶栏工具组，箭头指向最左侧的上下文优化按钮。 */}
      <span
        aria-hidden
        className="absolute -top-1 right-[5.25rem] h-2 w-2 rotate-45 bg-white ring-1 ring-black/5 [clip-path:polygon(-25%_-25%,125%_-25%,-25%_125%)] dark:bg-[#242424] dark:ring-white/10"
      />
      <div className="flex items-start justify-between gap-2">
        <div aria-live="polite" className="min-w-0">
          <p className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
            建议优化上下文
          </p>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            上次请求输入{' '}
            <span className="font-medium tabular-nums text-neutral-700 dark:text-neutral-200">
              {tokens.toLocaleString()} Token
            </span>
          </p>
        </div>
        <button
          type="button"
          aria-label="关闭上下文优化建议"
          title="当前标签页内不再提醒此对话"
          onClick={onDismiss}
          className="-mr-1.5 -mt-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/50 dark:hover:bg-white/5"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-2.5 text-xs leading-5 text-neutral-600 dark:text-neutral-300">
        合理调整历史消息与附件的携带范围，可减少后续请求的数据传输与处理量，从而缩短响应时间，并帮助模型持续聚焦于您的最新需求。您的聊天记录和原始附件仍保存在聊天中。
      </p>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
          模型返回的实际用量
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="-mr-1 inline-flex min-h-8 items-center gap-1 rounded-lg px-1 text-xs font-medium text-sky-600 hover:text-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 dark:text-sky-400 dark:hover:text-sky-300"
        >
          优化上下文 <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </aside>
  )
}
