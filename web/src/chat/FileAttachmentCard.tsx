import type { HTMLAttributes } from 'react'
import { clsx } from 'clsx'
import { RotateCcw, X } from 'lucide-react'
import { FileAttachmentIcon } from './icons'
import { fileTypeLabel, formatByteSize } from './uploadDraft'

export type FileAttachmentStatus = 'ready' | 'uploading' | 'error'

interface FileAttachmentCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  filename: string
  mime?: string | null
  byteSize?: number | null
  status?: FileAttachmentStatus
  progress?: number
  errorMessage?: string | null
  retained?: boolean
  href?: string
  onRemove?: () => void
  onRetry?: () => void
}

/** 图片遮罩用白色进度环；文件卡片用蓝色进度环。 */
export function AttachmentUploadProgressRing({
  progress,
  inverted = false,
  className,
}: {
  progress: number
  inverted?: boolean
  className?: string
}) {
  const radius = 9
  const circumference = 2 * Math.PI * radius
  // 起步保留一小段弧，0% 时也能明确表达上传已经开始。
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
      <circle
        cx="11"
        cy="11"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        className={inverted ? 'stroke-white/30' : 'stroke-[#0285ff]/20'}
      />
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
        className={clsx(
          'transition-[stroke-dashoffset] duration-300 ease-out',
          inverted ? 'stroke-white' : 'stroke-[#0285ff]',
        )}
      />
    </svg>
  )
}

/**
 * 文件附件的统一外观。待发送、消息展示、编辑消息与公开分享都复用这张卡片，
 * 避免相同附件在不同生命周期里出现尺寸、图标和主题配色漂移。
 */
export function FileAttachmentCard({
  filename,
  mime = null,
  byteSize = null,
  status = 'ready',
  progress = 1,
  errorMessage = null,
  retained = false,
  href,
  onRemove,
  onRetry,
  className,
  style,
  ...rootProps
}: FileAttachmentCardProps) {
  const sizeText = formatByteSize(byteSize)
  const metadata = [fileTypeLabel(filename, mime), sizeText, retained ? '已保留' : '']
    .filter(Boolean)
    .join(' · ')
  const percent = Math.round(progress * 100)

  return (
    <div
      {...rootProps}
      style={{
        // 所有生命周期固定使用同一宽度；仅在窄屏时跟随视口收缩。
        // 长文件名截断而不再把卡片从 14rem 撑到旧上限 20rem。
        width: 'min(14rem, calc(100vw - 3rem))',
        maxWidth: '100%',
        ...style,
      }}
      className={clsx(
        'relative flex min-h-14 items-center gap-2.5 rounded-2xl border bg-white px-3 py-1.5',
        'border-neutral-200 text-left dark:border-[#4a4a4a] dark:bg-[#212121]',
        href &&
          'transition hover:bg-neutral-50 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/15 dark:hover:bg-[#292929]',
        status === 'error' && 'border-red-300 dark:border-red-800',
        'pr-4',
        className,
      )}
    >
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={`打开文件：${filename}`}
          title={filename}
          className="absolute inset-0 z-[2] rounded-[18px] outline-none"
        />
      )}

      <div className="pointer-events-none relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center">
        {status === 'uploading' ? (
          <AttachmentUploadProgressRing progress={progress} className="h-5 w-5" />
        ) : (
          <FileAttachmentIcon
            className={clsx('h-6 w-6', status === 'error' ? 'text-red-500' : 'text-[#0285ff]')}
          />
        )}
      </div>

      <div className="relative z-[1] min-w-0 flex-1">
        <div
          className="truncate text-sm font-semibold leading-[18px] text-neutral-900 dark:text-neutral-100"
          title={filename}
        >
          {filename}
        </div>
        {status === 'uploading' ? (
          <div className="mt-1 flex items-center gap-1.5">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-600">
              <div
                className="h-full rounded-full bg-[#0285ff] transition-[width] duration-300 ease-out"
                style={{ width: `${Math.max(4, percent)}%` }}
              />
            </div>
            <span className="shrink-0 text-[11px] leading-none text-neutral-400 tabular-nums">
              {percent}%
            </span>
          </div>
        ) : status === 'error' ? (
          <button
            type="button"
            onClick={onRetry}
            title={errorMessage ?? undefined}
            className="mt-0.5 inline-flex items-center gap-1 text-xs leading-4 text-red-600 transition hover:underline dark:text-red-400"
          >
            <RotateCcw className="h-3 w-3" />
            上传失败，点击重试
          </button>
        ) : (
          <div className="mt-[3px] truncate text-xs leading-4 text-neutral-500 dark:text-neutral-400">
            {metadata}
          </div>
        )}
      </div>

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="移除附件"
          title="移除附件"
          className="absolute -right-1 -top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-900 text-white shadow-sm transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          <X className="h-[11px] w-[11px]" strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
}
