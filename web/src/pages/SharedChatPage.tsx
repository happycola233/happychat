import { useLayoutEffect, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { AlertCircle, FileText } from 'lucide-react'
import { textFromContent } from '@shared/util/contentText'
import type { ContentPart, UrlCitation } from '@shared/types/domain'
import type { MessageDTO } from '@shared/types/api'
import { getPublicShare, shareAttachmentUrl } from '../api/shares'
import { ImagePreviewTrigger } from '../chat/ImagePreview'
import { Markdown } from '../chat/Markdown'
import { ReasoningCard, type ReasoningCardStatus } from '../chat/ReasoningCard'
import { WebSearchActivity } from '../chat/WebSearchActivity'
import { SHOW_CITATION_SOURCE_CHIPS } from '../chat/citationDisplay'
import { persistedWebSearchCalls } from '../sse/eventReducer'
import {
  CopyMessageButton,
  MessageTimeLabel,
  MessageUsageStats,
} from '../chat/MessageMeta'
import { Spinner } from '../components/ui/Spinner'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { forceSystemTheme, refreshTheme } from '../lib/theme'
import { resolveSharedDocumentTitle } from './sharedDocumentTitle'

type SharedAttachmentPart = Extract<
  ContentPart,
  { type: 'input_image' | 'input_file' | 'image_result' }
>

const SHARE_HEADER_HEIGHT_CLASS = '[--hc-share-header-height:57px]'
const SHARE_REASONING_STICKY_TOP_CLASS = 'top-[var(--hc-share-header-height)]'

function useShareHeaderHeight(active: boolean) {
  const pageRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    if (!active) return undefined
    const page = pageRef.current
    const header = headerRef.current
    if (!page || !header) return undefined

    const syncHeaderHeight = () => {
      page.style.setProperty(
        '--hc-share-header-height',
        `${header.getBoundingClientRect().height}px`,
      )
    }

    syncHeaderHeight()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncHeaderHeight)
      return () => window.removeEventListener('resize', syncHeaderHeight)
    }

    const observer = new ResizeObserver(syncHeaderHeight)
    observer.observe(header)
    return () => observer.disconnect()
  }, [active])

  return { pageRef, headerRef }
}

function useSystemThemeOnSharePage() {
  useLayoutEffect(() => {
    const releaseThemeOverride = forceSystemTheme()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const syncSystemTheme = () => refreshTheme()

    mq.addEventListener('change', syncSystemTheme)
    return () => {
      mq.removeEventListener('change', syncSystemTheme)
      releaseThemeOverride()
    }
  }, [])
}

function attachmentParts(content: ContentPart[]): SharedAttachmentPart[] {
  return content.filter(
    (p): p is SharedAttachmentPart =>
      p.type === 'input_image' || p.type === 'input_file' || p.type === 'image_result',
  )
}

