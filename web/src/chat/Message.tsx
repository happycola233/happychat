import { useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Globe,
  Pencil,
  RefreshCw,
} from 'lucide-react'
import type { MessageDTO } from '@shared/types/api'
import type { UrlCitation } from '@shared/types/domain'
import type { LiveMessage } from '../sse/eventReducer'
import { attachmentUrl } from '../api/attachments'
import { Spinner } from '../components/ui/Spinner'
import { toast } from '../store/toast'
import { MessageText } from './MessageContent'
import { textFromContent } from './contentText'
import { Markdown } from './Markdown'
import { ReasoningCard } from './ReasoningCard'
import { AttachmentParts } from './Attachments'

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
}

function StreamingCursor() {
  return (
    <span className="ml-0.5 inline-block h-[1.05em] w-[3px] translate-y-[3px] animate-pulse rounded-full bg-neutral-500" />
  )
}

function IconButton({
  title,
  onClick,
  children,
  disabled,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
    >
      {children}
    </button>
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
        {branch.index + 1}/{branch.total}
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

function useCopy() {
  const [copied, setCopied] = useState(false)
  const copy = (text: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => toast.error('复制失败'))
  }
  return { copied, copy }
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

export function Message({ message, live, branch, busy, onEdit, onRegenerate }: Props) {
  const { copied, copy } = useCopy()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (message.role === 'user') {
    const text = textFromContent(message.content)
    if (editing) {
      return (
        <div className="flex justify-end">
          <div className="w-full max-w-[85%] rounded-2xl border border-neutral-300 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-800">
            <textarea
              autoFocus
              data-testid="edit-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[60px] w-full resize-none bg-transparent text-[15px] text-neutral-800 outline-none dark:text-neutral-100"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                取消
              </button>
              <button
                data-testid="edit-submit"
                onClick={() => {
                  const t = draft.trim()
                  if (t) {
                    onEdit?.(t)
                    setEditing(false)
                  }
                }}
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-white dark:text-neutral-900"
              >
                发送
              </button>
            </div>
          </div>
        </div>
      )
    }
    const hasAtt = message.content.some(
      (p) => p.type === 'input_image' || p.type === 'input_file',
    )
    return (
      <div className="group flex flex-col items-end gap-1.5">
        {hasAtt && (
          <div className="flex max-w-[85%] flex-wrap justify-end">
            <AttachmentParts content={message.content} />
          </div>
        )}
        {text && (
          <div className="max-w-[85%] rounded-2xl bg-neutral-100 px-4 py-2.5 dark:bg-neutral-800">
            <MessageText text={text} />
          </div>
        )}
        <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
          {branch && branch.total > 1 && <BranchSwitch branch={branch} />}
          <IconButton title="复制" onClick={() => copy(text)}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </IconButton>
          {onEdit && (
            <IconButton
              title="编辑"
              disabled={busy}
              onClick={() => {
                setDraft(text)
                setEditing(true)
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </div>
      </div>
    )
  }

  // assistant
  const streaming = live?.status === 'streaming'
  const text = live ? live.text : textFromContent(message.content)
  const reasoning = live ? live.reasoning : message.reasoningSummary
  const annotations = live ? live.annotations : (message.annotations ?? [])
  const error =
    live?.error ?? (message.status === 'error' ? (message.errorMessage ?? '生成失败') : null)
  const webSearching = live?.webSearching ?? false
  const showPendingDots = streaming && !text && !reasoning && !webSearching

  return (
    <div className="group space-y-2" data-testid="assistant-message">
      {reasoning && <ReasoningCard text={reasoning} thinking={streaming && !text} />}
      {webSearching && (
        <div className="flex items-center gap-1.5 text-sm text-neutral-400">
          <Globe className="h-3.5 w-3.5" /> 正在联网搜索…
        </div>
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
            <Spinner className="h-4 w-4" /> 正在生成图片…
          </div>
        )
      ) : showPendingDots ? (
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-400" />
        </div>
      ) : (
        <div>
          <Markdown text={text} />
          {streaming && <StreamingCursor />}
        </div>
      )}
      {message.content.some((p) => p.type === 'image_result') && (
        <AttachmentParts content={message.content} />
      )}
      {annotations.length > 0 && <Citations items={annotations} />}
      {!streaming && !error && (
        <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
          {branch && branch.total > 1 && <BranchSwitch branch={branch} />}
          <IconButton title="复制" onClick={() => copy(text)}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </IconButton>
          {onRegenerate && (
            <IconButton title="重新生成" disabled={busy} onClick={onRegenerate}>
              <RefreshCw className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </div>
      )}
    </div>
  )
}
