import type { ReactNode } from 'react'
import { cardSurface } from './Card'

interface Props {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
}

export function StatCard({ label, value, hint, icon }: Props) {
  return (
    <div className={`${cardSurface} p-5`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">{label}</span>
        {icon && <span className="text-neutral-400">{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-neutral-900 dark:text-neutral-100">
        {value}
      </div>
      {hint != null && <div className="mt-1 text-xs text-neutral-400">{hint}</div>}
    </div>
  )
}
