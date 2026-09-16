import type { ReactNode } from 'react'
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { clsx } from 'clsx'

interface Props {
  open: boolean
  onClose: () => void
  /** 纯文本标题；也可传富标题节点（须为 phrasing 内容，因为会渲染进 h3）。 */
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** 页签等导航固定在标题下方，长表单滚动时仍可切换。 */
  navigation?: ReactNode
  /** 工作台的模型等实体目录，桌面固定左栏。窄屏切换入口由 navigation 提供。 */
  sidebar?: ReactNode
  /** 连续切换实体的工作台不重复播放入场动画。 */
  animate?: boolean
  size?: 'default' | 'form' | 'reading' | 'workspace' | 'wide'
  /** 复杂双栏面板可自行安排内部滚动，其余弹窗保持统一正文边距。 */
  bodyClassName?: string
  /** 面板高度：auto=随内容收缩（默认）；fixed=固定高度，内容很短时也保持体面的窗体比例。 */
  height?: 'auto' | 'fixed' | 'workspace'
  /** 分隔线范围：all=头脚都画（默认）；header=只画标题下的一条（内容展示类弹窗底部按钮悬浮更轻）。 */
  dividers?: 'all' | 'header'
  /** false 时隐藏关闭按钮，并忽略 Escape 与背景点击；适用于必须明确确认的阻断式提示。 */
  dismissible?: boolean
}

const SIZE_CLASS: Record<NonNullable<Props['size']>, string> = {
  default: 'max-w-lg',
  form: 'max-w-2xl',
  /** 内容阅读档：给公告/文档类正文（含表格）留足排版宽度。 */
  reading: 'max-w-3xl',
  workspace: 'max-w-5xl',
  wide: 'max-w-[min(80vw,calc(100vw-2rem))]',
}

const HEIGHT_CLASS: Record<NonNullable<Props['height']>, string> = {
  auto: 'max-h-[90vh]',
  fixed: 'h-[min(85vh,40rem)]',
  workspace: 'h-[min(86dvh,42rem)]',
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'default',
  height = 'auto',
  dividers = 'all',
  dismissible = true,
  bodyClassName,
  navigation,
  sidebar,
  animate = true,
}: Props) {
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

      if (e.key === 'Escape' && dismissible) {
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
  }, [dismissible, open])

  if (!open) return null

  // 模态层必须脱离入口所在的布局树，避免被聊天主区的 overflow/stacking context 裁剪，
  // 确保从侧边栏、顶栏或设置页打开时都覆盖完整视口。
  // 移动端外边距收窄换取面板宽度，内边距反而加大——小屏拥挤感主要来自文字贴边。
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={dismissible ? onClose : undefined}
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
          'relative z-10 flex w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-900',
          animate && 'hc-pop-in',
          SIZE_CLASS[size],
          HEIGHT_CLASS[height],
        )}
      >
        <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-neutral-200 px-4 py-2.5 sm:px-5 dark:border-neutral-800">
          {/* 富标题按 flex 居中，避免内层 inline-flex 的基线留白把整组图文抬高。 */}
          <h3
            id={titleId}
            className="flex min-w-0 items-center text-sm font-semibold leading-5 text-neutral-900 dark:text-neutral-100"
          >
            {title}
          </h3>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex min-h-0 flex-1">
          {sidebar && (
            <aside className="hidden w-56 shrink-0 flex-col bg-neutral-50 md:flex dark:bg-neutral-950/50">
              {sidebar}
            </aside>
          )}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {navigation && <div className="shrink-0 px-4 py-2.5 sm:px-5">{navigation}</div>}
            <div
              className={clsx(
                'min-h-0 flex-1',
                bodyClassName ?? 'hc-scrollbar overflow-y-auto px-5 py-4 sm:px-6',
              )}
            >
              {children}
            </div>
            {footer && (
              <div
                className={clsx(
                  'flex shrink-0 justify-end gap-2 px-4 sm:px-5',
                  dividers === 'all'
                    ? 'border-t border-neutral-200 py-2.5 dark:border-neutral-800'
                    : 'pt-1 pb-3',
                )}
              >
                {footer}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
