import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown } from 'lucide-react'
import {
  getUserMessageEditVisibleHeight,
  USER_MESSAGE_TEXT_CLASS,
} from './messageStyles'

// P4：纯文本渲染（保留换行）。助手消息走 Markdown 组件，用户消息用这里。
export function MessageText({ text }: { text: string }) {
  return (
    <div className={clsx(USER_MESSAGE_TEXT_CLASS, 'break-words whitespace-pre-wrap')}>
      {text}
    </div>
  )
}

export function CollapsibleUserMessageText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const [canCollapse, setCanCollapse] = useState(false)
  const [collapsedHeight, setCollapsedHeight] = useState(() =>
    getUserMessageEditVisibleHeight(window.innerHeight),
  )
  const contentRef = useRef<HTMLDivElement>(null)

  const measure = useCallback(() => {
    const el = contentRef.current
    if (!el) return
    const nextHeight = el.scrollHeight
    setCanCollapse(nextHeight > collapsedHeight + 1)
  }, [collapsedHeight])

  useLayoutEffect(() => {
    setExpanded(false)
  }, [text])

  useLayoutEffect(() => {
    measure()
  }, [measure, text])

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }

    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])

  useLayoutEffect(() => {
    const updateCollapsedHeight = () => {
      setCollapsedHeight(getUserMessageEditVisibleHeight(window.innerHeight))
    }

    window.addEventListener('resize', updateCollapsedHeight)
    return () => window.removeEventListener('resize', updateCollapsedHeight)
  }, [])

  const collapsed = canCollapse && !expanded

  return (
    <div>
      <div className="relative">
        <div
          ref={contentRef}
          style={collapsed ? { maxHeight: collapsedHeight } : undefined}
          className={clsx('overflow-hidden transition-[max-height] duration-200 ease-out')}
        >
          <MessageText text={text} />
        </div>
        {collapsed && (
          <div className="hc-user-message-fade pointer-events-none absolute inset-x-0 bottom-0 h-14" />
        )}
      </div>
      {canCollapse && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 inline-flex items-center gap-1 text-sm text-neutral-500 transition hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          {expanded ? '收起' : '展开'}
          <ChevronDown
            className={clsx('h-4 w-4 transition-transform duration-200', expanded && 'rotate-180')}
          />
        </button>
      )}
    </div>
  )
}
