import type { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '../../components/ui/Button'

export function DashboardPanel({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`min-w-0 rounded-xl bg-neutral-50 p-4 dark:bg-neutral-900/60 ${className}`}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && (
            <div className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
              {description}
            </div>
          )}
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}

export function MetricStrip({
  items,
}: {
  items: { label: string; value: ReactNode; hint: ReactNode }[]
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-5 border-b border-neutral-100 pb-5 lg:grid-cols-4 dark:border-neutral-800">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-neutral-500 dark:text-neutral-400">{item.label}</dt>
          <dd className="mt-2 break-words text-2xl font-semibold tracking-tight tabular-nums sm:text-[28px]">
            {item.value}
          </dd>
          <dd className="mt-1.5 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
            {item.hint}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function RefreshButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      disabled={busy}
      onClick={onClick}
      aria-label="刷新数据"
      title="刷新数据"
    >
      <RefreshCw
        aria-hidden
        className={`h-3.5 w-3.5 ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`}
      />
      <span className="hidden sm:inline">刷新</span>
    </Button>
  )
}

export { LoadError as DashboardError } from '../../components/ui/LoadError'

export function DashboardLoading() {
  return (
    <div role="status" className="space-y-5">
      <span className="sr-only">正在加载统计数据</span>
      <div
        aria-hidden
        className="grid animate-pulse grid-cols-2 gap-4 motion-reduce:animate-none lg:grid-cols-4"
      >
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="h-24 rounded-lg bg-neutral-100 dark:bg-neutral-900" />
        ))}
      </div>
      <div
        aria-hidden
        className="h-72 animate-pulse rounded-xl bg-neutral-50 motion-reduce:animate-none dark:bg-neutral-900"
      />
    </div>
  )
}
