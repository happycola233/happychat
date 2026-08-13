import { RotateCcw, X } from 'lucide-react'
import { clsx } from 'clsx'
import { attachmentUrl } from '../api/attachments'
import { ImagePreviewTrigger } from './ImagePreview'
import type { AttachmentDraftItem } from './attachmentDraft'
import { AttachmentUploadProgressRing, FileAttachmentCard } from './FileAttachmentCard'
import type { UploadDraftItem } from './uploadDraft'

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
          tile.retained
            ? 'ring-blue-400/70 dark:ring-blue-500/60'
            : 'ring-black/10 dark:ring-white/15',
        )}
        imageClassName="block h-16 w-16 object-cover"
      />
      {tile.status === 'uploading' && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-black/45">
          <AttachmentUploadProgressRing progress={tile.progress} inverted />
        </div>
      )}
      {tile.status === 'error' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-black/55 ring-1 ring-inset ring-red-500/80">
          <button
            type="button"
            onClick={tile.onRetry}
            aria-label="重试上传"
            title={
              tile.errorMessage ? `上传失败：${tile.errorMessage}，点击重试` : '上传失败，点击重试'
            }
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
  return (
    <FileAttachmentCard
      {...tileDataProps(tile, testId)}
      filename={tile.filename}
      mime={tile.mime}
      byteSize={tile.byteSize}
      status={tile.status}
      progress={tile.progress}
      errorMessage={tile.errorMessage}
      retained={tile.retained}
      onRemove={tile.onRemove}
      onRetry={tile.onRetry}
      className="hc-pop-in"
    />
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
    ...items.map(
      (item): AttachmentTile => ({
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
      }),
    ),
    ...uploads.map(
      (item): AttachmentTile => ({
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
      }),
    ),
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
