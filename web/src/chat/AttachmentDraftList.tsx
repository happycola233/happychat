import { FileText, RotateCcw, X } from 'lucide-react'
import { clsx } from 'clsx'
import { attachmentUrl } from '../api/attachments'
import { ImagePreviewTrigger } from './ImagePreview'
import type { AttachmentDraftItem } from './attachmentDraft'
import { fileTypeLabel, formatByteSize, type UploadDraftItem } from './uploadDraft'

/** 上屏卡片的统一视图模型：已就绪草稿与上传中/失败项共用同一套渲染。 */
interface AttachmentTile {
  key: string
  kind: 'image' | 'file'
  filename: string
  byteSize: number | null
  mime: string | null
  retained: boolean
  /** ready＝可直接发送（既有草稿或已完成上传）；uploading/error 为在途/失败上传。 */
  status: 'ready' | 'uploading' | 'error'
  progress: number
  errorMessage: string | null
  /** 图片预览地址：上传项优先本地 object URL（选中即可看），就绪草稿用服务端地址。 */
  previewSrc: string | null
  onRemove: () => void
  onRetry?: () => void
}

interface AttachmentDraftListProps {
  /** 已就绪的附件草稿（消息编辑里保留的旧附件等）。 */
  items?: AttachmentDraftItem[]
  /** 上传状态机条目（含 uploading/error/done，见 useAttachmentUpload）。 */
  uploads?: UploadDraftItem[]
  onRemove?: (draftId: string) => void
  onRemoveUpload?: (localId: string) => void
  onRetryUpload?: (localId: string) => void
  className?: string
  testId?: string
}

/** 环形上传进度：白色描边压在图片/图标上，深浅色主题都可读。 */
function UploadProgressRing({ progress, className }: { progress: number; className?: string }) {
  const radius = 9
  const circumference = 2 * Math.PI * radius
  // 起步给一小段弧：0% 时也能看出「在转」，不至于像卡死。
  const arc = Math.max(0.04, Math.min(1, progress))
  return (
    <svg
      viewBox="0 0 22 22"
      className={className ?? 'h-6 w-6'}
      role="progressbar"
      aria-label="上传中"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
    >
      <circle cx="11" cy="11" r={radius} fill="none" strokeWidth="2.5" className="stroke-white/30" />
      <circle
        cx="11"
        cy="11"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - arc)}
        transform="rotate(-90 11 11)"
        className="stroke-white transition-[stroke-dashoffset] duration-300 ease-out"
      />
    </svg>
  )
}

function tileDataProps(tile: AttachmentTile, testId: string) {
  return {
    'data-testid': testId,
    'data-attachment-kind': tile.kind,
    'data-retained': tile.retained ? 'true' : 'false',
    'data-status': tile.status,
  }
}

