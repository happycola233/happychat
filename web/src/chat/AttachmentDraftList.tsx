import { FileText, X } from 'lucide-react'
import { clsx } from 'clsx'
import { attachmentUrl } from '../api/attachments'
import { ImagePreviewTrigger } from './ImagePreview'
import type { AttachmentDraftItem } from './attachmentDraft'

interface AttachmentDraftListProps {
  items: AttachmentDraftItem[]
  onRemove: (draftId: string) => void
  className?: string
  testId?: string
}

/** Compact attachment chips shared by the composer and inline message editor. */
export function AttachmentDraftList({
  items,
  onRemove,
  className,
  testId = 'attachment-draft-chip',
}: AttachmentDraftListProps) {
  if (items.length === 0) return null

  return (
    <div className={clsx('flex flex-wrap gap-2', className)}>
      {items.map((item) => (
        <div
          key={item.draftId}
          data-testid={testId}
          data-attachment-kind={item.kind}
          data-retained={item.retained ? 'true' : 'false'}
          className={clsx(
            'group relative flex min-w-0 items-center gap-1.5 rounded-lg border bg-neutral-50 p-1',
            'border-neutral-200 dark:border-neutral-700 dark:bg-neutral-900',
            item.retained &&
              'border-blue-200 bg-blue-50/70 dark:border-blue-900/70 dark:bg-blue-950/25',
          )}
        >
          {item.kind === 'image' ? (
            <ImagePreviewTrigger
              src={attachmentUrl(item.attachmentId)}
              alt={item.filename || '待发送图片'}
              caption={item.filename}
              className="h-10 w-10 overflow-hidden rounded"
              imageClassName="block h-10 w-10 object-cover"
            />
          ) : (
            <span className="flex min-w-0 items-center gap-1.5 px-1.5 text-xs text-neutral-600 dark:text-neutral-300">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="max-w-[8rem] truncate">{item.filename}</span>
            </span>
          )}
          {item.retained && (
            <span className="rounded px-1.5 py-0.5 text-[11px] leading-none text-blue-600 dark:text-blue-300">
              已保留
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(item.draftId)}
            className="rounded p-0.5 text-neutral-400 transition hover:text-red-500"
            aria-label="移除附件"
            title="移除附件"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