/** 分享页不能用私有附件接口，所有附件链接都走带 token 的公开路由。 */
function SharedAttachmentParts({
  content,
  token,
  align = 'start',
}: {
  content: ContentPart[]
  token: string
  align?: 'start' | 'end'
}) {
  const parts = attachmentParts(content)
  if (parts.length === 0) return null

  return (
    <div className={clsx('flex max-w-[85%] flex-wrap gap-2', align === 'end' && 'justify-end')}>
      {parts.map((p, i) => {
        const url = shareAttachmentUrl(token, p.attachment_id)
        if (p.type === 'input_file') {
          return (
            <a
              key={`${p.type}-${p.attachment_id}-${i}`}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600 transition hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              <FileText className="h-4 w-4 shrink-0" />
              <span className="max-w-[12rem] truncate">{p.filename}</span>
            </a>
          )
        }

        return (
          <ImagePreviewTrigger
            key={`${p.type}-${p.attachment_id}-${i}`}
            src={url}
            alt={p.type === 'image_result' ? '模型生成的图片' : '用户上传的图片'}
            caption={p.type === 'image_result' ? p.revised_prompt : undefined}
            title={p.type === 'image_result' ? p.revised_prompt : undefined}
            className={clsx(
              'overflow-hidden rounded-xl',
              p.type === 'image_result'
                ? 'max-w-full'
                : 'border border-neutral-200 dark:border-neutral-700',
            )}
            imageClassName={clsx(
              'block rounded-xl',
              p.type === 'image_result'
                ? 'max-h-[32rem] max-w-full'
                : 'max-h-44 max-w-[12rem] object-cover',
            )}
          />
        )
      })}
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function Citations({ items }: { items: UrlCitation[] | null }) {
  if (!items?.length) return null
  const seen = new Set<string>()
  const unique = items.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
  if (unique.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {unique.map((c, i) => (
        <a
          key={c.url}
          href={c.url}
          target="_blank"
          rel="noreferrer"
          title={c.title || c.url}
          className="max-w-[16rem] truncate rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 transition hover:text-neutral-800 dark:bg-neutral-800 dark:hover:text-neutral-200"
        >
          {i + 1}. {c.title || hostOf(c.url)}
        </a>
      ))}
    </div>
  )
}

function SharedMessageMeta({
  m,
  text,
  align,
}: {
  m: MessageDTO
  text: string
  align: 'start' | 'end'
}) {
  const modelLabel = m.role === 'assistant' ? (m.modelLabel ?? null) : null
  return (
    <div className={clsx('space-y-1.5', align === 'end' && 'text-right')}>
      <div
        className={clsx(
          'flex flex-wrap items-center gap-1.5 text-neutral-400',
          align === 'end' ? 'justify-end' : 'justify-start',
        )}
      >
        <CopyMessageButton text={text} />
        {modelLabel && <span className="ml-1 text-xs text-neutral-400">{modelLabel}</span>}
        {modelLabel && <span className="text-xs text-neutral-300 dark:text-neutral-600">·</span>}
        <MessageTimeLabel ts={m.createdAt} format="datetime" />
      </div>
      {m.role === 'assistant' && m.usage && (
        <MessageUsageStats usage={m.usage} durationMs={m.generationDurationMs} />
      )}
    </div>
  )
}

function reasoningStatus(m: MessageDTO, text: string): ReasoningCardStatus {
  const stopped =
    m.status === 'interrupted' && m.errorMessage === '已停止生成' && text.trim().length === 0
  return stopped ? 'stopped' : 'completed'
}

function SharedMessage({ m, token }: { m: MessageDTO; token: string }) {
  const text = textFromContent(m.content)

  if (m.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <SharedAttachmentParts content={m.content} token={token} align="end" />
        {text && (
          <div className="max-w-[85%] rounded-2xl bg-neutral-100 px-4 py-2.5 text-[15px] leading-7 whitespace-pre-wrap text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100">
            {text}
          </div>
        )}
        <SharedMessageMeta m={m} text={text} align="end" />
      </div>
    )
  }

  const hasReasoningText = Boolean(m.reasoningSummary?.trim())
  const showReasoningCard = hasReasoningText || m.reasoningDurationMs !== null

  return (
    <div className="space-y-2">
      {showReasoningCard && (
        <ReasoningCard
          text={m.reasoningSummary ?? ''}
          status={reasoningStatus(m, text)}
          startedAt={null}
          durationMs={m.reasoningDurationMs}
          defaultExpanded={hasReasoningText}
          stickyTopClassName={SHARE_REASONING_STICKY_TOP_CLASS}
        />
      )}
      {Boolean(m.webSearchActions?.length) && (
        <WebSearchActivity calls={persistedWebSearchCalls(m.webSearchActions)} answerStarted />
      )}
      {m.status === 'error' && m.errorMessage && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{m.errorMessage}</span>
        </div>
      )}
      {text && <Markdown text={text} />}
      <SharedAttachmentParts content={m.content} token={token} />
      {SHOW_CITATION_SOURCE_CHIPS && <Citations items={m.annotations} />}
      <SharedMessageMeta m={m} text={text} align="start" />
    </div>
  )
}

export default function SharedChatPage() {
  useSystemThemeOnSharePage()

  const { token } = useParams()
  const {
    data: share,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['public-share', token],
    queryFn: () => getPublicShare(token!),
    enabled: !!token,
    retry: false,
  })
  useDocumentTitle(resolveSharedDocumentTitle(share?.title, isError))
  const { pageRef, headerRef } = useShareHeaderHeight(Boolean(share))

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-white dark:bg-black">
        <Spinner className="h-6 w-6 text-neutral-400" />
      </div>
    )
  }

  if (isError || !share) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-white px-4 text-center dark:bg-black">
        <h1 className="text-xl font-semibold text-neutral-800 dark:text-neutral-100">
          分享不存在或已失效
        </h1>
        <Link to="/" className="text-sm text-sky-600 hover:underline dark:text-sky-400">
          前往 HappyChat
        </Link>
      </div>
    )
  }

  return (
    <div
      ref={pageRef}
      className={clsx('min-h-full bg-white dark:bg-black', SHARE_HEADER_HEIGHT_CLASS)}
    >
      <header
        ref={headerRef}
        className="sticky top-0 z-30 min-h-[var(--hc-share-header-height)] border-b border-neutral-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-neutral-800 dark:bg-black/90"
      >
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          {share.owner.avatarUrl ? (
            <img src={share.owner.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
              {share.title ?? '分享的对话'}
            </div>
            {share.owner.name && (
              <div className="truncate text-xs text-neutral-400">来自 {share.owner.name}</div>
            )}
          </div>
          <Link
            to="/"
            className="shrink-0 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
          >
            HappyChat
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        {share.messages.map((m) => (
          <SharedMessage key={m.id} m={m} token={token!} />
        ))}
      </main>

      <footer className="border-t border-neutral-200 py-6 text-center text-xs text-neutral-400 dark:border-neutral-800">
        本页为只读分享 · 由 HappyChat 生成
      </footer>
    </div>
  )
}
