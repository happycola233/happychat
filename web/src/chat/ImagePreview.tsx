import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { Download, Maximize2, X } from 'lucide-react'

interface ImagePreviewTriggerProps {
  src: string
  alt: string
  children?: ReactNode
  caption?: string | null
  className?: string
  compact?: boolean
  downloadName?: string
  imageClassName?: string
  title?: string | null
}

interface ImagePreviewDialogProps {
  src: string
  alt: string
  caption?: string | null
  downloadName?: string
  onClose: () => void
}

export function ImagePreviewTrigger({
  src,
  alt,
  children,
  caption,
  className,
  compact = false,
  downloadName = 'happychat-image',
  imageClassName,
  title,
}: ImagePreviewTriggerProps) {
  const [open, setOpen] = useState(false)
  const previewTitle = title || caption || `预览${alt}`

  return (
    <>
      <button
        type="button"
        aria-label={`预览${alt}`}
        title={previewTitle}
        onClick={() => setOpen(true)}
        className={clsx(
          'group relative cursor-zoom-in border-0 bg-transparent p-0 text-left leading-none outline-none',
          'transition focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-blue-400/70 dark:focus-visible:ring-offset-black',
          className,
        )}
      >
        {children ?? <img src={src} alt={alt} title={title ?? undefined} className={imageClassName} />}
        <span
          className={clsx(
            'pointer-events-none absolute flex items-center justify-center rounded-full bg-black/55 text-white opacity-0 shadow-lg ring-1 ring-white/20 backdrop-blur transition',
            'group-hover:opacity-100 group-focus-visible:opacity-100',
            compact ? 'right-1 top-1 h-5 w-5' : 'right-2 top-2 h-7 w-7',
          )}
          aria-hidden="true"
        >
          <Maximize2 className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        </span>
      </button>
      {open && (
        <ImagePreviewDialog
          src={src}
          alt={alt}
          caption={caption}
          downloadName={downloadName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function ImagePreviewDialog({
  src,
  alt,
  caption,
  downloadName,
  onClose,
}: ImagePreviewDialogProps) {
  const titleId = useId()
  const captionId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={caption ? captionId : undefined}
      className="fixed inset-0 z-[70] bg-neutral-950/86 text-white backdrop-blur-sm"
      onClick={onClose}
    >
      <h2 id={titleId} className="sr-only">
        {alt}
      </h2>
      <div
        className="absolute right-3 top-3 z-20 flex items-center gap-1.5 sm:right-5 sm:top-5"
        onClick={(event) => event.stopPropagation()}
      >
        <a
          href={src}
          download={downloadName}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/20 text-white/72 backdrop-blur transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          aria-label="下载图片"
          title="下载图片"
        >
          <Download className="h-4 w-4" />
        </a>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/20 text-white/72 backdrop-blur transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          aria-label="关闭预览"
          title="关闭"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="hc-pop-in flex h-full w-full items-center justify-center px-4 py-14 sm:px-8 sm:py-16">
        <figure
          className="flex max-h-full max-w-full min-w-0 flex-col items-center gap-3"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="hc-image-preview-surface relative inline-flex max-w-full items-center justify-center overflow-hidden rounded-xl">
            {/* 棋盘纹理只贴合图片本体，透明图可辨认，普通图片不会被一大片背景抢戏。 */}
            <div className="hc-image-preview-canvas absolute inset-0" aria-hidden="true" />
            <img
              src={src}
              alt={alt}
              className="relative z-10 block max-h-[min(82dvh,calc(100dvh-8.5rem))] max-w-[calc(100dvw-2rem)] rounded-xl object-contain shadow-[0_18px_60px_rgba(0,0,0,0.38)] sm:max-w-[calc(100dvw-4rem)]"
            />
          </div>
          {caption && (
            <figcaption
              id={captionId}
              className="hc-image-preview-caption max-h-20 max-w-[min(56rem,calc(100dvw-2rem))] overflow-y-auto rounded-2xl bg-black/28 px-3 py-2 text-center text-xs leading-5 text-white/70 shadow-xl backdrop-blur sm:max-h-24 sm:px-4"
            >
              {caption}
            </figcaption>
          )}
        </figure>
      </div>
    </div>,
    document.body,
  )
}
