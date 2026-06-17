import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Search, X } from 'lucide-react'
import type { ConversationDTO, ConversationSearchResultDTO } from '@shared/types/api'
import { searchConversations } from '../api/chat'
import { ChatBubbleIcon, NewChatIcon } from './icons'

interface Props {
  open: boolean
  conversations: ConversationDTO[]
  onClose: () => void
  onNewChat: () => void
  onOpenConversation: (id: string) => void
}

function titleOf(conversation: ConversationDTO): string {
  return conversation.title ?? '新聊天'
}

function useDebouncedValue(value: string, delayMs: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

function HighlightedText({ text, query }: { text: string; query?: string }) {
  const needle = query?.trim()
  if (!needle) return text

  const lowerText = text.toLocaleLowerCase()
  const lowerNeedle = needle.toLocaleLowerCase()
  const parts: React.ReactNode[] = []
  let cursor = 0

  while (cursor < text.length) {
    const index = lowerText.indexOf(lowerNeedle, cursor)
    if (index === -1) break
    if (index > cursor) parts.push(text.slice(cursor, index))
    const end = index + needle.length
    parts.push(
      <mark
        key={`${index}-${end}`}
        data-testid="search-highlight"
        className="rounded bg-amber-200/80 px-0.5 text-inherit dark:bg-amber-500/30"
      >
        {text.slice(index, end)}
      </mark>,
    )
    cursor = end
  }

  if (parts.length === 0) return text
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

function SearchItem({
  title,
  snippet,
  onClick,
  muted,
  highlight,
}: {
  title: string
  snippet?: string
  onClick: () => void
  muted?: boolean
  highlight?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-lg px-3.5 py-2.5 text-left transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
    >
      <ChatBubbleIcon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-900 dark:text-neutral-100" />
      <span className="min-w-0">
        <span className="block truncate text-[14px] text-neutral-900 dark:text-neutral-100">
          <HighlightedText text={title} query={highlight} />
        </span>
        {snippet && (
          <span
            className={clsx(
              'mt-0.5 block truncate text-xs',
              muted ? 'text-neutral-400' : 'text-neutral-500 dark:text-neutral-400',
            )}
          >
            <HighlightedText text={snippet} query={highlight} />
          </span>
        )}
      </span>
    </button>
  )
}

function ResultItem({
  result,
  onOpenConversation,
  highlight,
}: {
  result: ConversationSearchResultDTO
  onOpenConversation: (id: string) => void
  highlight: string
}) {
  return (
    <SearchItem
      title={titleOf(result.conversation)}
      snippet={result.snippet}
      highlight={highlight}
      onClick={() => onOpenConversation(result.conversation.id)}
    />
  )
}

export function SearchDialog({
  open,
  conversations,
  onClose,
  onNewChat,
  onOpenConversation,
}: Props) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query.trim(), 180)
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const recent = useMemo(() => conversations.slice(0, 6), [conversations])
  const hasQuery = debouncedQuery.length > 0
  const search = useQuery({
    queryKey: ['conversation-search', debouncedQuery],
    queryFn: () => searchConversations(debouncedQuery),
    enabled: open && hasQuery,
  })

  useEffect(() => {
    if (!open) return
    setQuery('')
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => returnFocusRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/10 px-4 pt-12 backdrop-blur-[1px] dark:bg-black/50"
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="搜索聊天"
        data-testid="search-dialog"
        className="hc-scrollbar max-h-[72vh] w-full max-w-[680px] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-neutral-200 px-5 dark:border-neutral-800">
          <Search className="h-4 w-4 shrink-0 text-neutral-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索聊天..."
            data-testid="search-input"
            className="min-w-0 flex-1 bg-transparent text-lg text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="hc-scrollbar max-h-[calc(72vh-3.5rem)] overflow-y-auto px-2.5 py-2.5">
          {!query.trim() ? (
            <>
              <button
                type="button"
                onClick={onNewChat}
                className="mb-2.5 flex w-full items-center gap-2.5 rounded-lg bg-neutral-100 px-3.5 py-2.5 text-left text-[14px] text-neutral-900 transition hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
              >
                <NewChatIcon className="h-4 w-4" />
                新聊天
              </button>
              <div className="px-3.5 pb-2.5 text-xs text-neutral-400">今天</div>
              {recent.map((conversation) => (
                <SearchItem
                  key={conversation.id}
                  title={titleOf(conversation)}
                  onClick={() => onOpenConversation(conversation.id)}
                />
              ))}
            </>
          ) : search.isLoading || query.trim() !== debouncedQuery ? (
            <div className="px-3.5 py-6 text-sm text-neutral-400">搜索中...</div>
          ) : search.data?.length ? (
            search.data.map((result) => (
              <ResultItem
                key={`${result.conversation.id}-${result.messageId ?? 'title'}`}
                result={result}
                highlight={debouncedQuery}
                onOpenConversation={onOpenConversation}
              />
            ))
          ) : (
            <div className="px-3.5 py-6 text-sm text-neutral-400">没有找到聊天</div>
          )}
        </div>
      </div>
    </div>
  )
}
