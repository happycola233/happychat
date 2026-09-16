import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'

/** 用量页用留白和底色分组，不叠加边框与阴影。 */
export function UsageSection({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}) {
  const titleId = useId()
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={clsx(
        'min-w-0 rounded-xl bg-neutral-50 p-4 sm:p-5 dark:bg-neutral-900/60',
        className,
      )}
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={titleId}
            className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100"
          >
            {title}
          </h2>
          {description && (
            <div className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
              {description}
            </div>
          )}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function UsageSectionFooter({ note, actions }: { note: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
      <div className="min-w-0">{note}</div>
      {actions && <div className="ml-auto shrink-0">{actions}</div>}
    </div>
  )
}

/** 悬停、键盘聚焦或手机点按均可读取缩写数字的完整值。 */
export function UsageValue({
  children,
  exact,
  className,
}: {
  children: ReactNode
  exact: string
  className?: string
}) {
  const tooltipId = useId()
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const reveal = (button: HTMLButtonElement) => {
    const box = button.getBoundingClientRect()
    const maxWidth = Math.min(240, window.innerWidth - 16)
    const above = box.top > 64
    setPosition({
      left: Math.max(8, Math.min(box.left, window.innerWidth - maxWidth - 8)),
      top: above ? box.top - 8 : box.bottom + 8,
      transform: above ? 'translateY(-100%)' : undefined,
      maxWidth,
    })
  }
  useEffect(() => {
    if (!position) return
    const dismiss = () => setPosition(null)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [position])
  return (
    <span className={clsx('inline-flex max-w-full tabular-nums', className)}>
      <button
        type="button"
        aria-label={exact}
        aria-describedby={position ? tooltipId : undefined}
        className="max-w-full rounded-sm text-left focus-visible:outline-2 focus-visible:outline-sky-500"
        onClick={(event) => {
          event.currentTarget.focus()
          reveal(event.currentTarget)
        }}
        onFocus={(event) => reveal(event.currentTarget)}
        onBlur={() => setPosition(null)}
        onMouseEnter={(event) => reveal(event.currentTarget)}
        onMouseLeave={(event) => {
          if (document.activeElement !== event.currentTarget) setPosition(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setPosition(null)
        }}
      >
        {children}
      </button>
      {position &&
        createPortal(
          <span
            id={tooltipId}
            role="tooltip"
            style={position}
            className="pointer-events-none fixed z-50 w-max rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-normal leading-5 text-white dark:bg-neutral-200 dark:text-neutral-900"
          >
            {exact}
          </span>,
          document.body,
        )}
    </span>
  )
}