/** 图片卡：方形缩略图，上传中压环形进度，失败中央重试，右上角浮动移除。 */
function ImageTile({ tile, testId }: { tile: AttachmentTile; testId: string }) {
  return (
    <div {...tileDataProps(tile, testId)} className="hc-pop-in group relative">
      <ImagePreviewTrigger
        src={tile.previewSrc ?? ''}
        alt={tile.filename || '待发送图片'}
        caption={tile.filename}
        className={clsx(
          'block h-16 w-16 overflow-hidden rounded-xl ring-1',
          tile.retained ? 'ring-blue-400/70 dark:ring-blue-500/60' : 'ring-black/10 dark:ring-white/15',
        )}
        imageClassName="block h-16 w-16 object-cover"
      />
      {tile.status === 'uploading' && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-black/45">
          <UploadProgressRing progress={tile.progress} />
        </div>
      )}
      {tile.status === 'error' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-black/55 ring-1 ring-inset ring-red-500/80">
          <button
            type="button"
            onClick={tile.onRetry}
            aria-label="重试上传"
            title={tile.errorMessage ? `上传失败：${tile.errorMessage}，点击重试` : '上传失败，点击重试'}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/30"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      )}
      {tile.retained && (
        <span className="pointer-events-none absolute bottom-1 left-1 z-10 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] leading-none text-white backdrop-blur-sm">
          已保留
        </span>
      )}
      <button
        type="button"
        onClick={tile.onRemove}
        aria-label="移除附件"
        title="移除附件"
        className="absolute right-1 top-1 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white shadow-sm backdrop-blur-sm transition hover:bg-black/80"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

/** 文件卡：类型图标 + 文件名，上传中副行变进度条，失败副行变重试入口。 */
function FileTile({ tile, testId }: { tile: AttachmentTile; testId: string }) {
  const sizeText = formatByteSize(tile.byteSize)
  const percent = Math.round(tile.progress * 100)
  return (
    <div
      {...tileDataProps(tile, testId)}
      className={clsx(
        'hc-pop-in relative flex w-56 max-w-full items-center gap-2.5 rounded-2xl border p-2 pr-8',
        'border-neutral-200 bg-neutral-50/80 dark:border-neutral-700 dark:bg-neutral-800/70',
        tile.status === 'error' && 'border-red-300 dark:border-red-900/70',
        tile.retained && 'border-blue-200 bg-blue-50/60 dark:border-blue-900/70 dark:bg-blue-950/25',
      )}
    >
      <div
        className={clsx(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm',
          tile.status === 'error' ? 'bg-red-500' : 'bg-blue-500 dark:bg-blue-600',
        )}
      >
        {tile.status === 'uploading' ? (
          <UploadProgressRing progress={tile.progress} />
        ) : (
          <FileText className="h-5 w-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-5 text-neutral-800 dark:text-neutral-100">
          {tile.filename}
        </div>
        {tile.status === 'uploading' ? (
          <div className="mt-1 flex items-center gap-1.5">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-600">
              <div
                className="h-full rounded-full bg-blue-500 transition-[width] duration-300 ease-out dark:bg-blue-400"
                style={{ width: `${Math.max(4, percent)}%` }}
              />
            </div>
            <span className="shrink-0 text-[11px] tabular-nums leading-none text-neutral-400">
              {percent}%
            </span>
          </div>
        ) : tile.status === 'error' ? (
          <button
            type="button"
            onClick={tile.onRetry}
            title={tile.errorMessage ?? undefined}
            className="mt-0.5 inline-flex items-center gap-1 text-xs leading-4 text-red-600 transition hover:underline dark:text-red-400"
          >
            <RotateCcw className="h-3 w-3" />
            上传失败，点击重试
          </button>
        ) : (
          <div className="mt-0.5 truncate text-xs leading-4 text-neutral-400">
            {fileTypeLabel(tile.filename, tile.mime)}
            {sizeText && ` · ${sizeText}`}
            {tile.retained && (
              <span className="text-blue-500 dark:text-blue-400"> · 已保留</span>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={tile.onRemove}
        aria-label="移除附件"
        title="移除附件"
        className="absolute right-1.5 top-1.5 rounded-full p-0.5 text-neutral-400 transition hover:text-red-500"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/** 待发送附件卡片列表：composer 与消息内联编辑共用；选中即上屏，逐项显示上传进度。 */
export function AttachmentDraftList({
  items = [],
  uploads = [],
  onRemove,
  onRemoveUpload,
  onRetryUpload,
  className,
  testId = 'attachment-draft-chip',
}: AttachmentDraftListProps) {
  const tiles: AttachmentTile[] = [
    ...items.map((item): AttachmentTile => ({
      key: `draft-${item.draftId}`,
      kind: item.kind,
      filename: item.filename,
      byteSize: item.byteSize,
      mime: item.mime,
      retained: item.retained,
      status: 'ready',
      progress: 1,
      errorMessage: null,
      previewSrc: item.kind === 'image' ? attachmentUrl(item.attachmentId) : null,
      onRemove: () => onRemove?.(item.draftId),
    })),
    ...uploads.map((item): AttachmentTile => ({
      key: `upload-${item.localId}`,
      kind: item.kind,
      filename: item.filename,
      byteSize: item.byteSize,
      mime: item.mime,
      retained: false,
      status: item.status === 'done' ? 'ready' : item.status,
      progress: item.progress,
      errorMessage: item.errorMessage,
      previewSrc:
        item.kind === 'image'
          ? (item.previewUrl ?? (item.attachment ? attachmentUrl(item.attachment.id) : null))
          : null,
      onRemove: () => onRemoveUpload?.(item.localId),
      onRetry: () => onRetryUpload?.(item.localId),
    })),
  ]

  if (tiles.length === 0) return null

  return (
    <div className={clsx('flex flex-wrap gap-2', className)}>
      {tiles.map((tile) =>
        tile.kind === 'image' ? (
          <ImageTile key={tile.key} tile={tile} testId={testId} />
        ) : (
          <FileTile key={tile.key} tile={tile} testId={testId} />
        ),
      )}
    </div>
  )
}
