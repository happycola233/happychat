import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { clsx } from 'clsx'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'default' | 'form' | 'wide'
}

const SIZE_CLASS: Record<NonNullable<Props['size']>, string> = {
  default: 'max-w-lg',
  form: 'max-w-2xl',
  wide: 'max-w-[min(80vw,calc(100vw-2rem))]',
}

export function Modal({ open, onClose, title, children, footer, size = 'default' }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      {/* 面板用 flex 列布局：头/脚为固定栏，仅中间正文滚动，长表单也能常驻标题与操作。 */}
      <div
        className={clsx(
          'hc-pop-in relative z-10 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-900',
          SIZE_CLASS[size],
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-neutral-200 px-4 py-3.5 sm:px-6 dark:border-neutral-800">
          <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="hc-scrollbar flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-neutral-200 px-4 py-3.5 sm:px-6 dark:border-neutral-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
