import { useState } from 'react'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Pencil,
  RefreshCw,
} from 'lucide-react'
import type { MessageDTO } from '@shared/types/api'
import type { UrlCitation } from '@shared/types/domain'
import type { LiveMessage } from '../sse/eventReducer'
import { attachmentUrl } from '../api/attachments'
import { Spinner } from '../components/ui/Spinner'
import { useModels } from '../hooks/useModels'
import { useSettings } from '../store/settings'
import { CollapsibleUserMessageText } from './MessageContent'
import { MESSAGE_BODY_TEXT_CLASS } from './messageStyles'
import { textFromContent } from './contentText'
import { Markdown } from './Markdown'
import { ReasoningCard, type ReasoningCardStatus } from './ReasoningCard'
import { AttachmentParts } from './Attachments'
import { ElapsedLabel } from './ElapsedLabel'
import {
  CopyMessageButton,
  MessageIconButton,
  MessageTimeLabel,
  MessageUsageStats,
} from './MessageMeta'
import type { ImageEditSource } from './imageSource'

export interface BranchInfo {
  index: number
  total: number
  siblings: MessageDTO[]
  onSelect: (messageId: string) => void
}

interface Props {
  message: MessageDTO
  live?: LiveMessage
  branch?: BranchInfo
  busy?: boolean
  onEdit?: (text: string) => void
  onRegenerate?: () => void
  onUseImageSource?: (source: ImageEditSource) => void
}

function StreamingCursor() {
  return (
    <span className="ml-0.5 inline-block h-[1.05em] w-[3px] translate-y-[3px] animate-pulse rounded-full bg-neutral-500" />
  )
}

