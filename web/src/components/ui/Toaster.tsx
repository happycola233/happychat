import { clsx } from 'clsx'
import { CheckCircle2, Info, XCircle } from 'lucide-react'
import { useToastStore } from '../../store/toast'

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'flex items-center gap-2 rounded-xl px-4 py-3 text-sm text-white shadow-lg',
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
