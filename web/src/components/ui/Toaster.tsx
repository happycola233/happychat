import { clsx } from 'clsx'
import { CheckCircle2, Info, XCircle } from 'lucide-react'
import { useToastStore } from '../../store/toast'

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-[80] flex w-[min(92vw,28rem)] -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'pointer-events-auto flex w-fit max-w-full items-center gap-2 rounded-xl px-4 py-3 text-sm text-white shadow-lg',
            t.kind === 'success' && 'bg-emerald-600',
            t.kind === 'error' && 'bg-red-600',
            t.kind === 'info' && 'bg-neutral-800',
          )}
        >
          {t.kind === 'success' && <CheckCircle2 className="h-4 w-4" />}
          {t.kind === 'error' && <XCircle className="h-4 w-4" />}
          {t.kind === 'info' && <Info className="h-4 w-4" />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}