function BranchSwitch({ branch }: { branch: BranchInfo }) {
  const go = (delta: number) => {
    const next = branch.index + delta
    const target = branch.siblings[next]
    if (target) branch.onSelect(target.id)
  }
  return (
    <div className="flex items-center text-xs text-neutral-400">
      <button
        onClick={() => go(-1)}
        disabled={branch.index <= 0}
        className="rounded p-0.5 disabled:opacity-30"
        aria-label="上一个分支"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="tabular-nums">
        {branch.index + 1} / {branch.total}
      </span>
      <button
        onClick={() => go(1)}
        disabled={branch.index >= branch.total - 1}
        className="rounded p-0.5 disabled:opacity-30"
        aria-label="下一个分支"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function Citations({ items }: { items: UrlCitation[] }) {
  const seen = new Set<string>()
  const unique = items.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
  if (!unique.length) return null
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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function Message({
  message,
  live,
  branch,
  busy,
  onEdit,
  onRegenerate,
  onUseImageSource,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const showMessageTime = useSettings((s) => s.preferences.showMessageTime)
  const messageTimeFormat = useSettings((s) => s.preferences.messageTimeFormat)
  const showModelLabel = useSettings((s) => s.preferences.showModelLabel)
  const showUsageStats = useSettings((s) => s.preferences.showUsageStats)
  const defaultExpandReasoning = useSettings((s) => s.preferences.defaultExpandReasoning)
  const models = useModels().data
  const modelName = message.modelLabel ?? models?.find((m) => m.id === message.modelId)?.displayName ?? null

  if (message.role === 'user') {
    const text = textFromContent(message.content)
    if (editing) {
      const submitEdit = () => {
        const t = draft.trim()
        if (t) {
          onEdit?.(t)
          setEditing(false)
        }
      }
      return (
        <div className="flex justify-end">
          <div className="w-full max-w-[85%] rounded-3xl bg-neutral-100 px-4 py-3.5 dark:bg-neutral-800">
            <textarea
              autoFocus
              data-testid="edit-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  submitEdit()
                }
              }}
              className={`${MESSAGE_BODY_TEXT_CLASS} min-h-[4.5rem] w-full resize-none bg-transparent outline-none`}
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={() => setEditing(false)}
                className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50 dark:bg-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-600"
              >
                取消
              </button>
              <button
                data-testid="edit-submit"
                onClick={submitEdit}
                className="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                发送
              </button>
            </div>
          </div>
        </div>
      )
    }
    const hasAtt = message.content.some((p) => p.type === 'input_image' || p.type === 'input_file')
    return (
      <div className="group flex flex-col items-end gap-1.5">
        {hasAtt && (
          <div className="flex max-w-[85%] flex-wrap justify-end">
            <AttachmentParts content={message.content} />
          </div>
        )}
        {text && (
          <div className="max-w-[85%] rounded-2xl bg-neutral-100 px-4 py-2.5 dark:bg-neutral-800">
            <CollapsibleUserMessageText text={text} />
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
            {branch && branch.total > 1 && <BranchSwitch branch={branch} />}
            <CopyMessageButton text={text} />
            {onEdit && (
              <MessageIconButton
                title="编辑"
                disabled={busy}
                onClick={() => {
                  setDraft(text)
                  setEditing(true)
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </MessageIconButton>
            )}
          </div>
          {showMessageTime && <MessageTimeLabel ts={message.createdAt} format={messageTimeFormat} />}
        </div>
      </div>
    )
  }

  // assistant
  const streaming = live?.status === 'streaming'
  const text = live ? live.text : textFromContent(message.content)
  const reasoning = live ? live.reasoning : message.reasoningSummary
  const hasReasoningText = Boolean(reasoning?.trim())
  const annotations = live ? live.annotations : (message.annotations ?? [])
  const error =
    live?.error ?? (message.status === 'error' ? (message.errorMessage ?? '生成失败') : null)
  const liveThinking = Boolean(
    live?.reasoningEnabled && streaming && !text && live.upstreamStartedAt,
  )
  const liveStoppedThinking = Boolean(live?.reasoningEnabled && live.status === 'canceled' && !text)
  const persistedStoppedThinking = Boolean(
    !live && message.status === 'interrupted' && message.errorMessage === '已停止生成' && !text,
  )
  const hasCompletedReasoning = Boolean(
    live
      ? live.reasoningEnabled && live.reasoningDurationMs !== null
      : message.reasoningDurationMs !== null,
  )
  const reasoningStatus: ReasoningCardStatus =
    liveStoppedThinking || persistedStoppedThinking
      ? 'stopped'
      : liveThinking
        ? 'thinking'
        : 'completed'
  const showReasoningCard =
    hasReasoningText || liveThinking || liveStoppedThinking || persistedStoppedThinking || hasCompletedReasoning
  const showPendingDots = streaming && !text && !reasoning && !showReasoningCard

  return (
    <div className="group space-y-2" data-testid="assistant-message">
      {showReasoningCard && (
        <ReasoningCard
          text={reasoning || ''}
          status={reasoningStatus}
          startedAt={live?.upstreamStartedAt ?? null}
          durationMs={live ? live.reasoningDurationMs : message.reasoningDurationMs}
          defaultExpanded={defaultExpandReasoning}
        />
      )}
      {error ? (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : live?.imageStatus ? (
        live.imageAttachmentId ? (
          <a href={attachmentUrl(live.imageAttachmentId)} target="_blank" rel="noreferrer">
            <img
              src={attachmentUrl(live.imageAttachmentId)}
              alt="生成的图片"
              className="max-h-96 rounded-xl border border-neutral-200 dark:border-neutral-700"
            />
          </a>
        ) : (
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <Spinner className="h-4 w-4" />
            <ElapsedLabel
              prefix="正在生成图片"
              startedAt={live.imageStartedAt}
              active={streaming}
            />
          </div>
        )
      ) : showPendingDots ? (
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-400" />
        </div>
      ) : text ? (
        <div>
          <Markdown text={text} />
          {streaming && <StreamingCursor />}
        </div>
      ) : null}
      {message.content.some((p) => p.type === 'image_result') && (
        <AttachmentParts content={message.content} onUseImageSource={onUseImageSource} />
      )}
      {annotations.length > 0 && <Citations items={annotations} />}
      {!streaming && !error && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-neutral-400">
            {branch && branch.total > 1 && <BranchSwitch branch={branch} />}
            <CopyMessageButton text={text} />
            {onRegenerate && (
              <MessageIconButton title="重新生成" disabled={busy} onClick={onRegenerate}>
                <RefreshCw className="h-3.5 w-3.5" />
              </MessageIconButton>
            )}
            {showModelLabel && modelName && (
              <span className="ml-1 text-xs text-neutral-400">{modelName}</span>
            )}
            {showMessageTime && (
              <>
                {showModelLabel && modelName && <span className="text-xs text-neutral-300 dark:text-neutral-600">·</span>}
                <MessageTimeLabel ts={message.createdAt} format={messageTimeFormat} />
              </>
            )}
          </div>
          {showUsageStats && message.usage && (
            <MessageUsageStats usage={message.usage} durationMs={message.generationDurationMs} />
          )}
        </div>
      )}
    </div>
  )
}
