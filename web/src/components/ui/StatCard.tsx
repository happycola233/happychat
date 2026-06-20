import type { ReactNode } from 'react'

interface Props {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
}

export function StatCard({ label, value, hint, icon }: Props) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-500 dark:text-neutral-400">{label}</span>
        {icon && <span className="text-neutral-400">{icon}</span>}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
        {value}
      </div>
      {hint != null && <div className="mt-0.5 text-xs text-neutral-400">{hint}</div>}
    </div>
  )
}
