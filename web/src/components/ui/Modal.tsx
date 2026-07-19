import type { ReactNode } from 'react'
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
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

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function Modal({ open, onClose, title, children, footer, size = 'default' }: Props) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusFrame = requestAnimationFrame(() => {
      const dialog = dialogRef.current
      // 保留子控件显式 autoFocus；否则先聚焦对话框本身，移动端不会突兀弹出软键盘。
      if (dialog && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true })
    })
    const onKey = (e: KeyboardEvent) => {
      const dialog = dialogRef.current
      if (!dialog) return
      // 页面偶尔会叠加确认框（role=alertdialog）；只有 DOM 中最上层的模态层接管 Escape 与焦点循环。
      const openDialogs = document.querySelectorAll('[aria-modal="true"]')
      if (openDialogs.item(openDialogs.length - 1) !== dialog) return

      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return

      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) => element.getClientRects().length > 0,
      )
      if (focusable.length === 0) {
        e.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (
        !e.shiftKey &&
        (active === last || active === dialog || !dialog.contains(active))
      ) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', onKey)
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true })
    }
  }, [open])

  if (!open) return null

  // 模态层必须脱离入口所在的布局树，避免被聊天主区的 overflow/stacking context 裁剪，
  // 确保从侧边栏、顶栏或设置页打开时都覆盖完整视口。
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* 面板用 flex 列布局：头/脚为固定栏，仅中间正文滚动，长表单也能常驻标题与操作。 */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          'hc-pop-in relative z-10 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-900',
          SIZE_CLASS[size],
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-neutral-200 px-4 py-3.5 sm:px-6 dark:border-neutral-800">
          <h3 id={titleId} className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
            {title}
          </h3>
          <button
            type="button"
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
    </div>,
    document.body,
  )
}
